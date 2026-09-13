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
   *
   * When `options.stream` is true (and the provider supports it) the response
   * is consumed incrementally: each text delta is passed to `options.onToken`,
   * and `options.onResult` receives `{ provider, model, text, usage, stream, cache }`
   * once the request completes (or short-circuits on a cache hit).
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
      stream,
      onToken,
      onResult
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
        if (onResult) {
          onResult({
            provider: preferredProvider || 'cache',
            model: null,
            text: cached,
            usage: null,
            stream: false,
            cache: true
          });
        }
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
        const callOptions = {
          model: requestedModel,
          temperature: temperature ?? 0.7,
          maxTokens: maxTokens || 2048,
          messages: trimmed
        };

        let text;
        let usage = null;
        const useStream = stream && typeof provider.stream === 'function';

        if (useStream) {
          const collected = await this._runStream(provider, currentPrompt, callOptions, onToken);
          text = collected.text;
          usage = collected.usage;
        } else {
          const result = await provider.complete(currentPrompt, callOptions);
          text = typeof result === 'string' ? result : result?.text ?? '';
          usage = typeof result === 'object' && result ? result.usage : null;
        }

        this.providers.recordSuccess(provider.name);

        // Cache the response
        if (this.cache.isEnabled()) {
          await this.cache.set(cacheKey, text, preferredProvider || provider.name);
        }

        // Track cost from real provider usage
        this.costs.record(provider.name, usage, { model: requestedModel });

        if (onResult) {
          onResult({
            provider: provider.name,
            model: requestedModel,
            text,
            usage,
            stream: useStream,
            cache: false
          });
        }

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
   * Consume a provider's stream, forwarding text deltas to `onToken` and
   * returning the completed text plus any streamed usage. Partial text from a
   * provider that fails mid-stream is discarded by throwing — the caller's
   * failover loop handles it.
   * @param {Object} provider - Provider instance
   * @param {string} prompt - The prompt
   * @param {Object} options - Call options passed to the provider
   * @param {Function} [onToken] - Callback invoked with each text delta
   * @returns {Promise<{text: string, usage: Object|null}>}
   */
  async _runStream(provider, prompt, options, onToken) {
    let text = '';
    let usage = null;
    let streamed = false;

    for await (const evt of provider.stream(prompt, options)) {
      if (!evt) continue;
      if (typeof evt.delta === 'string' && evt.delta.length > 0) {
        streamed = true;
        if (onToken) onToken(evt.delta);
        text += evt.delta;
      } else if (evt.done) {
        if (typeof evt.text === 'string') text = evt.text;
        if (evt.usage) usage = evt.usage;
        break;
      }
    }

    if (!streamed && !text) {
      throw new AIError('Provider returned an empty stream', provider.name);
    }

    return { text, usage };
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
