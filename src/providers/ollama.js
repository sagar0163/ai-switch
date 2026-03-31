/**
 * Ollama Provider
 * Supports local LLM models via Ollama API
 * 
 * Install Ollama: https://ollama.ai
 * Pull models: ollama pull llama2, ollama pull mistral, etc.
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');

class OllamaProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'ollama';
    this.defaultModel = config.model || 'llama2';
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  /**
   * Check if Ollama server is running
   */
  async isAvailable() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async complete(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    
    try {
      // Check availability first
      const available = await this.isAvailable();
      if (!available) {
        throw new ProviderError(
          'Ollama server not running. Start with: ollama serve',
          this.name
        );
      }

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens || 2048
          }
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new ProviderError(
          this._formatError({ message: error.error || `HTTP ${response.status}` }),
          this.name,
          response.status
        );
      }

      const data = await response.json();
      
      if (!data.response) {
        throw new ProviderError('No response from Ollama', this.name);
      }

      return data.response.trim();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error.message, this.name);
    }
  }

  /**
   * List available models on the Ollama server
   */
  async listModels() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.models?.map(m => m.name) || [];
    } catch {
      return [];
    }
  }
}

module.exports = { OllamaProvider };
