/**
 * Cache Manager
 * Simple file-based cache with TTL support
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const CryptoJS = require('crypto-js');
const { CacheError } = require('./errors');

class CacheManager {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.ttl = options.ttl || 3600; // seconds
    this.maxSize = options.maxSize || 1000;
    this.cacheDir = path.join(os.homedir(), '.ai-switch', 'cache');
    
    if (this.enabled && !fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Generate cache key from prompt and provider
   */
  _getKey(prompt, provider) {
    const data = `${provider || 'default'}:${prompt}`;
    return CryptoJS.SHA256(data).toString();
  }

  /**
   * Get cached response
   * @returns {Promise<string|null>} Cached response or null
   */
  async get(prompt, provider = null) {
    if (!this.enabled) return null;

    const key = this._getKey(prompt, provider);
    const cacheFile = path.join(this.cacheDir, `${key}.json`);

    try {
      if (!fs.existsSync(cacheFile)) return null;

      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const age = (Date.now() - data.timestamp) / 1000;

      if (age > this.ttl) {
        fs.unlinkSync(cacheFile);
        return null;
      }

      return data.response;
    } catch (error) {
      return null;
    }
  }

  /**
   * Store response in cache
   */
  async set(prompt, response, provider = null) {
    if (!this.enabled) return;

    const key = this._getKey(prompt, provider);
    const cacheFile = path.join(this.cacheDir, `${key}.json`);

    try {
      const data = {
        prompt,
        response,
        provider,
        timestamp: Date.now()
      };

      fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf8');
      await this._prune();
    } catch (error) {
      throw new CacheError(`Failed to write cache: ${error.message}`);
    }
  }

  /**
   * Remove old entries when cache exceeds maxSize
   */
  async _prune() {
    try {
      const files = fs.readdirSync(this.cacheDir);
      
      if (files.length <= this.maxSize) return;

      // Sort by modification time, oldest first
      const fileStats = files.map(f => ({
        name: f,
        time: fs.statSync(path.join(this.cacheDir, f)).mtime.getTime()
      })).sort((a, b) => a.time - b.time);

      // Remove oldest entries
      const toRemove = fileStats.slice(0, files.length - this.maxSize);
      for (const file of toRemove) {
        fs.unlinkSync(path.join(this.cacheDir, file.name));
      }
    } catch (error) {
      // Silently fail pruning
    }
  }

  /**
   * Clear entire cache
   */
  async clear() {
    if (!this.enabled) return;

    try {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.cacheDir, file));
      }
    } catch (error) {
      throw new CacheError(`Failed to clear cache: ${error.message}`);
    }
  }

  isEnabled() {
    return this.enabled;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    try {
      const files = fs.readdirSync(this.cacheDir);
      return {
        entries: files.length,
        maxSize: this.maxSize,
        enabled: this.enabled
      };
    } catch (error) {
      return { entries: 0, maxSize: this.maxSize, enabled: this.enabled };
    }
  }
}

module.exports = { CacheManager };
