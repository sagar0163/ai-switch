/**
 * OpenAI Provider
 * Supports GPT-4, GPT-3.5-Turbo, and other OpenAI models
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');
const { parseOpenAIUsage } = require('../utils/usage');
const { parseSSE } = require('../utils/sse');

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
   * Stream a completion via the SSE chat/completions endpoint.
   * @param {string} prompt - The prompt
   * @param {Object} options - Request options
   * @returns {AsyncGenerator<Object>} `{ delta }` events then `{ done, text, usage, model }`
   */
  async *stream(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    const messages = options.messages || [{ role: 'user', content: prompt }];

    let text = '';
    let usage = null;

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

      for await (const event of parseSSE(response)) {
        if (event.usage) {
          usage = parseOpenAIUsage({ model, usage: event.usage });
        }
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          yield { delta };
        }
      }

      if (!text) {
        throw new ProviderError('Invalid stream response format from OpenAI', this.name);
      }

      yield { done: true, text: text.trim(), usage, model };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error.message, this.name);
    }
  }
}

module.exports = { OpenAIProvider };
