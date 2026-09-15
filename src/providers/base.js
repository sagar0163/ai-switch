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
    // Last usage record captured from the most recent streamed response
    // (null when the provider reported no usage in its stream).
    this.streamUsage = null;
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
   * Stream a completion. Yields text deltas as they arrive; providers that
   * implement true token streaming override this. The default implementation
   * falls back to a single `complete()` call so callers can treat all
   * providers uniformly. After the stream finishes, `this.streamUsage` holds
   * the canonical usage record from the provider (or null if none reported).
   * @param {string} prompt - The prompt
   * @param {Object} options - Request options
   * @returns {AsyncGenerator<string>} Text deltas
   */
  async *stream(prompt, options = {}) {
    const result = await this.complete(prompt, options);
    this.streamUsage = (result && result.usage) || null;
    const text = result && typeof result.text === 'string' ? result.text : '';
    if (text) yield text;
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
