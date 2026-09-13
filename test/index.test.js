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