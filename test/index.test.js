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

describe('AISwitch streaming', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('concatenated stream events equal the non-streaming output for the same request', async () => {
    const ai = buildAI();
    const full = 'bonjour le monde';

    ai.providers.providers.openai.complete.mockResolvedValue(full);
    const buffered = await ai.ask('hi', { provider: 'openai' });
    expect(buffered).toBe(full);

    const fragments = ['bonjour ', 'le ', 'monde'];
    ai.providers.providers.openai.complete.mockClear();
    ai.providers.providers.openai.streamComplete = jest.fn(async (prompt, opts, onToken) => {
      let text = '';
      for (const fragment of fragments) {
        text += fragment;
        if (onToken) onToken(fragment);
      }
      return { text, usage: { inputTokens: 5, outputTokens: 3, model: 'gpt-4' } };
    });

    const tokens = [];
    const streamed = await ai.ask('hi', {
      provider: 'openai',
      stream: true,
      onToken: (token) => tokens.push(token)
    });

    expect(tokens.join('')).toBe(full);
    expect(ai.providers.providers.openai.complete).not.toHaveBeenCalled();
    expect(streamed).toBe(full);
  });

  it('uses the buffered complete() path when stream is false', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete.mockResolvedValue('buffered');
    ai.providers.providers.openai.streamComplete = jest.fn();

    const result = await ai.ask('hi', { provider: 'openai', stream: false });
    expect(result).toBe('buffered');
    expect(ai.providers.providers.openai.streamComplete).not.toHaveBeenCalled();
  });

  it('short-circuits on a cache hit without any streaming', async () => {
    const ai = buildAI({ cache: { enabled: true } });
    const cached = 'cached response';
    await ai.cache.set('hi', cached, 'openai');

    ai.providers.providers.openai.streamComplete = jest.fn();
    const tokens = [];
    const result = await ai.ask('hi', {
      provider: 'openai',
      stream: true,
      onToken: (token) => tokens.push(token)
    });

    expect(result).toBe(cached);
    expect(tokens).toEqual([]);
    expect(ai.providers.providers.openai.streamComplete).not.toHaveBeenCalled();
  });

  it('cache hit short-circuits even without an explicit provider (shared bucket)', async () => {
    const ai = buildAI({ cache: { enabled: true } });
    const cached = 'shared bucket answer';
    await ai.cache.set('hi', cached, 'any');

    ai.providers.providers.openai.streamComplete = jest.fn();
    const tokens = [];
    const result = await ai.ask('hi', { stream: true, onToken: (token) => tokens.push(token) });

    expect(result).toBe(cached);
    expect(tokens).toEqual([]);
    expect(ai.providers.providers.openai.streamComplete).not.toHaveBeenCalled();
  });

  it('does not fail over when the stream dies after partial output', async () => {
    const ai = buildAI({ failover: { enabled: true, maxFailures: 1, cooldownSeconds: 60 } });
    const partialErr = new ProviderError('connection reset', 'openai', 500);
    partialErr.partial = true;
    ai.providers.providers.openai.streamComplete = jest.fn(async (prompt, opts, onToken) => {
      if (onToken) onToken('partial ');
      throw partialErr;
    });
    ai.providers.providers.anthropic.streamComplete = jest.fn().mockResolvedValue('anthropic ok');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(ai.ask('hi', { primary: 'openai', backup: 'anthropic', stream: true }))
      .rejects.toThrow(/mid-stream/);
    expect(ai.providers.providers.anthropic.streamComplete).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(ai.providers.isInCooldown('openai')).toBe(true);
  });

  it('fails over normally when the stream dies before any token', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.streamComplete = jest.fn()
      .mockRejectedValue(new ProviderError('down', 'openai', 500));
    ai.providers.providers.anthropic.streamComplete = jest.fn().mockResolvedValue('anthropic ok');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const tokens = [];
    const result = await ai.ask('hi', {
      primary: 'openai',
      backup: 'anthropic',
      stream: true,
      onToken: (token) => tokens.push(token)
    });

    expect(result).toBe('anthropic ok');
    expect(tokens).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns metadata in json mode without streaming', async () => {
    const ai = buildAI();
    ai.providers.providers.openai.complete.mockResolvedValue('plain text');
    ai.providers.providers.openai.streamComplete = jest.fn();

    const result = await ai.ask('hi', { provider: 'openai', json: true });
    expect(result).toEqual({
      text: 'plain text',
      provider: 'openai',
      model: 'gpt-4',
      usage: null
    });
    expect(ai.providers.providers.openai.streamComplete).not.toHaveBeenCalled();
  });

  it('keeps json mode working on a cache hit with no API call', async () => {
    const ai = buildAI({ cache: { enabled: true } });
    await ai.cache.set('hi', 'cached', 'openai');
    ai.providers.providers.openai.complete = jest.fn();

    const result = await ai.ask('hi', { provider: 'openai', json: true });
    expect(result.text).toBe('cached');
    expect(result.provider).toBe('openai');
    expect(ai.providers.providers.openai.complete).not.toHaveBeenCalled();
  });
});

function bufferReceivedMock(ai) {
  // helper placeholder to keep assertions explicit; not used
  return undefined;
}

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