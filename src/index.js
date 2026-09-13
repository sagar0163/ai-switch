/**
 * AI-Switch - Unified AI LLM Interface
 * Main entry point
 */

const { ConfigManager } = require('./utils/config');
const { CacheManager } = require('./utils/cache');
const { CostTracker } = require('./utils/costTracker');
const { ProviderManager } = require('./providers/manager');
const { AIError } = require('./utils/errors');
const { normalizeMessages, trimMessages } = require('./utils/messages');
const { ChatSession } = require('./utils/chatSession');

class AISwitch {
  constructor(options = {}) {
    this.config = new ConfigManager({ configPath: options.configPath, env: options.env });
    this.cache = new CacheManager(this.config.get('cache'));
    this.costs = new CostTracker(this.config.get('costTracking'));
    this.providers = new ProviderManager(this.config, this.cache, this.costs);
    this.chatConfig = this.config.get('chat') || {};
  }

  /**
   * Create a chat session wired to the configured history caps.
   * @param {Object} [options] - Overrides for maxTurns / maxContextTokens
   * @returns {ChatSession}
   */
  createChatSession(options = {}) {
    return new ChatSession({ ...this.chatConfig, ...options });
  }

  /**
   * Send a query to an AI provider, failing over in explicit order.
   * Accepts a flat prompt string (single-shot) or a full messages array
   * (system/user/assistant) for multi-turn chat.
   * @param {string|Array} request - Prompt string or messages array
   * @param {Object} options - Provider and request options
   * @returns {Promise<string>} The AI response
   */
  async ask(request, options = {}) {
    const {
      provider: preferredProvider,
      primary,
      backup,
      model,
      temperature,
      maxTokens
    } = options;

    const messages = normalizeMessages(request);
    const currentPrompt = messages[messages.length - 1].content;
    const trimmed = trimMessages(messages, {
      maxTurns: options.maxTurns ?? this.chatConfig.maxTurns,
      maxContextTokens: options.maxContextTokens ?? this.chatConfig.maxContextTokens
    });

    // Cache key covers the full context (flat prompt or serialized history)
    const cacheKey = typeof request === 'string' ? request : JSON.stringify(trimmed);

    // Check cache first
    if (this.cache.isEnabled()) {
      const cached = await this.cache.get(cacheKey, preferredProvider);
      if (cached) {
        this.costs.recordCacheHit(preferredProvider || 'cache');
        return cached;
      }
    }

    const settings = this.providers.getFailoverSettings();
    const failoverEnabled = settings.enabled || Boolean(primary) || Boolean(backup);

    // Ordered failover chain: preferred -> primary -> backup -> config chain -> default order
    const providerOrder = this.providers.getOrder({
      preferred: preferredProvider,
      primary,
      backup
    });

    if (providerOrder.length === 0) {
      throw new AIError('No AI providers configured. Please set up at least one provider.');
    }

    const candidates = failoverEnabled ? providerOrder : providerOrder.slice(0, 1);
    let lastError = null;

    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i];

      // Skip providers stuck in their cooldown window (circuit open)
      if (this.providers.isInCooldown(provider.name)) {
        continue;
      }

      // Next provider that will actually be attempted (not in cooldown)
      let successor = null;
      for (let j = i + 1; j < candidates.length; j++) {
        if (!this.providers.isInCooldown(candidates[j].name)) {
          successor = candidates[j];
          break;
        }
      }

      try {
        const requestedModel = model || provider.defaultModel;
        const result = await provider.complete(currentPrompt, {
          model: requestedModel,
          temperature: temperature ?? 0.7,
          maxTokens: maxTokens || 2048,
          messages: trimmed
        });

        this.providers.recordSuccess(provider.name);

        const text = typeof result === 'string' ? result : result?.text ?? '';
        const usage = typeof result === 'object' && result ? result.usage : null;

        // Cache the response
        if (this.cache.isEnabled()) {
          await this.cache.set(cacheKey, text, preferredProvider || provider.name);
        }

        // Track cost from real provider usage
        this.costs.record(provider.name, usage, { model: requestedModel });

        return text;
      } catch (error) {
        lastError = error;
        const retryAfter = typeof error.retryAfter === 'number' && error.retryAfter > 0
          ? error.retryAfter
          : null;
        this.providers.recordFailure(provider.name, retryAfter);

        if (successor) {
          const reason = retryAfter ? ` (Retry-After: ${retryAfter}s)` : '';
          console.warn(`[ai-switch] Provider "${provider.name}" failed${reason}; failing over to "${successor.name}"`);
        }
      }
    }

    throw new AIError(
      `Failed to get response${lastError?.provider ? ` from ${lastError.provider}` : ''}: ${lastError?.message ?? 'all providers failed'}`,
      lastError?.provider || 'unknown'
    );
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
