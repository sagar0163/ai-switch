/**
 * Google AI Provider
 * Supports Gemini Pro and Gemini Pro Vision
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');
const { parseGoogleUsage } = require('../utils/usage');

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
}

module.exports = { GoogleProvider };
