/**
 * Ollama Provider
 * Supports local LLM models via Ollama API
 * 
 * Install Ollama: https://ollama.ai
 * Pull models: ollama pull llama2, ollama pull mistral, etc.
 */

const { BaseProvider } = require('./base');
const { ProviderError } = require('../utils/errors');
const { parseOllamaUsage } = require('../utils/usage');

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
    const messages = options.messages || [{ role: 'user', content: prompt }];
    const isChat = Array.isArray(options.messages) && options.messages.length > 0;

    try {
      // Check availability first
      const available = await this.isAvailable();
      if (!available) {
        throw new ProviderError(
          'Ollama server not running. Start with: ollama serve',
          this.name
        );
      }

      // Full history goes through the chat endpoint; a single prompt stays on /api/generate
      const endpoint = isChat ? `${this.baseUrl}/api/chat` : `${this.baseUrl}/api/generate`;
      const body = isChat
        ? {
          model,
          messages,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens || 2048
          }
        }
        : {
          model,
          prompt,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens || 2048
          }
        };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new ProviderError(
          this._formatError({ message: error.error || `HTTP ${response.status}` }),
          this.name,
          response.status,
          response.headers.get('retry-after')
        );
      }

      const data = await response.json();
      const text = isChat ? data.message?.content : data.response;

      if (!text) {
        throw new ProviderError('No response from Ollama', this.name);
      }

      return {
        text: text.trim(),
        usage: parseOllamaUsage(data)
      };
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
