/**
 * Anthropic Provider
 * Supports Claude 3 models (Opus, Sonnet, Haiku)
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');
const { parseAnthropicUsage } = require('../utils/usage');
const { parseSSE } = require('../utils/stream');

class AnthropicProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'anthropic';
    this.defaultModel = config.model || 'claude-3-opus-20240229';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
  }

  async complete(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    const messages = options.messages || [{ role: 'user', content: prompt }];

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens || 2048
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new ProviderError(
          this._formatError({ message: error.error?.message || `HTTP ${response.status}` }),
          this.name,
          response.status,
          response.headers.get('retry-after')
        );
      }

      const data = await response.json();
      
      if (!data.content?.[0]?.text) {
        throw new ProviderError('Invalid response format from Anthropic', this.name);
      }

      return {
        text: data.content[0].text.trim(),
        usage: parseAnthropicUsage(data)
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error.message, this.name);
    }
  }

  /**
   * Stream text deltas from the Messages API. Usage arrives in the
   * `message_start` (input) and final `message_delta` (output) events.
   */
  async *stream(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    const messages = options.messages || [{ role: 'user', content: prompt }];
    this.streamUsage = null;

    let response;
    try {
      response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens || 2048,
          stream: true
        })
      });
    } catch (error) {
      throw new ProviderError(error.message, this.name);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ProviderError(
        this._formatError({ message: error.error?.message || `HTTP ${response.status}` }),
        this.name,
        response.status,
        response.headers.get('retry-after')
      );
    }

    let inputUsage = null;
    try {
      for await (const event of parseSSE(response)) {
        if (event.type === 'message_start' && event.message?.usage) {
          inputUsage = event.message.usage;
        } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          yield event.delta.text;
        } else if (event.type === 'message_delta' && event.usage) {
          this.streamUsage = parseAnthropicUsage({ model, usage: { ...(inputUsage || {}), ...event.usage } });
        } else if (event.type === 'error' && event.error) {
          throw new ProviderError(event.error.message || 'Anthropic stream error', this.name);
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error.message, this.name);
    }
  }
}

module.exports = { AnthropicProvider };
