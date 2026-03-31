/**
 * Anthropic Provider
 * Supports Claude 3 models (Opus, Sonnet, Haiku)
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');

class AnthropicProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'anthropic';
    this.defaultModel = config.model || 'claude-3-opus-20240229';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
  }

  async complete(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    
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
          messages: [{ role: 'user', content: prompt }],
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens || 2048
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new ProviderError(
          this._formatError({ message: error.error?.message || `HTTP ${response.status}` }),
          this.name,
          response.status
        );
      }

      const data = await response.json();
      
      if (!data.content?.[0]?.text) {
        throw new ProviderError('Invalid response format from Anthropic', this.name);
      }

      return data.content[0].text.trim();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error.message, this.name);
    }
  }
}

module.exports = { AnthropicProvider };
