/**
 * Google AI Provider
 * Supports Gemini Pro and Gemini Pro Vision
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');
const { parseGoogleUsage } = require('../utils/usage');
const { forEachSSEEvent, StreamController } = require('../utils/stream');

class GoogleProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'google';
    this.defaultModel = config.model || 'gemini-pro';
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  async complete(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    const apiKey = this.config.apiKey;
    const messages = options.messages || [{ role: 'user', content: prompt }];
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    try {
      const response = await fetch(
        `${this.baseUrl}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: options.temperature ?? 0.7,
              maxOutputTokens: options.maxTokens || 2048
            }
          })
        }
      );

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
      
      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new ProviderError('Invalid response format from Google AI', this.name);
      }

      return {
        text: data.candidates[0].content.parts[0].text.trim(),
        usage: parseGoogleUsage(data, model)
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error.message, this.name);
    }
  }

  /**
   * Stream a completion, emitting tokens via onToken as they arrive.
   * Uses streamGenerateContent?alt=sse; Gemini chunks carry the cumulative text
   * for a candidate, so a suffix-based dedupe turns them into deltas.
   * @param {string} prompt - The prompt
   * @param {Object} options - Request options
   * @param {(fragment: string) => void} onToken - Token callback
   * @returns {Promise<{text: string, usage: Object}>} Aggregated response
   */
  async streamComplete(prompt, options = {}, onToken) {
    const model = options.model || this.defaultModel;
    const apiKey = this.config.apiKey;
    const messages = options.messages || [{ role: 'user', content: prompt }];
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const controller = new StreamController({ provider: this.name, onToken });

    const response = await fetch(
      `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: options.temperature ?? 0.7,
            maxOutputTokens: options.maxTokens || 2048
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ProviderError(
        this._formatError({ message: error.error?.message || `HTTP ${response.status}` }),
        this.name,
        response.status,
        response.headers.get('retry-after')
      );
    }

    let usageMetadata = null;
    let lastFull = '';

    await forEachSSEEvent(response, ({ data }) => {
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        controller.fail('Invalid stream chunk from Google AI');
        return;
      }

      if (chunk.error) {
        controller.fail(chunk.error.message || 'Google AI stream error');
        return;
      }

      if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;

      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return;

      for (const part of parts) {
        const text = part.text || '';
        if (text.length >= lastFull.length && text.startsWith(lastFull) && lastFull.length > 0) {
          const delta = text.slice(lastFull.length);
          lastFull = text;
          controller.push(delta);
        } else if (text !== lastFull) {
          lastFull = text;
          controller.push(text);
        }
      }
    });

    if (controller.text.length === 0) {
      throw new ProviderError('Invalid response format from Google AI', this.name);
    }

    return {
      text: controller.text.trim(),
      usage: parseGoogleUsage({ usageMetadata }, model)
    };
  }
}

module.exports = { GoogleProvider };
