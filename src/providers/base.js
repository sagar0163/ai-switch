/**
 * Base Provider Class
 * Abstract base for all AI providers
 */

class BaseProvider {
  constructor(config) {
    this.config = config;
    this.name = 'base';
    this.defaultModel = 'unknown';
    this.baseUrl = null;
  }

  /**
   * Send a completion request to the provider
   * @param {string} prompt - The prompt
   * @param {Object} options - Request options
   * @returns {Promise<string>} The response text
   */
  async complete() {
    throw new Error('complete() must be implemented by subclass');
  }

  /**
   * Stream a completion from the provider.
   * Yields `{ delta }` per text chunk and a final `{ done: true, text, usage, model }`.
   * The default implementation falls back to the buffered `complete()`.
   * @param {string} prompt - The prompt
   * @param {Object} options - Request options
   * @returns {AsyncGenerator<Object>} Stream events
   */
  async *stream(prompt, options = {}) {
    const result = await this.complete(prompt, options);
    const text = typeof result === 'string' ? result : result?.text ?? '';
    const usage = typeof result === 'object' && result ? result.usage : null;
    yield { delta: text };
    yield { done: true, text, usage, model: options.model || this.defaultModel };
  }

  /**
   * Check if provider is available
   * @returns {boolean}
   */
  isAvailable() {
    return !!this.config?.apiKey || !!this.config?.baseUrl;
  }

  /**
   * Format error message from response
   */
  _formatError(error, response = null) {
    if (response?.error?.message) {
      return response.error.message;
    }
    return error.message;
  }
}

module.exports = { BaseProvider };
