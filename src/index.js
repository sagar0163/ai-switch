/**
 * AI-Switch - Unified AI LLM Interface
 * Main entry point
 */

const { ConfigManager } = require('./utils/config');
const { CacheManager } = require('./utils/cache');
const { CostTracker } = require('./utils/costTracker');
const { ProviderManager } = require('./providers/manager');
const { AIError } = require('./utils/errors');

class AISwitch {
  constructor(options = {}) {
    this.config = new ConfigManager(options.configPath);
    this.cache = new CacheManager(this.config.get('cache'));
    this.costs = new CostTracker(this.config.get('costTracking'));
    this.providers = new ProviderManager(this.config, this.cache, this.costs);
  }

  /**
   * Send a query to an AI provider
   * @param {string} prompt - The prompt/question
   * @param {Object} options - Provider and request options
   * @returns {Promise<string>} The AI response
   */
  async ask(prompt, options = {}) {
    const { provider: preferredProvider, model, temperature, maxTokens } = options;

    // Check cache first
    if (this.cache.isEnabled()) {
      const cached = await this.cache.get(prompt, preferredProvider);
      if (cached) {
        return cached;
      }
    }

    // Get provider instance
    const aiProvider = preferredProvider 
      ? this.providers.getProvider(preferredProvider)
      : this.providers.getBestAvailable();

    try {
      const response = await aiProvider.complete(prompt, {
        model: model || aiProvider.defaultModel,
        temperature: temperature ?? 0.7,
        maxTokens: maxTokens || 2048
      });

      // Cache the response
      if (this.cache.isEnabled()) {
        await this.cache.set(prompt, response, preferredProvider);
      }

      // Track cost
      this.costs.record(aiProvider.name, response);

      return response;
    } catch (error) {
      // Handle failover
      if (this.config.get('failover') && !options._retrying) {
        const backup = this.providers.getBackup(aiProvider.name);
        if (backup) {
          console.warn(`Primary provider failed, trying backup: ${backup.name}`);
          return this.ask(prompt, { ...options, provider: backup.name, _retrying: true });
        }
      }
      throw new AIError(`Failed to get response: ${error.message}`, aiProvider.name);
    }
  }

  /**
   * List all configured providers
   * @returns {Array} Provider info
   */
  listProviders() {
    return this.providers.listProviders();
  }

  /**
   * Get cost summary
   * @returns {Object} Cost tracking data
   */
  getCosts() {
    return this.costs.getSummary();
  }

  /**
   * Clear response cache
   */
  async clearCache() {
    await this.cache.clear();
  }
}

module.exports = { AISwitch };
