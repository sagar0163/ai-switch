#!/usr/bin/env node

/**
 * AI-Switch CLI
 * Command-line interface entry point
 */

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const { AISwitch } = require('./index');
const { ConfigManager } = require('./utils/config');
const { Prompter } = require('./utils/prompts');
const { runInit } = require('./init');
const { PROVIDER_ORDER, maskKey } = require('./utils/keys');
const { version } = require('../package.json');

const program = new Command();

program
  .name('ai-switch')
  .description('Unified CLI for multiple AI LLM providers')
  .version(version);

// Global AI-Switch instance
let aiSwitch;

function getAISwitch() {
  if (!aiSwitch) {
    aiSwitch = new AISwitch();
  }
  return aiSwitch;
}

// Ask command
program
  .command('ask <prompt>')
  .description('Ask an AI provider a question')
  .option('-p, --provider <name>', 'Specific provider to use (openai, anthropic, etc.)')
  .option('--tier <tier>', 'Required quality tier (fast, balanced, strong)')
  .option('--explain', 'Explain routing decision')
  .option('-m, --model <model>', 'Specific model to use')
  .option('-t, --temperature <value>', 'Temperature (0-1)', parseFloat)
  .option('-M, --max-tokens <value>', 'Max tokens', parseInt)
  .option('--primary <provider>', 'Primary provider for failover')
  .option('--backup <provider>', 'Backup provider for failover')
  .action(async (prompt, options) => {
    const spinner = ora({
      text: 'Thinking...',
      spinner: 'dots'
    }).start();

    try {
      const ai = getAISwitch();
      const response = await ai.ask(prompt, {
        tier: options.tier,
        explain: options.explain,
        provider: options.provider,
        primary: options.primary,
        backup: options.backup,
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens
      });

      spinner.stop();
      console.log('\n' + chalk.green('Response:'));
      console.log(response);
    } catch (error) {
      spinner.stop();
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Providers list command
program
  .command('providers')
  .description('List all configured AI providers')
  .action(() => {
    const ai = getAISwitch();
    const providers = ai.listProviders();

    console.log(chalk.bold('\nConfigured Providers:\n'));
    providers.forEach(p => {
      const mark = p.available ? chalk.green('✓') : chalk.red('✗');
      const prefix = p.isDefault ? ' *' : '  ';
      
      const costStr = p.lastCost ? chalk.yellow(`${p.lastCost.toFixed(4)}`) : 'No usage';
      const healthStr = p.inCooldown ? chalk.red(`Cooling down (${p.cooldownRemaining}s)`) : (p.available ? chalk.green('Healthy') : chalk.red('Unavailable'));
      console.log(`${prefix} ${mark} ${chalk.cyan(p.name)} (${p.model}) - ${healthStr} | Last known cost: ${costStr}`);
    });
    console.log('');
  });

// Route command
program
  .command('route <prompt>')
  .description('Dry-run the routing engine for a prompt')
  .option('--tier <tier>', 'Required quality tier')
  .action((prompt, options) => {
    try {
      const ai = getAISwitch();
      const best = ai.providers.getBestAvailable(prompt, options.tier);
      const r = best.rationale;
    
      console.log(chalk.bold('\nRouting Decision:'));
      console.log(`  Selected: ${chalk.green(r.decision)}`);
      console.log(`  Reason: ${r.reason}`);
      console.log(`  Required tier: ${r.requiredTier}`);
      r.warnings.forEach(w => console.log(chalk.yellow(`  Warning: ${w}`)));
      console.log(chalk.bold('\nEvaluated Providers:'));
      r.evaluated.forEach(p => {
         const status = p.eligible ? chalk.green('Eligible') : chalk.red('Ineligible');
         console.log(`  - ${chalk.cyan(p.provider)} (${p.model})`);
         console.log(`      Tier: ${p.tier} | Cost Score: ${p.costScore === 999999 ? 'Unknown' : p.costScore}`);
         console.log(`      Status: ${status} (${p.reason})`);
         if (p.budgetWarning) console.log(`      ${chalk.yellow(`Budget: ${p.budgetWarning}`)}`);
      });
      console.log('');
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Compare command
program
  .command('compare <prompt>')
  .description('Run prompt across all configured providers and report latency/cost')
  .option('-r, --runs <n>', 'Number of benchmark runs per provider', parseInt)
  .option('-p, --provider <name>', 'Only benchmark a specific provider')
  .option('-m, --model <model>', 'Specific model to benchmark')
  .action(async (prompt, options) => {
    try {
      const ai = getAISwitch();
      const providers = options.provider
        ? [ai.providers.getProvider(options.provider)]
        : ai.providers.getOrder();

      console.log(chalk.bold(`\nBenchmarking prompt across ${providers.length} provider(s) (${options.runs || 1} run(s) each)...\n`));

      const results = await ai.compare(prompt, {
        runs: options.runs || 1,
        model: options.model
      });

      const table = results.map((r) => ({
        provider: r.provider,
        model: r.model,
        'latency (ms)': r.latencyMs == null ? '-' : r.latencyMs,
        'TTFB (ms)': r.ttfbMs == null ? '-' : r.ttfbMs,
        'cost (USD)': r.costUsd == null ? '-' : Number(r.costUsd).toFixed(6),
        'cost source': r.costSource || '-'
      }));

      console.log(chalk.bold('\nBenchmark Results (median):'));
      console.table(table);

      results.forEach((r) => {
        if (r.errors && r.errors.length > 0) {
          console.log(chalk.red(`  ${r.provider}: ${r.errors.length}/${r.runs} runs failed`));
          r.errors.slice(0, 3).forEach((e) => console.log(chalk.dim(`      - ${e}`)));
        }
      });
      console.log('');
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Costs command
program
  .command('costs')
  .description('Show API usage and cost tracking')
  .option('--reset', 'Reset cost tracking data')
  .action((options) => {
    const ai = getAISwitch();
    
    if (options.reset) {
      ai.costs.reset();
      console.log(chalk.green('Cost tracking data reset.'));
      return;
    }

    const summary = ai.getCosts();

    console.log(chalk.bold('\nAPI Usage & Costs:\n'));
    console.log(`Total Requests: ${chalk.cyan(summary.totalRequests)}`);
    console.log(`Cache Hits: ${chalk.cyan(summary.cacheHits)}`);
    console.log(`Input Tokens: ${chalk.cyan(summary.totalInputTokens)}`);
    console.log(`Output Tokens: ${chalk.cyan(summary.totalOutputTokens)}`);
    console.log(`Cached Input Tokens: ${chalk.cyan(summary.totalCacheReadTokens)}`);
    console.log(`Total Cost: ${chalk.yellow(`$${summary.totalCost.toFixed(4)}`)}\n`);

    if (summary.byProvider.length > 0) {
      console.log('By Provider:');
      summary.byProvider.forEach(p => {
        const flag = p.unknownPricing ? chalk.yellow(' [unknown pricing]') : '';
        console.log(`  ${chalk.cyan(p.provider)}: $${p.cost.toFixed(4)} (${p.requests} requests, ${p.inputTokens} in / ${p.outputTokens} out / ${p.cacheReadTokens} cached)${flag}`);
        if (p.unknownModels.length > 0) {
          console.log(`      unknown pricing models: ${p.unknownModels.join(', ')} — set costTracking.pricing overrides`);
        }
      });
    }
    console.log('');
  });

// Cache command
const cacheCmd = program
  .command('cache')
  .description('Manage the response cache');
cacheCmd
  .command('clear')
  .description('Clear the response cache')
  .action(async () => {
    const ai = getAISwitch();
    await ai.clearCache();
    console.log(chalk.green('Cache cleared successfully.'));
  });

// Interactive first-run setup
program
  .command('init')
  .description('Interactive first-run setup (detect env keys, ask, validate, configure)')
  .action(async () => {
    try {
      const config = new ConfigManager();
      await runInit({ config });
    } catch (error) {
      console.error(chalk.red('Setup failed:'), error.message);
      process.exit(1);
    }
  });

// Key management
function resolveProviderName(name) {
  const input = String(name || '').toLowerCase();
  if (PROVIDER_ORDER.includes(input)) return input;
  console.error(chalk.red('Error:'), `Unknown provider "${name}". Valid providers: ${PROVIDER_ORDER.join(', ')}`);
  process.exit(1);
  return null;
}

const keysCmd = program
  .command('keys')
  .description('Manage provider API keys (keys are never printed in plaintext)');

keysCmd
  .command('list')
  .description('List providers and where their key comes from (masked)')
  .action(() => {
    const config = new ConfigManager();
    const keys = config.listKeys();

    console.log(chalk.bold('\nAPI Keys:\n'));
    for (const entry of keys) {
      const source = entry.source
        ? chalk.cyan(entry.source)
        : chalk.dim('not configured');
      const envDetail = entry.envVar ? chalk.dim(` (${entry.envVar})`) : '';
      const key = entry.source ? chalk.green(entry.masked) : chalk.dim('—');
      const model = entry.model ? ` ${chalk.dim(entry.model)}` : '';
      console.log(`  ${chalk.cyan(entry.provider.padEnd(10))}${key.padEnd(22)}${source}${envDetail}${model}`);
    }
    console.log(chalk.dim('\nKeys are shown masked. `ai-switch config` for the full effective config.'));
  });

keysCmd
  .command('set <provider>')
  .description('Store an API key for a provider (prompted; never echoed or printed)')
  .action(async (providerName) => {
    const provider = resolveProviderName(providerName);
    const config = new ConfigManager();

    let key;
    try {
      const prompter = new Prompter();
      key = await prompter.hidden(`Enter the ${provider} API key (sk-...): `);
    } catch (error) {
      console.error(chalk.red('Cancelled.'), error.message);
      process.exit(1);
    }

    if (!key) {
      console.error(chalk.red('Error:'), 'No key provided.');
      process.exit(1);
    }

    try {
      config.setKey(provider, key);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }

    const envKey = config.getProviderConfig(provider).apiKeyEnvVar;
    console.log(chalk.green(`✓ Stored API key for ${provider} (${maskKey(key)}).`));
    if (envKey) {
      console.log(chalk.yellow(`  Note: ${envKey} is set in your environment and takes precedence.`));
    }
  });

keysCmd
  .command('remove <provider>')
  .description('Remove a stored API key for a provider (env-var keys are unaffected)')
  .action((providerName) => {
    const provider = resolveProviderName(providerName);
    const config = new ConfigManager();

    if (config.removeKey(provider)) {
      console.log(chalk.green(`✓ Removed stored API key for ${provider}.`));
    } else {
      console.log(chalk.dim(`No stored key for ${provider} to remove.`));
    }

    const eff = config.getProviderConfig(provider);
    if (eff && eff.apiKey) {
      console.log(chalk.yellow(`  Note: ${eff.apiKeyEnvVar || 'an env var'} is still supplying a key for ${provider}.`));
    }
  });

// Effective config (secrets masked)
program
  .command('config')
  .description('Show the effective configuration with secrets masked')
  .action(() => {
    const config = new ConfigManager();
    const view = config.maskedView();
    const providers = config.getAllProviders();
    const hasEnvKey = Object.values(view.providers).some((p) => p.keySource === 'env');

    console.log(chalk.bold('\nEffective configuration'));
    console.log(`  Config file:  ${chalk.cyan(view.configPath)}`);

    if (providers.length === 0 || (!config.hasConfigFile && !hasEnvKey)) {
      console.log(chalk.yellow('\n  Nothing configured yet.') + chalk.cyan(' Run:  ai-switch init'));
      console.log(chalk.dim('  (or export OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY)'));
      return;
    }

    const failover = typeof view.failover === 'object' && view.failover !== null && !Array.isArray(view.failover)
      ? view.failover
      : { enabled: view.failover !== false };
    const order = view.failoverOrder.length > 0 ? view.failoverOrder : providers;

    console.log(`  Default:       ${chalk.bold(view.defaultProvider || '—')}`);
    console.log(`  Failover:      ${failover.enabled ? chalk.green('enabled') : chalk.dim('disabled')} (${order.join(' → ')})`);
    if (view.cache) {
      console.log(`  Cache:         ${view.cache.enabled ? chalk.green('enabled') : chalk.dim('disabled')}${view.cache.ttl ? ` (ttl ${view.cache.ttl}s)` : ''}`);
    }
    console.log(`  Cost tracking: ${view.costTracking && view.costTracking.enabled !== false ? chalk.green('enabled') : chalk.dim('disabled')}`);

    console.log(chalk.bold('\nProviders:'));
    for (const name of PROVIDER_ORDER) {
      const p = view.providers[name];
      if (!p) continue;
      const model = p.model ? p.model : '—';
      const key = p.keySource
        ? `key: ${chalk.green(p.apiKey)} ${chalk.dim(`(${p.keySource}${p.keyEnvVar ? ` ${p.keyEnvVar}` : ''})`)}`
        : chalk.dim('no key');
      const url = p.baseUrl ? chalk.dim(p.baseUrl) : '';
      console.log(`  ${chalk.cyan(name.padEnd(10))} ${model.padEnd(28)} ${key} ${url}`);
    }
    if (!Object.values(view.providers).some((p) => p.keySource)) {
      console.log(chalk.yellow('\n  Hint: set a key with `ai-switch keys set <provider>` or export OPENAI_API_KEY.'));
    }
    console.log('');
  });

// Interactive chat mode
program
  .command('chat')
  .description('Start an interactive chat session')
  .option('-p, --provider <name>', 'Specific provider to use (openai, anthropic, etc.)')
  .option('-m, --model <model>', 'Specific model to use')
  .action((options) => {
    console.log(chalk.bold('\nAI Chat Mode (type "exit" to quit)\n'));

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const ai = getAISwitch();
    const session = ai.createChatSession();

    const askQuestion = () => {
      rl.question(chalk.cyan('You: '), async (prompt) => {
        if (prompt.toLowerCase() === 'exit') {
          rl.close();
          return;
        }

        session.addUser(prompt);

        const spinner = ora('Thinking...').start();
        const { messages, turns, tokens } = session.nextRequest();
        console.log(chalk.dim(`  ↪ sending ${turns} turn${turns === 1 ? '' : 's'} (~${tokens.toLocaleString()} tokens)`));

        try {
          const response = await ai.ask(messages, {
            provider: options.provider,
            model: options.model
          });
          session.addAssistant(response);
          spinner.stop();
          console.log(chalk.green('AI: ') + response + '\n');
        } catch (error) {
          spinner.stop();
          console.error(chalk.red('Error:'), error.message + '\n');
        }
        askQuestion();
      });
    };

    askQuestion();
  });

// Default command - show help
if (process.argv.length === 2) {
  program.parse(['node', 'ai-switch', '--help']);
} else {
  program.parse(process.argv);
}
