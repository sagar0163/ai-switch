/**
 * Configuration Manager
 * Handles loading and saving config from ~/.ai-switch/config.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ConfigurationError } = require('./errors');

class ConfigManager {
  constructor(customPath = null) {
    this.configPath = customPath || path.join(os.homedir(), '.ai-switch', 'config.json');
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

  getProviderConfig(name) {
    return this.get(`providers.${name}`);
  }

  getAllProviders() {
    return Object.keys(this.config.providers || {});
  }
}

module.exports = { ConfigManager };
