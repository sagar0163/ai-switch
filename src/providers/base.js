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
  async complete(prompt, options = {}) {
    throw new Error('complete() must be implemented by subclass');
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
