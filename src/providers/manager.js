/**
 * Provider Manager
 * Manages AI provider instances and failover
 */

const { OpenAIProvider } = require('./openai');
const { AnthropicProvider } = require('./anthropic');
const { GoogleProvider } = require('./google');
const { OllamaProvider } = require('./ollama');

class ProviderManager {
  constructor(config, cache, costs) {
    this.config = config;
    this.cache = cache;
    this.costs = costs;
    this.providers = this._initializeProviders();
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

  getBestAvailable() {
    const defaultProvider = this.config.get('defaultProvider');
    
    if (defaultProvider && this.providers[defaultProvider]) {
      return this.providers[defaultProvider];
    }

    // Return first available provider
    const available = Object.values(this.providers);
    if (available.length === 0) {
      throw new Error('No AI providers configured. Please set up at least one provider.');
    }
    
    return available[0];
  }

  getBackup(excludeName) {
    const available = Object.values(this.providers).filter(p => p.name !== excludeName);
    return available.length > 0 ? available[0] : null;
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
