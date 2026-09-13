const fs = require('fs');
const os = require('os');
const path = require('path');

const { AISwitch } = require('../src/index');
const { ProviderError } = require('../src/utils/errors');

function tmpConfig(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-test-'));
  const config = {
    providers: {
      openai: { apiKey: 'sk-openai', model: 'gpt-4', baseUrl: 'https://api.openai.com/v1' },
      anthropic: { apiKey: 'sk-anthropic', model: 'claude-3-opus-20240229', baseUrl: 'https://api.anthropic.com/v1' },
      google: { apiKey: 'sk-google', model: 'gemini-pro', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }
    },
    cache: { enabled: false },
    costTracking: { enabled: false },
    failover: true,
    defaultProvider: 'openai',
    ...overrides
  };
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(config), 'utf8');
  return file;
}

function buildAI(overrides) {
  const ai = new AISwitch({ configPath: tmpConfig(overrides) });
  ai.providers.providers.openai.complete = jest.fn();
  ai.providers.providers.anthropic.complete = jest.fn();
  ai.providers.providers.google.complete = jest.fn();
  return ai;
}

describe('AISwitch ordered failover', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the primary provider first and fails over to the backup only on failure', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete
      .mockRejectedValue(new ProviderError('boom', 'openai', 500));
    ai.providers.providers.anthropic.complete
      .mockResolvedValue('hello from anthropic');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await ai.ask('hi', { primary: 'openai', backup: 'anthropic' });

    expect(result).toBe('hello from anthropic');
    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(1);
    expect(ai.providers.providers.anthropic.complete).toHaveBeenCalledTimes(1);
    expect(ai.providers.providers.google.complete).not.toHaveBeenCalled();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0];
    expect(message).toContain('openai');
    expect(message).toContain('anthropic');
  });

  it('uses the backup provider only when the primary fails', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete.mockResolvedValue('openai ok');
    ai.providers.providers.anthropic.complete.mockResolvedValue('anthropic ok');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await ai.ask('hi', { primary: 'openai', backup: 'anthropic' });

    expect(result).toBe('openai ok');
    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(1);
    expect(ai.providers.providers.anthropic.complete).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('emits a single warning per failover hop, not per request', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete
      .mockRejectedValue(new ProviderError('down', 'openai', 503));
    ai.providers.providers.anthropic.complete
      .mockRejectedValue(new ProviderError('down', 'anthropic', 503));
    ai.providers.providers.google.complete
      .mockRejectedValue(new ProviderError('down', 'google', 503));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(ai.ask('hi', { primary: 'openai', backup: 'anthropic' }))
      .rejects.toThrow('Failed to get response');

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('openai');
    expect(warn.mock.calls[0][0]).toContain('anthropic');
  });

  it('does not fail over when failover disabled and no explicit chain given', async () => {
    const ai = buildAI({ failover: false });
    ai.providers.providers.openai.complete
      .mockRejectedValue(new ProviderError('boom', 'openai', 500));
    ai.providers.providers.anthropic.complete.mockResolvedValue('anthropic ok');

    await expect(ai.ask('hi', { provider: 'openai' }))
      .rejects.toThrow('boom');
    expect(ai.providers.providers.anthropic.complete).not.toHaveBeenCalled();
  });

  it('honors an explicit --primary/--backup order even when default order differs', async () => {
    const ai = buildAI(); // defaultProvider is openai
    ai.providers.providers.google.complete.mockResolvedValue('google ok');
    ai.providers.providers.anthropic.complete.mockResolvedValue('anthropic ok');

    const result = await ai.ask('hi', { primary: 'anthropic', backup: 'google' });

    expect(result).toBe('anthropic ok');
    expect(ai.providers.providers.anthropic.complete).toHaveBeenCalledTimes(1);
    expect(ai.providers.providers.google.complete).not.toHaveBeenCalled();
    expect(ai.providers.providers.openai.complete).not.toHaveBeenCalled();
  });
});

