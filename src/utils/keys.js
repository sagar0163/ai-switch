/**
 * API key helpers shared by config loading, the `keys`/`config` commands and
 * the `init` wizard.
 *
 * Precedence rule: a key exported in the user's environment wins over a key
 * stored in the config file, so secrets never need to live on disk.
 */

const ENV_KEYS = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY'
};

// Google's Gemini SDK commonly reads GOOGLE_API_KEY; check it as a fallback.
const GOOGLE_ALT_ENV_KEY = 'GOOGLE_API_KEY';

const PROVIDER_ORDER = ['openai', 'anthropic', 'google', 'ollama'];

/**
 * Environment variable names that supply a key for a provider ([] if none).
 * @param {string} provider - Provider name
 * @returns {string[]}
 */
function envVarNames(provider) {
  const names = [];
  const primary = ENV_KEYS[provider];
  if (primary) names.push(primary);
  if (provider === 'google') names.push(GOOGLE_ALT_ENV_KEY);
  return names;
}

/**
 * Resolve the raw key + recorded source for a provider.
 * @param {string} provider - Provider name
 * @param {Object} [cfg] - Provider config object (may carry `apiKey`)
 * @param {Object} [env] - Environment object (defaults to process.env)
 * @returns {{source: 'env'|'config'|null, envVar: string|null, key: string|null}}
 */
function resolveKey(provider, cfg = {}, env = process.env) {
  for (const name of envVarNames(provider)) {
    if (env[name]) {
      return { source: 'env', envVar: name, key: env[name] };
    }
  }
  if (cfg && cfg.apiKey) {
    return { source: 'config', envVar: null, key: cfg.apiKey };
  }
  return { source: null, envVar: null, key: null };
}

/**
 * Mask a secret for display, keeping only the last `visible` characters.
 * @param {string} [key] - Secret value
 * @param {number} [visible] - Characters to reveal at the end
 * @returns {string} Masked value (never the plaintext)
 */
function maskKey(key, visible = 4) {
  if (!key) return '';
  if (key.length <= visible) return '*'.repeat(key.length);
  return '*'.repeat(key.length - visible) + key.slice(-visible);
}

module.exports = { ENV_KEYS, GOOGLE_ALT_ENV_KEY, PROVIDER_ORDER, envVarNames, resolveKey, maskKey };