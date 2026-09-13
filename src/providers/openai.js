/**
 * OpenAI Provider
 * Supports GPT-4, GPT-3.5-Turbo, and other OpenAI models
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');
const { parseOpenAIUsage } = require('../utils/usage');
const { forEachSSEEvent, StreamController } = require('../utils/stream');

class OpenAIProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'openai';
    this.defaultModel = config.model || 'gpt-4';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  }

  async complete(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    const messages = options.messages || [{ role: 'user', content: prompt }];

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
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
      
      if (!data.choices?.[0]?.message?.content) {
        throw new ProviderError('Invalid response format from OpenAI', this.name);
      }

      return {
        text: data.choices[0].message.content.trim(),
        usage: parseOpenAIUsage(data)
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
    try {
      return await this._streamComplete(prompt, options, onToken);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error.message, this.name);
    }
  }

  async _streamComplete(prompt, options = {}, onToken) {
    const model = options.model || this.defaultModel;
    const messages = options.messages || [{ role: 'user', content: prompt }];
    const controller = new StreamController({ provider: this.name, onToken });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens || 2048,
        stream: true,
        stream_options: { include_usage: true }
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

    let usage = null;
    await forEachSSEEvent(response, ({ data }) => {
      if (data === '[DONE]') return;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        controller.fail('Invalid stream chunk from OpenAI');
        return;
      }

      if (chunk.error) {
        controller.fail(chunk.error.message || 'OpenAI stream error', chunk.error.status);
        return;
      }

      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) controller.push(delta);
      if (chunk.usage) usage = chunk.usage;
    });

    if (controller.text.length === 0) {
      throw new ProviderError('Invalid response format from OpenAI', this.name);
    }

    return {
      text: controller.text.trim(),
      usage: parseOpenAIUsage({ model, usage })
    };
  }
}

module.exports = { OpenAIProvider };
