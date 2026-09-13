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
const { forEachLine, StreamController } = require('../utils/stream');

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

  /**
   * Build the request endpoint + body for a generate/chat call.
   * isChat is decided from whether the caller passed a messages array, so a bare
   * prompt stays on /api/generate.
   * @param {string} model - Model id
   * @param {Object} options - Request options ({ prompt, messages?, temperature?, maxTokens? })
   * @param {boolean} stream - Whether to stream
   * @returns {{endpoint: string, body: Object}}
   */
  _requestBody(model, options = {}, stream) {
    const { prompt = '', messages } = options;
    const isChat = Array.isArray(messages) && messages.length > 0;
    const payloadMessages = isChat ? messages : [{ role: 'user', content: prompt }];
    const shared = {
      model,
      stream,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens || 2048
      }
    };

    const endpoint = isChat ? `${this.baseUrl}/api/chat` : `${this.baseUrl}/api/generate`;
    const body = isChat
      ? { ...shared, messages: payloadMessages }
      : { ...shared, prompt };

    return { endpoint, body };
  }

  async complete(prompt, options = {}) {
    const model = options.model || this.defaultModel;
    const isChat = Array.isArray(options.messages) && options.messages.length > 0;
    const { endpoint, body } = this._requestBody(model, { ...options, prompt }, false);

    try {
      // Check availability first
      const available = await this.isAvailable();
      if (!available) {
        throw new ProviderError(
          'Ollama server not running. Start with: ollama serve',
          this.name
        );
      }

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
   * Stream a completion, emitting tokens via onToken as they arrive.
   * Ollama streams NDJSON lines with `response` (generate) or `message.content`
   * (chat) delta fields plus a final `done: true` object holding token counts.
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
    const isChat = Array.isArray(options.messages) && options.messages.length > 0;
    const controller = new StreamController({ provider: this.name, onToken });
    const { endpoint, body } = this._requestBody(model, { ...options, prompt }, true);

    const available = await this.isAvailable();
    if (!available) {
      throw new ProviderError(
        'Ollama server not running. Start with: ollama serve',
        this.name
      );
    }

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

    let done = null;
    await forEachLine(response, (line) => {
      if (!line) return;

      let chunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        controller.fail('Invalid stream chunk from Ollama');
        return;
      }

      if (chunk.error) {
        controller.fail(chunk.error);
        return;
      }

      const delta = isChat ? chunk.message?.content : chunk.response;
      if (delta) controller.push(delta);
      if (chunk.done === true) done = done || chunk;
    });

    if (controller.text.length === 0) {
      throw new ProviderError('No response from Ollama', this.name);
    }

    return {
      text: controller.text.trim(),
      usage: parseOllamaUsage(done || {})
    };
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
