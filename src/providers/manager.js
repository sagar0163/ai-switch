/**
 * Provider Manager
 * Manages AI provider instances, ordered failover, and per-provider cooldowns
 */

const { OpenAIProvider } = require('./openai');
const { AnthropicProvider } = require('./anthropic');
const { GoogleProvider } = require('./google');
const { OllamaProvider } = require('./ollama');

const DEFAULT_MAX_FAILURES = 3;
const DEFAULT_COOLDOWN_SECONDS = 60;

class ProviderManager {
  constructor(config, cache, costs) {
    this.config = config;
    this.cache = cache;
    this.costs = costs;
    this.providers = this._initializeProviders();
    this._failures = {};
  }

  _initializeProviders() {
    const providers = {};

    const configs = {
      openai: this.config.getProviderConfig('openai'),
      anthropic: this.config.getProviderConfig('anthropic'),
      google: this.config.getProviderConfig('google'),
      ollama: this.config.getProviderConfig('ollama')
    };

    if (configs.openai?.apiKey) {
      providers.openai = new OpenAIProvider(configs.openai);
    }
    if (configs.anthropic?.apiKey) {
      providers.anthropic = new AnthropicProvider(configs.anthropic);
    }
    if (configs.google?.apiKey) {
      providers.google = new GoogleProvider(configs.google);
    }
    if (configs.ollama?.baseUrl) {
      providers.ollama = new OllamaProvider(configs.ollama);
    }

    return providers;
  }

  getProvider(name) {
    if (!this.providers[name]) {
      throw new Error(`Provider "${name}" not configured or not available`);
    }
    return this.providers[name];
  }

  /**
   * Parse the `failover` config setting into normalized options.
   * Supports: boolean, array (provider order), or object ({ enabled, order, maxFailures, cooldownSeconds }).
   * @returns {{enabled: boolean, order: string[], maxFailures: number, cooldownSeconds: number}}
   */
  getFailoverSettings() {
    const raw = this.config.get('failover');

    if (raw === undefined || raw === null || raw === true) {
      return { enabled: raw !== false, order: [], maxFailures: DEFAULT_MAX_FAILURES, cooldownSeconds: DEFAULT_COOLDOWN_SECONDS };
    }
    if (Array.isArray(raw)) {
      return { enabled: true, order: raw, maxFailures: DEFAULT_MAX_FAILURES, cooldownSeconds: DEFAULT_COOLDOWN_SECONDS };
    }
    if (typeof raw === 'object') {
      return {
        enabled: raw.enabled !== false,
        order: Array.isArray(raw.order) ? raw.order : [],
        maxFailures: typeof raw.maxFailures === 'number' && raw.maxFailures > 0 ? raw.maxFailures : DEFAULT_MAX_FAILURES,
        cooldownSeconds: typeof raw.cooldownSeconds === 'number' && raw.cooldownSeconds > 0 ? raw.cooldownSeconds : DEFAULT_COOLDOWN_SECONDS
      };
    }
    return { enabled: raw !== false, order: [], maxFailures: DEFAULT_MAX_FAILURES, cooldownSeconds: DEFAULT_COOLDOWN_SECONDS };
  }

  /**
   * Resolve the ordered list of providers to try, in priority order:
   * preferred -> primary -> backup -> config failover chain -> default provider -> configured order.
   * Providers that are not configured/available are skipped. `.getOrder()` picks the configured order.
   * @param {{preferred?: string, primary?: string, backup?: string}} [opts]
   * @returns {Array} Provider instances in the order they should be attempted
   */
  getOrder(opts = {}) {
    const settings = this.getFailoverSettings();
    const order = [];
    const seen = new Set();

    const push = (name) => {
      if (!name || seen.has(name) || !this.providers[name]) return;
      seen.add(name);
      order.push(name);
    };

    push(opts.preferred);
    push(opts.primary);
    push(opts.backup);
    for (const name of settings.order) push(name);

    const defaultProvider = this.config.get('defaultProvider');
    if (defaultProvider) push(defaultProvider);
    for (const name of Object.keys(this.providers)) push(name);

    return order.map((name) => this.providers[name]);
  }

  getBestAvailable() {
    const ordered = this.getOrder();
    if (ordered.length === 0) {
      throw new Error('No AI providers configured. Please set up at least one provider.');
    }
    return ordered[0];
  }

  /**
   * Get the first backup provider, honoring an explicit provider order when given.
   * @param {string} excludeName - Provider to exclude
   * @param {string[]} [preferredOrder] - Explicit provider order to honor
   * @returns {Object|null} Backup provider instance or null
   */
  getBackup(excludeName, preferredOrder = null) {
    const orderedNames = (preferredOrder && preferredOrder.length > 0)
      ? preferredOrder
      : this.getOrder().map((p) => p.name);

    for (const name of orderedNames) {
      if (name !== excludeName && this.providers[name]) {
        return this.providers[name];
      }
    }
    return null;
  }

  /**
   * Record a consecutive failure for a provider and compute its cooldown state.
   * An explicit `Retry-After` value takes precedence over the configured cooldown window.
   * @param {string} name - Provider name
   * @param {number} [retryAfterSeconds] - Seconds to back off (from Retry-After)
   */
  recordFailure(name, retryAfterSeconds) {
    if (!this.providers[name]) return;

    const settings = this.getFailoverSettings();
    const state = this._failures[name] || { count: 0, until: 0 };
    state.count += 1;
    state.lastErrorAt = Date.now();

    if (typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0) {
      state.until = Date.now() + Math.round(retryAfterSeconds * 1000);
      state.retryAfter = retryAfterSeconds;
    } else if (state.count >= settings.maxFailures) {
      state.until = Date.now() + settings.cooldownSeconds * 1000;
      state.retryAfter = null;
    }

    this._failures[name] = state;
  }

  /**
   * Reset failure tracking after a successful call.
   */
  recordSuccess(name) {
    this._failures[name] = { count: 0, until: 0 };
  }

  /**
   * Whether the provider is currently in its cooldown window.
   */
  isInCooldown(name) {
    const state = this._failures[name];
    if (!state) return false;
    if (state.until <= Date.now()) {
      state.until = 0;
      return false;
    }
    return true;
  }

  /**
   * Remaining cooldown in seconds for a provider (0 if not cooling down).
   */
  getCooldownRemaining(name) {
    const state = this._failures[name];
    if (!state) return 0;
    return Math.max(0, Math.ceil((state.until - Date.now()) / 1000));
  }

  listProviders() {
    const defaultProvider = this.config.get('defaultProvider');

    return Object.entries(this.providers).map(([name, provider]) => ({
      name,
      model: provider.defaultModel,
      available: true,
      isDefault: name === defaultProvider
    }));
  }
}

module.exports = { ProviderManager };