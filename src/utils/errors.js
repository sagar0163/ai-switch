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
  constructor(message, provider, statusCode = null, retryAfter = null) {
    super(message, provider);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
    this.retryAfter = parseRetryAfter(retryAfter);
  }
}

/**
 * Parse an HTTP `Retry-After` header value into seconds.
 * Accepts a delta-seconds integer or an HTTP-date; returns 0 for unparseable input.
 * @param {number|string|Date|null|undefined} value - Raw Retry-After value
 * @param {number} nowMs - Reference timestamp (defaults to Date.now())
 * @returns {number} Seconds to wait before retrying (>= 0)
 */
function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) {
    return Math.max(0, Math.ceil((value.getTime() - nowMs) / 1000));
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }
  const str = String(value).trim();
  if (!str) return 0;
  if (/^\d+$/.test(str)) {
    return Math.max(0, parseInt(str, 10));
  }
  const time = Date.parse(str);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.ceil((time - nowMs) / 1000));
}

class CacheError extends AIError {
  constructor(message) {
    super(message, 'cache');
    this.name = 'CacheError';
  }
}

module.exports = { AIError, ConfigurationError, ProviderError, CacheError, parseRetryAfter };
