/**
 * Anthropic Provider
 * Supports Claude 3 models (Opus, Sonnet, Haiku)
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');
const { parseAnthropicUsage } = require('../utils/usage');
const { parseSSE } = require('../utils/sse');

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
   * Stream a completion via the SSE messages endpoint.
   * @param {string} prompt - The prompt
   * @param {Object} options - Request options
   * @returns {AsyncGenerator<Object>} `{ delta }` events then `{ done, text, usage, model }`
   */
  async *stream(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    const messages = options.messages || [{ role: 'user', content: prompt }];

    let text = '';
    let usageData = {};

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
          max_tokens: options.maxTokens || 2048,
          stream: true
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

      for await (const event of parseSSE(response)) {
        if (event.type === 'error' || event.error) {
          const message = event.error?.message || 'Anthropic stream error';
          throw new ProviderError(message, this.name);
        }
        if (event.type === 'message_start' && event.message?.usage) {
          usageData.input_tokens = event.message.usage.input_tokens ?? 0;
        }
        if (event.type === 'message_delta' && event.usage?.output_tokens != null) {
          usageData.output_tokens = event.usage.output_tokens;
        }
        const delta = event.type === 'content_block_delta'
          && event.delta?.type === 'text_delta'
          ? event.delta.text
          : null;
        if (delta) {
          text += delta;
          yield { delta };
        }
        if (event.type === 'error_event') {
          throw new ProviderError('Anthropic stream interrupted', this.name);
        }
      }

      if (!text) {
        throw new ProviderError('Invalid stream response format from Anthropic', this.name);
      }

      yield {
        done: true,
        text: text.trim(),
        usage: parseAnthropicUsage({ model, usage: usageData }),
        model
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error.message, this.name);
    }
  }
}

module.exports = { AnthropicProvider };
