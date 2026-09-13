const fs = require('fs');
const os = require('os');
const path = require('path');

const { CacheManager } = require('../../src/utils/cache');

function tmpCacheDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-cache-'));
}

function makeCache(options = {}) {
  return new CacheManager({ cacheDir: tmpCacheDir(), ...options });
}

describe('CacheManager get/set', () => {
  it('round-trips a response through the cache', async () => {
    const cache = makeCache();
    await cache.set('hello prompt', 'cached answer', 'openai');
    expect(await cache.get('hello prompt', 'openai')).toBe('cached answer');
  });

  it('scopes cache entries by provider', async () => {
    const cache = makeCache();
    await cache.set('same prompt', 'openai answer', 'openai');
    await cache.set('same prompt', 'anthropic answer', 'anthropic');
    expect(await cache.get('same prompt', 'openai')).toBe('openai answer');
    expect(await cache.get('same prompt', 'anthropic')).toBe('anthropic answer');
  });

  it('generates deterministic but distinct keys per prompt/provider', async () => {
    const cache = makeCache();
    expect(cache._getKey('hi', 'openai')).toBe(cache._getKey('hi', 'openai'));
    expect(cache._getKey('hi', 'openai')).not.toBe(cache._getKey('hi', 'anthropic'));
    expect(cache._getKey('hi', 'openai')).not.toBe(cache._getKey('bye', 'openai'));
  });

  it('returns null for a missing key', async () => {
    const cache = makeCache();
    expect(await cache.get('never set', 'openai')).toBeNull();
  });
});

describe('CacheManager TTL expiry', () => {
  it('expires entries older than the TTL and deletes the file', async () => {
    const cache = makeCache({ ttl: 3600 });
    await cache.set('old prompt', 'stale', 'openai');

    const key = cache._getKey('old prompt', 'openai');
    const file = path.join(cache.cacheDir, `${key}.json`);
    expect(fs.existsSync(file)).toBe(true);

    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.timestamp = Date.now() - 3600 * 1000 * 10; // 10 hours ago
    fs.writeFileSync(file, JSON.stringify(data), 'utf8');

    expect(await cache.get('old prompt', 'openai')).toBeNull();
    expect(fs.existsSync(file)).toBe(false); // expired entry removed
  });

  it('keeps fresh entries within TTL', async () => {
    const cache = makeCache({ ttl: 3600 });
    await cache.set('fresh', 'yes', 'openai');
    expect(await cache.get('fresh', 'openai')).toBe('yes');
  });
});

describe('CacheManager pruning', () => {
  it('removes oldest entries when maxSize is exceeded', async () => {
    const cache = makeCache({ maxSize: 2 });
    await cache.set('a', '1', 'openai');
    await cache.set('b', '2', 'openai');

    const oldestFile = path.join(cache.cacheDir, `${cache._getKey('a', 'openai')}.json`);
    fs.utimesSync(oldestFile, new Date(0), new Date(0)); // force oldest mtime

    await cache.set('c', '3', 'openai');

    expect(cache.getStats().entries).toBe(2);
    expect(await cache.get('a', 'openai')).toBeNull();
    expect(await cache.get('b', 'openai')).toBe('2');
    expect(await cache.get('c', 'openai')).toBe('3');
  });

  it('does not prune under maxSize', async () => {
    const cache = makeCache({ maxSize: 10 });
    await cache.set('a', '1', 'openai');
    await cache.set('b', '2', 'openai');
    expect(cache.getStats().entries).toBe(2);
  });
});

describe('CacheManager clear and stats', () => {
  it('clears all entries', async () => {
    const cache = makeCache();
    await cache.set('a', '1', 'openai');
    await cache.set('b', '2', 'openai');
    await cache.clear();
    expect(cache.getStats().entries).toBe(0);
  });

  it('reports stats', async () => {
    const cache = makeCache();
    await cache.set('a', '1', 'openai');
    const stats = cache.getStats();
    expect(stats.entries).toBe(1);
    expect(stats.enabled).toBe(true);
    expect(stats.maxSize).toBe(1000);
  });
});

describe('CacheManager disabled mode', () => {
  it('never serves or stores entries when disabled', async () => {
    const cache = makeCache({ enabled: false });
    expect(cache.isEnabled()).toBe(false);

    await cache.set('a', '1', 'openai');
    expect(await cache.get('a', 'openai')).toBeNull();
    expect(cache.getStats().entries).toBe(0);
  });

  it('clear() is a no-op when disabled', async () => {
    const cache = makeCache({ enabled: false });
    await expect(cache.clear()).resolves.toBeUndefined();
  });
});

describe('CacheManager edge cases', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates the cache directory on construction when missing', () => {
    const dir = path.join(tmpCacheDir(), 'nested', 'cache');
    const cache = new CacheManager({ cacheDir: dir });
    expect(fs.existsSync(dir)).toBe(true);
    expect(cache.isEnabled()).toBe(true);
  });

  it('treats a corrupt cache entry as a miss', async () => {
    const cache = makeCache();
    await cache.set('a', '1', 'openai');
    const file = path.join(cache.cacheDir, `${cache._getKey('a', 'openai')}.json`);
    fs.writeFileSync(file, '{ not json', 'utf8');
    expect(await cache.get('a', 'openai')).toBeNull();
  });

  it('wraps write failures in a CacheError', async () => {
    const cache = makeCache();
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(cache.set('a', '1', 'openai')).rejects.toThrow(
      /Failed to write cache: disk full/
    );
  });

  it('surfaces clear() failures as a CacheError', async () => {
    const cache = makeCache();
    await cache.set('a', '1', 'openai');
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('permission denied');
    });
    await expect(cache.clear()).rejects.toThrow(
      /Failed to clear cache: permission denied/
    );
  });

  it('getStats() reports zeros when the directory cannot be read', async () => {
    const cache = makeCache();
    jest.spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error('gone');
    });
    const stats = cache.getStats();
    expect(stats).toEqual({ entries: 0, maxSize: 1000, enabled: true });
  });
});