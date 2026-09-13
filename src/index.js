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
    this.config = new ConfigManager(options.configPath);
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
      maxTokens,
      stream = false,
      onToken = null,
      json = false
    } = options;

    const messages = normalizeMessages(request);
    const currentPrompt = messages[messages.length - 1].content;
    const trimmed = trimMessages(messages, {
      maxTurns: options.maxTurns ?? this.chatConfig.maxTurns,
      maxContextTokens: options.maxContextTokens ?? this.chatConfig.maxContextTokens
    });

    // Cache key covers the full context (flat prompt or serialized history).
    // Namespace the cache per explicit provider, or use a shared bucket when none
    // is given, so the get/set keys always agree and a cache hit can short-circuit.
    const cacheProvider = preferredProvider || 'any';
    const cacheKey = typeof request === 'string' ? request : JSON.stringify(trimmed);

    // Streaming composes with caching: a cache hit short-circuits without streaming,
    // since the full response is already known.
    if (this.cache.isEnabled()) {
      const cached = await this.cache.get(cacheKey, cacheProvider);
      if (cached) {
        this.costs.recordCacheHit(preferredProvider || 'cache');
        return json ? { text: cached, provider: preferredProvider || 'cache', usage: null } : cached;
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
        const method = stream && typeof provider.streamComplete === 'function'
          ? provider.streamComplete.bind(provider)
          : provider.complete.bind(provider);
        const result = await method(currentPrompt, {
          model: requestedModel,
          temperature: temperature ?? 0.7,
          maxTokens: maxTokens || 2048,
          messages: trimmed
        }, onToken);

        this.providers.recordSuccess(provider.name);

        const text = typeof result === 'string' ? result : result?.text ?? '';
        const usage = typeof result === 'object' && result ? result.usage : null;

        // Cache the response
        if (this.cache.isEnabled()) {
          await this.cache.set(cacheKey, text, cacheProvider);
        }

        // Track cost from real provider usage
        this.costs.record(provider.name, usage, { model: requestedModel });

        return json
          ? { text, provider: provider.name, model: requestedModel, usage }
          : text;
      } catch (error) {
        lastError = error;
        const retryAfter = typeof error.retryAfter === 'number' && error.retryAfter > 0
          ? error.retryAfter
          : null;
        this.providers.recordFailure(provider.name, retryAfter);

        // If some tokens already streamed to the user, do NOT fail over: splicing
        // another provider's text onto the partial output would dump garbage.
        if (error.partial) {
          throw new AIError(
            `Stream from "${provider.name}" failed mid-stream after partial output: ${error.message}`,
            provider.name
          );
        }

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
