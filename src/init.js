/**
 * Interactive first-run setup (`ai-switch init`).
 *
 * Detects API keys already present in the environment, asks for any missing
 * ones (masked input), validates connectivity with a tiny probe call, picks a
 * default provider + primary/backup chain, and writes a safe config file.
 */

const chalk = require('chalk');

const { envVarNames } = require('./utils/keys');
const { Prompter } = require('./utils/prompts');
const { OpenAIProvider } = require('./providers/openai');
const { AnthropicProvider } = require('./providers/anthropic');
const { GoogleProvider } = require('./providers/google');
const { OllamaProvider } = require('./providers/ollama');

const LABELS = {
  openai: 'OpenAI (ChatGPT / GPT)',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  ollama: 'Ollama (local)'
};

const DEFAULT_MODELS = {
  openai: 'gpt-4',
  anthropic: 'claude-3-opus-20240229',
  google: 'gemini-pro',
  ollama: 'llama2'
};

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://localhost:11434'
};

const CLOUD_PRIORITY = ['openai', 'anthropic', 'google'];

const PROVIDER_FACTORIES = {
  openai: (cfg) => new OpenAIProvider(cfg),
  anthropic: (cfg) => new AnthropicProvider(cfg),
  google: (cfg) => new GoogleProvider(cfg),
  ollama: (cfg) => new OllamaProvider(cfg)
};

const PROBE_TEXT = 'Reply with the single word OK.';
const PROBE_TIMEOUT_MS = 20000;

/**
 * Probe an already-constructed provider instance with one tiny completion call.
 * Returns false on any error/timeout instead of throwing.
 * @param {Object} provider - Provider instance with `complete()`
 * @returns {Promise<boolean>}
 */
async function probeWithProvider(provider) {
  let timer;
  try {
    const result = await Promise.race([
      provider.complete(PROBE_TEXT, { temperature: 0, maxTokens: 8 }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS);
      })
    ]);
    if (typeof result === 'string') return result.trim().length > 0;
    return Boolean(result && result.text && String(result.text).trim().length > 0);
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One tiny real completion call against a provider to prove the key works.
 * Returns false on any error/timeout instead of throwing.
 * @param {string} name - Provider name
 * @param {Object} cfg - Provider config ({ apiKey, model, baseUrl })
 * @returns {Promise<boolean>}
 */
function probeProvider(name, cfg) {
  const factory = PROVIDER_FACTORIES[name];
  if (!factory) return Promise.resolve(false);
  return probeWithProvider(factory(cfg));
}

/**
 * Pick a default provider and failover chain from the probed-OK providers.
 * Cloud providers that validated come first; a configured keyless local server
 * (Ollama) is always appended as a last-resort backup; cloud providers that did
 * not validate are only included when nothing validated at all.
 * @param {string[]} okNames - Providers that validated
 * @param {string[]} [configuredNames] - Providers chosen during setup
 * @returns {{defaultProvider: string|null, chain: string[]}}
 */
function suggestChain(okNames, configuredNames = okNames) {
  const ok = new Set(okNames || []);
  const chosen = new Set(configuredNames || []);
  const ranked = CLOUD_PRIORITY.concat(['ollama']);

  const verified = ranked.filter((n) => ok.has(n));
  const local = ranked.filter((n) => n === 'ollama' && chosen.has(n) && !ok.has(n));
  const unverified = ranked.filter((n) => n !== 'ollama' && chosen.has(n) && !ok.has(n));
  const chain = verified.concat(local, verified.length === 0 ? unverified : []);
  return { defaultProvider: chain[0] || null, chain };
}

/**
 * Merge the wizard's selections into a complete config object.
 * Only providers explicitly confirmed by the user end up in the file; a
 * previously stored keyed provider that the wizard didn't touch is preserved
 * (re-runs don't wipe working providers). Empty key placeholders are dropped.
 * @param {Object} current - Existing config (or {})
 * @param {Object} options - { providers: [{name,key,baseUrl,model}], defaultProvider, chain }
 * @returns {Object} New config object
 */
function buildInitConfig(current = {}, options = {}) {
  const providersIn = options.providers || [];
  const prevProviders = current.providers || {};
  const providers = {};

  for (const p of providersIn) {
    const prev = prevProviders[p.name] || {};
    providers[p.name] = {
      model: p.model || prev.model || DEFAULT_MODELS[p.name] || 'unknown',
      baseUrl: p.baseUrl || prev.baseUrl || DEFAULT_BASE_URLS[p.name] || ''
    };
    if (p.key) providers[p.name].apiKey = p.key;
  }

  for (const [name, prev] of Object.entries(prevProviders)) {
    if (providers[name] || !prev || typeof prev !== 'object') continue;
    if (prev.apiKey) {
      providers[name] = { ...prev };
    }
  }

  return {
    providers,
    cache: { enabled: true, ttl: 3600, maxSize: 1000 },
    chat: { maxTurns: 20, maxContextTokens: 4000 },
    failover: {
      enabled: true,
      order: options.chain || [],
      maxFailures: 3,
      cooldownSeconds: 60
    },
    costTracking: { enabled: true },
    defaultProvider: options.defaultProvider || null
  };
}

