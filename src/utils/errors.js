/**
 * Custom error classes for AI-Switch
 */

class AIError extends Error {
  constructor(message, provider = 'unknown') {
    super(message);
    this.name = 'AIError';
    this.provider = provider;
  }
}

class ConfigurationError extends AIError {
  constructor(message) {
    super(message, 'config');
    this.name = 'ConfigurationError';
  }
}

class ProviderError extends AIError {
  constructor(message, provider, statusCode = null) {
    super(message, provider);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
  }
}

class CacheError extends AIError {
  constructor(message) {
    super(message, 'cache');
    this.name = 'CacheError';
  }
}

module.exports = { AIError, ConfigurationError, ProviderError, CacheError };
