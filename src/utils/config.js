/**
 * Configuration Manager
 * Handles loading and saving config from ~/.ai-switch/config.json
 *
 * API-key resolution follows env-var precedence: a key exported in the
 * environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) wins
 * over a key stored in the config file at read time.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigurationError } = require('./errors');
const { PROVIDER_ORDER, resolveKey, maskKey } = require('./keys');

class ConfigManager {
  constructor(customPath = null, env = null) {
    if (customPath && typeof customPath === 'object') {
      this.configPath = customPath.configPath || path.join(os.homedir(), '.ai-switch', 'config.json');
      this.env = customPath.env || process.env;
    } else {
      this.configPath = customPath || path.join(os.homedir(), '.ai-switch', 'config.json');
      this.env = env || process.env;
    }
    this.config = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      throw new ConfigurationError(`Failed to load config: ${error.message}`);
    }
    
    // Return defaults if no config exists
    return this._defaults();
  }

  _defaults() {
    return {
      providers: {
        openai: {
          apiKey: process.env.OPENAI_API_KEY || '',
          model: 'gpt-4',
          baseUrl: 'https://api.openai.com/v1'
        },
        anthropic: {
          apiKey: process.env.ANTHROPIC_API_KEY || '',
          model: 'claude-3-opus-20240229',
          baseUrl: 'https://api.anthropic.com/v1'
        }
      },
      cache: {
        enabled: true,
        ttl: 3600,
        maxSize: 1000
      },
      chat: {
        maxTurns: 20,
        maxContextTokens: 4000
      },
      failover: true,
      costTracking: {
        enabled: true,
        storagePath: path.join(os.homedir(), '.ai-switch', 'costs.json')
      },
      defaultProvider: 'openai'
    };
  }

  get(key, defaultValue = null) {
    const keys = key.split('.');
    let value = this.config;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }
    
    return value;
  }

  set(key, value) {
    const keys = key.split('.');
    let target = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in target) || typeof target[k] !== 'object') {
        target[k] = {};
      }
      target = target[k];
    }
    
    target[keys[keys.length - 1]] = value;
    this._save();
  }

  _save() {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }

  /**
   * Read a provider config with env-var key precedence applied.
   * The returned object carries `apiKeySource` (`'env'` or `'config'`) so
   * callers/UI can show where a key came from without printing it.
   * @param {string} name - Provider name
   * @returns {Object|null} Provider config (resolved) or null
   */
  getProviderConfig(name) {
    const cfg = this.get(`providers.${name}`);
    if (!cfg || typeof cfg !== 'object') return cfg;

const resolved = { ...cfg };
    const keyInfo = resolveKey(name, cfg, this.env);
    if (keyInfo.key) {
      resolved.apiKey = keyInfo.key;
      resolved.apiKeySource = keyInfo.source;
    }
    if (keyInfo.source === 'env' && keyInfo.envVar) {
      resolved.apiKeyEnvVar = keyInfo.envVar;
    }
    return resolved;
  }

  /**
   * Replace the whole config and persist it (used by `ai-switch init`).
   * @param {Object} config - New config object
   */
  replace(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new ConfigurationError('Cannot replace config with a non-object');
    }
    this.config = config;
    this._save();
    return this.config;
  }

  /**
   * Store a provider API key in the config file. The key is never returned by
   * this method and callers must never print it.
   * @param {string} provider - Provider name
   * @param {string} apiKey - Key to persist
   */
  setKey(provider, apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new ConfigurationError(`No API key provided for "${provider}"`);
    }
    this.set(`providers.${provider}.apiKey`, apiKey.trim());
  }

  /**
   * Remove a provider API key from the config file. Env-var keys are not
   * affected (they win at read time regardless).
   * @param {string} provider - Provider name
   * @returns {boolean} True if a stored key existed and was removed
   */
  removeKey(provider) {
    const cfg = this.get(`providers.${provider}`);
    if (cfg && typeof cfg === 'object' && 'apiKey' in cfg) {
      delete cfg.apiKey;
      this._save();
      return true;
    }
    return false;
  }

  /**
   * Key inventory for the `keys list` command — sources + masked values only.
   * @returns {Array} { provider, source, envVar, masked, model } per provider
   */
  listKeys() {
    return PROVIDER_ORDER.map((name) => {
      const cfg = this.get(`providers.${name}`);
      const keyInfo = resolveKey(name, cfg || {}, this.env);
      return {
        provider: name,
        source: keyInfo.source,
        envVar: keyInfo.envVar,
        masked: maskKey(keyInfo.key),
        model: cfg && cfg.model ? cfg.model : null,
        baseUrl: cfg && cfg.baseUrl ? cfg.baseUrl : null
      };
    });
  }

  /**
   * Effective config view for `ai-switch config`, with secrets masked and key
   * precedence resolved. Never contains a plaintext key.
   * @returns {Object} Masked view
   */
  maskedView() {
    const providers = {};
    for (const entry of this.listKeys()) {
      providers[entry.provider] = {
        model: entry.model,
        baseUrl: entry.baseUrl,
        keySource: entry.source,
        keyEnvVar: entry.envVar,
        apiKey: entry.source ? entry.masked : null
      };
    }

    const failoverCfg = this.get('failover');
    const failoverOrder = Array.isArray(failoverCfg)
      ? failoverCfg
      : (failoverCfg && typeof failoverCfg === 'object' && Array.isArray(failoverCfg.order)
        ? failoverCfg.order
        : []);

    return {
      configPath: this.configPath,
      providers,
      defaultProvider: this.config.defaultProvider || null,
      failover: failoverCfg,
      failoverOrder,
      cache: this.config.cache || null,
      chat: this.config.chat || null,
      costTracking: this.config.costTracking
        ? { ...this.config.costTracking, pricing: undefined }
        : null
    };
  }

  getAllProviders() {
    return Object.keys(this.config.providers || {});
  }
}

module.exports = { ConfigManager };
