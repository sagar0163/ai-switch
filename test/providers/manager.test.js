const { ProviderManager } = require('../../src/providers/manager');
const { ProviderError, parseRetryAfter } = require('../../src/utils/errors');

function fakeConfig(overrides = {}) {
  const merged = {
    providers: {
      openai: { apiKey: 'k1', model: 'm', baseUrl: 'u' },
      anthropic: { apiKey: 'k2', model: 'm', baseUrl: 'u' },
      google: { apiKey: 'k3', model: 'm', baseUrl: 'u' }
    },
    defaultProvider: 'openai',
    failover: true,
    ...overrides
  };
  return {
    get(key, def = null) {
      let value = merged;
      for (const k of key.split('.')) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          return def;
        }
      }
      return value;
    },
    getProviderConfig(name) {
      return merged.providers[name];
    },
    getAllProviders() {
      return Object.keys(merged.providers || {});
    }
  };
}

describe('ProviderManager availability', () => {
  it('only initializes providers that have credentials', () => {
    const pm = new ProviderManager(fakeConfig({
      providers: {
        openai: { apiKey: '', model: 'm' },
        anthropic: { apiKey: 'k', model: 'm' },
        google: { apiKey: 'k', model: 'm' }
      }
    }), null, null);

    expect(Object.keys(pm.providers)).toEqual(['anthropic', 'google']);
    expect(pm.getOrder().map((p) => p.name)).toEqual(['anthropic', 'google']);
  });

  it('getProvider returns a configured provider and throws for unknown names', () => {
    const pm = new ProviderManager(fakeConfig(), null, null);
    expect(pm.getProvider('openai').name).toBe('openai');
    expect(() => pm.getProvider('nope')).toThrow('not configured');
  });

  it('listProviders reports names, models, and the default flag', () => {
    const pm = new ProviderManager(fakeConfig(), null, null);
    const list = pm.listProviders();
    expect(list.map((p) => p.name)).toEqual(['openai', 'anthropic', 'google']);
    expect(list.every((p) => p.available)).toBe(true);
    expect(list.find((p) => p.name === 'openai').isDefault).toBe(true);
    expect(list.find((p) => p.name === 'anthropic').isDefault).toBe(false);
  });

  it('getBestAvailable throws when no providers are configured', () => {
    const pm = new ProviderManager(fakeConfig({ providers: {} }), null, null);
    expect(() => pm.getBestAvailable()).toThrow('No AI providers configured');
  });
});

describe('ProviderManager failover settings', () => {
  it('normalizes boolean, array, and object forms with safe fallbacks', () => {
    const asDefault = new ProviderManager(fakeConfig({ failover: undefined }), null, null)
      .getFailoverSettings();
    expect(asDefault).toMatchObject({ enabled: true, order: [], maxFailures: 3, cooldownSeconds: 60 });

    const disabled = new ProviderManager(fakeConfig({ failover: false }), null, null)
      .getFailoverSettings();
    expect(disabled.enabled).toBe(false);

    const arr = new ProviderManager(fakeConfig({ failover: ['google'] }), null, null)
      .getFailoverSettings();
    expect(arr).toMatchObject({ enabled: true, order: ['google'] });

    const obj = new ProviderManager(
      fakeConfig({ failover: { enabled: false, maxFailures: -1, cooldownSeconds: 0 } }),
      null,
      null
    ).getFailoverSettings();
    expect(obj).toMatchObject({ enabled: false, maxFailures: 3, cooldownSeconds: 60 });
  });
});

describe('ProviderManager ordering', () => {
  it('resolves default order with defaultProvider first, then insertion order', () => {
    const pm = new ProviderManager(fakeConfig(), null, null);
    expect(pm.getOrder().map((p) => p.name)).toEqual(['openai', 'anthropic', 'google']);
  });

  it('resolves --primary/--backup ahead of configured and default order', () => {
    const pm = new ProviderManager(fakeConfig(), null, null);
    expect(pm.getOrder({ primary: 'anthropic', backup: 'google' }).map((p) => p.name))
      .toEqual(['anthropic', 'google', 'openai']);
  });

  it('includes a config-level failover order between flags and defaults', () => {
    const pm = new ProviderManager(fakeConfig({ failover: ['google', 'anthropic'] }), null, null);
    expect(pm.getOrder({ primary: 'openai' }).map((p) => p.name))
      .toEqual(['openai', 'google', 'anthropic']);
  });

  it('skips primary/backup names that are not configured', () => {
    const pm = new ProviderManager(fakeConfig(), null, null);
    expect(pm.getOrder({ primary: 'nope', backup: 'openai' }).map((p) => p.name))
      .toEqual(['openai', 'anthropic', 'google']);
  });

  it('getBestAvailable returns the first provider in default order', () => {
    const pm = new ProviderManager(fakeConfig(), null, null);
    expect(pm.getBestAvailable().name).toBe('openai');
  });

  it('getBackup() honors an explicit provider order rather than insertion order', () => {
    const pm = new ProviderManager(fakeConfig(), null, null);

    expect(pm.getBackup('openai').name).toBe('anthropic');

    expect(pm.getBackup('openai', ['google', 'anthropic']).name).toBe('google');
    expect(pm.getBackup('anthropic', ['anthropic', 'google', 'openai']).name).toBe('google');
    expect(pm.getBackup('google', ['google', 'openai', 'unknown']).name).toBe('openai');
  });

  it('getBackup() returns null when every provider is excluded', () => {
    const pm = new ProviderManager(fakeConfig(), null, null);
    expect(pm.getBackup('openai', ['openai'])).toBeNull();
  });
});

