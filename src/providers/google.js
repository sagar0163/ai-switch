/**
 * Google AI Provider
 * Supports Gemini Pro and Gemini Pro Vision
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');

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
    
    try {
      const response = await fetch(
        `${this.baseUrl}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: prompt }]
            }],
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
          response.status
        );
      }

      const data = await response.json();
      
      if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new ProviderError('Invalid response format from Google AI', this.name);
      }

      return data.candidates[0].content.parts[0].text.trim();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error.message, this.name);
    }
  }
}

module.exports = { GoogleProvider };