/**
 * Run the interactive wizard.
 * @param {Object} options
 * @param {Object} options.config - ConfigManager instance
 * @param {Object} [options.prompter] - Prompter instance
 * @param {Function} [options.probe] - (name, cfg) => Promise<boolean>
 * @param {Object} [options.env] - Environment (defaults to process.env)
 * @param {Object} [options.out] - Console-like writer with log()
 * @returns {Promise<{configured: boolean, defaultProvider: string|null, chain: string[]}>}
 */
async function runInit(options = {}) {
  const { config } = options;
  const prompter = options.prompter || new Prompter();
  const probe = options.probe || probeProvider;
  const env = options.env || process.env;
  const out = options.out || console;
  const providers = [];

  out.log(chalk.bold('\n  ⚡ AI-Switch setup\n'));

  const detected = CLOUD_PRIORITY.filter((name) => envVarNames(name).some((v) => env[v]));
  if (detected.length > 0) {
    out.log(chalk.bold('  Found in your environment:'));
    for (const name of detected) {
      const varName = envVarNames(name).find((v) => env[v]);
      out.log(`    ${chalk.green('✓')} ${chalk.cyan(varName)} is set`);
    }
    out.log('');
  }

  for (const name of CLOUD_PRIORITY) {
    const envVar = envVarNames(name).find((v) => env[v]);
    const hint = envVar ? chalk.dim(` (key found in ${envVar})`) : '';
    const answer = await prompter.confirm(chalk.bold(`Configure ${LABELS[name]}?`) + hint, Boolean(envVar));
    if (!answer) continue;

    let key = envVar ? env[envVar] : null;
    if (!key) {
      const suffix = name === 'anthropic' ? ' (sk-ant-...)' : ' (sk-...)';
      key = await prompter.hidden(`  ${name} API key${suffix}: `);
    }
    if (key) providers.push({ name, key });
  }

  const ollamaAnswer = await prompter.confirm(chalk.bold('Configure Ollama (local, keyless)?'), false);
  if (ollamaAnswer) {
    const baseUrl = await prompter.text(`  Ollama server URL [${DEFAULT_BASE_URLS.ollama}]: `);
    providers.push({ name: 'ollama', baseUrl: baseUrl || DEFAULT_BASE_URLS.ollama });
  }

  if (providers.length === 0) {
    out.log('\n' + chalk.yellow('  No providers were configured. You can re-run `ai-switch init` anytime,'));
    out.log(chalk.yellow('  or export a key and it will be picked up automatically, e.g.:'));
    out.log(chalk.gray('    export OPENAI_API_KEY=sk-...  &&  ai-switch ask "hi"'));
    return { configured: false, defaultProvider: null, chain: [] };
  }

  out.log(chalk.bold('\n  Validating connectivity…'));
  const results = [];
  for (const p of providers) {
    const passed = await probe(p.name, {
      apiKey: p.key,
      baseUrl: p.baseUrl || (config.get(`providers.${p.name}.baseUrl`) || DEFAULT_BASE_URLS[p.name]),
      model: config.get(`providers.${p.name}.model`) || DEFAULT_MODELS[p.name]
    });
    results.push({ ...p, passed });
  }

  for (const r of results) {
    const mark = r.passed ? chalk.green(`✓ ${r.name} responded`) : chalk.red(`✗ ${r.name} failed the probe`);
    const detail = r.name === 'ollama' ? ` (${r.baseUrl || DEFAULT_BASE_URLS.ollama})` : '';
    out.log(`    ${mark}${r.passed ? '' : chalk.dim(detail)}`);
  }

  const okNames = results.filter((r) => r.passed).map((r) => r.name);
  const { defaultProvider, chain } = suggestChain(okNames, providers.map((p) => p.name));

  config.replace(buildInitConfig(config.config, { providers, defaultProvider, chain }));

  out.log('\n' + chalk.green('  ✓ Config saved to ') + chalk.cyan(config.configPath));
  if (defaultProvider) {
    out.log(`    Default provider: ${chalk.bold(defaultProvider)}`);
    if (chain.length > 1) {
      out.log(`    Failover chain:  ${chalk.bold(chain.join(' → '))}`);
    }
  }
  out.log('\n  Next:');
  out.log(chalk.gray('    ai-switch ask "hi"            # first question, routed + charged'));
  out.log(chalk.gray('    ai-switch keys list          # where your keys live (masked)'));
  out.log(chalk.gray('    ai-switch config             # effective config (secrets masked)'));

  return { configured: true, defaultProvider, chain };
}

module.exports = {
  LABELS,
  DEFAULT_MODELS,
  DEFAULT_BASE_URLS,
  PROBE_TEXT,
  probeProvider,
  probeWithProvider,
  suggestChain,
  buildInitConfig,
  runInit
};