describe('ProviderManager cooldown', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens the circuit after maxFailures consecutive failures', () => {
    const pm = new ProviderManager(
      fakeConfig({ failover: { enabled: true, maxFailures: 3, cooldownSeconds: 60 } }),
      null,
      null
    );

    pm.recordFailure('openai');
    pm.recordFailure('openai');
    expect(pm.isInCooldown('openai')).toBe(false);

    pm.recordFailure('openai');
    expect(pm.isInCooldown('openai')).toBe(true);
    expect(pm.getCooldownRemaining('openai')).toBeGreaterThan(0);
  });

  it('does not trigger cooldown before enough consecutive failures', () => {
    const pm = new ProviderManager(
      fakeConfig({ failover: { enabled: true, maxFailures: 5, cooldownSeconds: 30 } }),
      null,
      null
    );
    pm.recordFailure('openai');
    pm.recordFailure('openai');
    pm.recordFailure('openai');
    pm.recordFailure('openai');
    expect(pm.isInCooldown('openai')).toBe(false);
  });

  it('resets the failure counter on success', () => {
    const pm = new ProviderManager(
      fakeConfig({ failover: { enabled: true, maxFailures: 3, cooldownSeconds: 60 } }),
      null,
      null
    );
    pm.recordFailure('openai');
    pm.recordFailure('openai');
    pm.recordSuccess('openai');
    pm.recordFailure('openai');
    pm.recordFailure('openai');
    expect(pm.isInCooldown('openai')).toBe(false);
  });

  it('reopens (half-open) once the cooldown window has elapsed', () => {
    jest.useFakeTimers();
    const pm = new ProviderManager(
      fakeConfig({ failover: { enabled: true, maxFailures: 2, cooldownSeconds: 60 } }),
      null,
      null
    );

    pm.recordFailure('openai');
    pm.recordFailure('openai');
    expect(pm.isInCooldown('openai')).toBe(true);

    jest.advanceTimersByTime(60 * 1000);
    expect(pm.isInCooldown('openai')).toBe(false);
    expect(pm.getCooldownRemaining('openai')).toBe(0);
  });

  it('honors Retry-After by cooling down immediately and for the stated window', () => {
    const pm = new ProviderManager(fakeConfig(), null, null);

    pm.recordFailure('openai', 900);
    expect(pm.isInCooldown('openai')).toBe(true);
    expect(pm.getCooldownRemaining('openai')).toBeLessThanOrEqual(900);
    expect(pm.getCooldownRemaining('openai')).toBeGreaterThanOrEqual(899);
  });

  it('reopens immediately after a Retry-After window elapses', () => {
    jest.useFakeTimers();
    const pm = new ProviderManager(fakeConfig(), null, null);

    pm.recordFailure('openai', 60);
    expect(pm.isInCooldown('openai')).toBe(true);

    jest.advanceTimersByTime(60 * 1000);
    expect(pm.isInCooldown('openai')).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds values', () => {
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter(30)).toBe(30);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses HTTP-date values', () => {
    const future = new Date(Date.now() + 10 * 1000);
    const seconds = parseRetryAfter(future.toUTCString());
    expect(seconds).toBeGreaterThanOrEqual(9);
    expect(seconds).toBeLessThanOrEqual(10);
  });

  it('returns 0 for unparseable or missing values', () => {
    expect(parseRetryAfter('garbage')).toBe(0);
    expect(parseRetryAfter(undefined)).toBe(0);
    expect(parseRetryAfter(null)).toBe(0);
  });

  it('stores a parsed Retry-After on ProviderError', () => {
    const err = new ProviderError('nope', 'openai', 429, '300');
    expect(err.retryAfter).toBe(300);

    const noHeader = new ProviderError('nope', 'openai');
    expect(noHeader.retryAfter).toBe(0);
  });
});