describe('AISwitch cooldown', () => {
  const cooldownOverrides = {
    failover: { enabled: true, maxFailures: 3, cooldownSeconds: 60 }
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not retry a provider that has hit maxFailures, even when it is primary', async () => {
    const ai = buildAI(cooldownOverrides);
    ai.providers.providers.openai.complete
      .mockRejectedValue(new ProviderError('down', 'openai', 503));
    ai.providers.providers.anthropic.complete.mockResolvedValue('anthropic ok');
    ai.providers.providers.google.complete.mockResolvedValue('google ok');
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    for (let i = 0; i < 3; i++) {
      expect(await ai.ask(`ask-${i}`, { primary: 'openai', backup: 'anthropic' }))
        .toBe('anthropic ok');
    }

    expect(ai.providers.isInCooldown('openai')).toBe(true);

    const result = await ai.ask('ask-4', { primary: 'openai', backup: 'anthropic' });
    expect(result).toBe('anthropic ok');
    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(3);
    expect(ai.providers.providers.anthropic.complete).toHaveBeenCalledTimes(4);
    expect(ai.providers.providers.google.complete).not.toHaveBeenCalled();
  });

  it('successfully retries a provider after cooldown has expired', () => {
    jest.useFakeTimers();
    const pm = buildAI(cooldownOverrides).providers;
    pm.recordFailure('openai');
    pm.recordFailure('openai');
    pm.recordFailure('openai');
    expect(pm.isInCooldown('openai')).toBe(true);

    jest.advanceTimersByTime(61 * 1000);
    expect(pm.isInCooldown('openai')).toBe(false);
  });
});

describe('AISwitch Retry-After handling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('backs off immediately on Retry-After and skips the provider on later asks', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete
      .mockRejectedValue(new ProviderError('429 too many', 'openai', 429, 100));
    ai.providers.providers.anthropic.complete.mockResolvedValue('anthropic ok');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await ai.ask('first', { primary: 'openai', backup: 'anthropic' });
    expect(result).toBe('anthropic ok');
    expect(ai.providers.isInCooldown('openai')).toBe(true);
    expect(ai.providers.getCooldownRemaining('openai')).toBeLessThanOrEqual(100);
    expect(warn.mock.calls[0][0]).toContain('Retry-After: 100s');

    ai.providers.providers.openai.complete.mockClear();
    ai.providers.providers.anthropic.complete.mockClear();

    await ai.ask('second', { primary: 'openai', backup: 'anthropic' });
    expect(ai.providers.providers.openai.complete).not.toHaveBeenCalled();
    expect(ai.providers.providers.anthropic.complete).toHaveBeenCalledTimes(1);
  });
});

describe('AISwitch _retrying guard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shares a single underlying attempt across overlapping ask() calls', async () => {
    const ai = buildAI();
    let resolveComplete;
    ai.providers.providers.openai.complete.mockReturnValue(
      new Promise((resolve) => { resolveComplete = resolve; })
    );

    const first = ai.ask('hi');
    const second = ai.ask('hi');
    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(1);

    resolveComplete('shared result');
    expect(await first).toBe('shared result');
    expect(await second).toBe('shared result');
    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(1);
  });

  it('clears the guard after completion so subsequent asks run again', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete.mockResolvedValue('one');
    expect(await ai.ask('first')).toBe('one');

    ai.providers.providers.openai.complete.mockResolvedValue('two');
    expect(await ai.ask('second')).toBe('two');
    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(2);
  });

  it('clears the guard after a failed attempt', async () => {
    const ai = buildAI({ failover: false });
    ai.providers.providers.openai.complete
      .mockRejectedValue(new ProviderError('down', 'openai', 500));

    await expect(ai.ask('first', { provider: 'openai' })).rejects.toThrow('down');

    ai.providers.providers.openai.complete.mockResolvedValue('recovered');
    await expect(ai.ask('second', { provider: 'openai' })).resolves.toBe('recovered');
  });
});

describe('AISwitch caching and cost tracking', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serves a cached response on a second identical ask()', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-idx-cache-'));
    const ai = buildAI({ cache: { enabled: true, ttl: 3600, maxSize: 100, cacheDir } });
    ai.providers.providers.openai.complete.mockResolvedValue('fresh');

    expect(await ai.ask('cache me', { provider: 'openai' })).toBe('fresh');
    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(1);

    expect(await ai.ask('cache me', { provider: 'openai' })).toBe('fresh');
    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(1);
  });

  it('records provider usage after a successful ask()', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-idx-cost-'));
    const ai = buildAI({
      costTracking: { enabled: true, storagePath: path.join(dir, 'costs.json') }
    });
    ai.providers.providers.openai.complete.mockResolvedValue({
      text: 'priced',
      usage: {
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      }
    });

    expect(await ai.ask('hi')).toBe('priced');
    const summary = ai.getCosts();
    expect(summary.totalRequests).toBe(1);
    expect(summary.totalInputTokens).toBe(1000);
    expect(summary.totalOutputTokens).toBe(500);
    expect(summary.byProvider[0].provider).toBe('openai');
    expect(ai.listProviders().length).toBe(3);
  });
});