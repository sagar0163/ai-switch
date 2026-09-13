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

describe('AISwitch conversation history (messages path)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the full conversation history to the provider', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete.mockResolvedValue('your name is Sam');

    const history = [
      { role: 'user', content: 'my name is Sam' },
      { role: 'assistant', content: 'nice to meet you Sam' },
      { role: 'user', content: 'what is my name?' }
    ];

    const result = await ai.ask(history, { provider: 'openai' });

    expect(result).toBe('your name is Sam');
    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(1);
    expect(ai.providers.providers.openai.complete.mock.calls[0][1].messages).toEqual(history);
  });

  it('keeps single-shot ask() payload behavior unchanged', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete.mockResolvedValue('hi there');

    await ai.ask('hi', { provider: 'openai' });

    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(1);
    const [prompt, options] = ai.providers.providers.openai.complete.mock.calls[0];
    expect(prompt).toBe('hi');
    expect(options.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('trims the history to the configured chat.maxTurns before sending', async () => {
    const ai = buildAI({ chat: { maxTurns: 1 } });
    ai.providers.providers.openai.complete.mockResolvedValue('ok');

    const history = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'one' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'third' }
    ];

    await ai.ask(history, { provider: 'openai' });

    const sent = ai.providers.providers.openai.complete.mock.calls[0][1].messages;
    expect(sent).toEqual([{ role: 'user', content: 'third' }]);
  });

  it('createChatSession wires the configured chat caps', () => {
    const ai = buildAI({ chat: { maxTurns: 2 } });
    const session = ai.createChatSession();
    for (let i = 1; i <= 4; i++) {
      session.addUser(`q${i}`).addAssistant(`a${i}`);
    }
    const req = session.nextRequest();
    expect(req.turns).toBe(2);
    expect(req.messages).toEqual([
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: 'a3' },
      { role: 'user', content: 'q4' },
      { role: 'assistant', content: 'a4' }
    ]);
  });
});

describe('AISwitch streaming (issue #5)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function fakeStream(provider, events) {
    provider.stream = jest.fn(async function* () {
      for (const evt of events) yield evt;
    });
  }

  it('streams tokens through onToken and returns text equal to the buffered output', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete.mockResolvedValue('Hello world');
    await fakeStream(ai.providers.providers.openai, [
      { delta: 'Hello' },
      { delta: ' world' },
      { done: true, text: 'Hello world', usage: { inputTokens: 2, outputTokens: 2 }, model: 'gpt-4' }
    ]);

    const collected = [];
    const result = await ai.ask('hi', {
      provider: 'openai',
      stream: true,
      onToken: (delta) => collected.push(delta)
    });

    expect(result).toBe('Hello world');
    expect(collected.join('')).toBe('Hello world');
    expect(ai.providers.providers.openai.complete).not.toHaveBeenCalled();
    expect(ai.providers.providers.openai.stream).toHaveBeenCalledTimes(1);
  });

  it('uses the buffered complete() path when stream:false', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete.mockResolvedValue('buffered');
    await fakeStream(ai.providers.providers.openai, [{ done: true, text: 'should-not-run', usage: null }]);

    const result = await ai.ask('hi', { provider: 'openai', stream: false });

    expect(result).toBe('buffered');
    expect(ai.providers.providers.openai.complete).toHaveBeenCalledTimes(1);
    expect(ai.providers.providers.openai.stream).not.toHaveBeenCalled();
  });

  it('fails over mid-stream, discarding the failed provider partial text', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.stream = jest.fn(async function* () {
      yield { delta: 'par' };
      throw new ProviderError('connection reset', 'openai', 500);
    });
    await fakeStream(ai.providers.providers.anthropic, [
      { delta: 'full answer from anthropic' },
      { done: true, text: 'full answer from anthropic', usage: null, model: 'claude' }
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const collected = [];
    const result = await ai.ask('hi', {
      provider: 'openai',
      backup: 'anthropic',
      stream: true,
      onToken: (delta) => collected.push(delta)
    });

    // The returned text is the backup's output only — the failed provider's
    // partial prefix is never glued into the result (onToken gets it, the
    // buffered text does not).
    expect(result).toBe('full answer from anthropic');
    expect(result).not.toBe('parfull answer from anthropic');
    expect(ai.providers.providers.openai.stream).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('anthropic');
  });

  it('streams deltas to onToken across a failover hop', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.stream = jest.fn(async function* () {
      yield { delta: 'par' };
      throw new ProviderError('reset', 'openai', 500);
    });
    await fakeStream(ai.providers.providers.google, [
      { delta: 'clean from google' },
      { done: true, text: 'clean from google', usage: null, model: 'gemini-pro' }
    ]);

    const collected = [];
    await ai.ask('hi', {
      provider: 'openai',
      backup: 'google',
      stream: true,
      onToken: (delta) => collected.push(delta)
    });

    expect(collected.join('')).toBe('parclean from google');
  });

  it('a cache hit short-circuits without streaming', async () => {
    const ai = buildAI({ cache: { enabled: true, ttl: 3600, maxSize: 100 } });
    ai.cache.cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-stream-cache-'));
    ai.providers.providers.openai.complete.mockResolvedValue('cached answer');
    await fakeStream(ai.providers.providers.openai, [
      { delta: 'cached answer' },
      { done: true, text: 'cached answer', usage: null, model: 'gpt-4' }
    ]);

    const first = await ai.ask('hi', { provider: 'openai', stream: true });
    expect(first).toBe('cached answer');
    expect(ai.cache.isEnabled()).toBe(true);

    // Second call hits the cache: no network, no stream, no onToken.
    const onToken = jest.fn();
    const onResult = jest.fn();
    const second = await ai.ask('hi', {
      provider: 'openai',
      stream: true,
      onToken,
      onResult
    });

    expect(second).toBe('cached answer');
    expect(ai.providers.providers.openai.stream).toHaveBeenCalledTimes(1);
    expect(onToken).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ cache: true }));
  });

  it('reports streamed usage via onResult for cost tracking', async () => {
    const ai = buildAI();
    await fakeStream(ai.providers.providers.openai, [
      { delta: 'x' },
      { done: true, text: 'x', usage: { inputTokens: 4, outputTokens: 1 }, model: 'gpt-4' }
    ]);
    const record = jest.spyOn(ai.costs, 'record');

    await ai.ask('hi', { provider: 'openai', stream: true });

    expect(record).toHaveBeenCalledWith(
      'openai',
      expect.objectContaining({ inputTokens: 4, outputTokens: 1 }),
      expect.objectContaining({ model: 'gpt-4' })
    );
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