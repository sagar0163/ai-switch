/**
 * Anthropic Provider
 * Supports Claude 3 models (Opus, Sonnet, Haiku)
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');
const { parseAnthropicUsage } = require('../utils/usage');
const { forEachSSEEvent, StreamController } = require('../utils/stream');

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
   * Stream a completion, emitting tokens via onToken as they arrive.
   * @param {string} prompt - The prompt
   * @param {Object} options - Request options
   * @param {(fragment: string) => void} onToken - Token callback
   * @returns {Promise<{text: string, usage: Object}>} Aggregated response
   */
  async streamComplete(prompt, options = {}, onToken) {
    const model = options.model || this.defaultModel;
    const messages = options.messages || [{ role: 'user', content: prompt }];
    const controller = new StreamController({ provider: this.name, onToken });

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Accept': 'text/event-stream'
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

    let message = null;

    await forEachSSEEvent(response, ({ data }) => {
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        controller.fail('Invalid stream chunk from Anthropic');
        return;
      }

      if (chunk.type === 'error') {
        controller.fail(chunk.error?.message || chunk.message || 'Anthropic stream error');
        return;
      }

      if (chunk.type === 'message_start') {
        message = chunk.message;
      } else if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        controller.push(chunk.delta.text);
      } else if (chunk.type === 'message_delta' && chunk.usage) {
        message = { ...(message || {}), usage: { ...(message?.usage || {}), ...chunk.usage } };
      }
    });

    if (controller.text.length === 0) {
      throw new ProviderError('Invalid response format from Anthropic', this.name);
    }

    return {
      text: controller.text.trim(),
      usage: parseAnthropicUsage(message || {})
    };
  }
}

module.exports = { AnthropicProvider };
