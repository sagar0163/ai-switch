const fs = require('fs');
const os = require('os');
const path = require('path');

const { ConfigManager } = require('../src/utils/config');
const {
  probeProvider,
  probeWithProvider,
  suggestChain,
  buildInitConfig,
  runInit,
  PROBE_TEXT
} = require('../src/init');

function tmpConfigManager() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-init-'));
  return new ConfigManager({ configPath: path.join(dir, 'config.json'), env: {} });
}

describe('suggestChain', () => {
  it('ranks working cloud providers before ollama', () => {
    expect(suggestChain(['ollama', 'openai', 'google'])).toEqual({
      defaultProvider: 'openai',
      chain: ['openai', 'google', 'ollama']
    });
  });

  it('falls back to configured-but-unverified providers when none pass', () => {
    expect(suggestChain([], ['google', 'openai'])).toEqual({
      defaultProvider: 'openai',
      chain: ['openai', 'google']
    });
  });

  it('returns empty chain when nothing is configured', () => {
    expect(suggestChain([], [])).toEqual({ defaultProvider: null, chain: [] });
  });
});

describe('buildInitConfig', () => {
  it('writes chosen providers with defaults, keys and a failover chain', () => {
    const cfg = buildInitConfig({}, {
      providers: [
        { name: 'openai', key: 'sk-abc' },
        { name: 'ollama', baseUrl: 'http://localhost:11434' }
      ],
      defaultProvider: 'openai',
      chain: ['openai', 'ollama']
    });
    expect(cfg.providers.openai).toMatchObject({ apiKey: 'sk-abc', model: 'gpt-4', baseUrl: 'https://api.openai.com/v1' });
    expect(cfg.providers.ollama).toMatchObject({ baseUrl: 'http://localhost:11434', model: 'llama2' });
    expect(cfg.providers.ollama.apiKey).toBeUndefined();
    expect(cfg.failover).toEqual({ enabled: true, order: ['openai', 'ollama'], maxFailures: 3, cooldownSeconds: 60 });
    expect(cfg.defaultProvider).toBe('openai');
    expect(cfg.cache.enabled).toBe(true);
    expect(cfg.costTracking.enabled).toBe(true);
  });

  it('preserves existing provider settings when re-run', () => {
    const cfg = buildInitConfig(
      { providers: { openai: { model: 'gpt-4o', baseUrl: 'https://proxy.example/v1', apiKey: 'old' } } },
      { providers: [{ name: 'openai', key: 'sk-new' }], defaultProvider: 'openai', chain: ['openai'] }
    );
    expect(cfg.providers.openai).toMatchObject({ model: 'gpt-4o', baseUrl: 'https://proxy.example/v1', apiKey: 'sk-new' });
  });

  it('drops the old key when a provider is re-added without one (ollama-style)', () => {
    const cfg = buildInitConfig(
      { providers: { ollama: { model: 'llama3', baseUrl: 'http://host:11434', apiKey: 'stale' } } },
      { providers: [{ name: 'ollama', baseUrl: 'http://host:11434' }], defaultProvider: 'ollama', chain: ['ollama'] }
    );
    expect(cfg.providers.ollama.apiKey).toBeUndefined();
  });
});

describe('probeProvider', () => {
  it('returns true when the provider answers', async () => {
    const provider = {
      complete: jest.fn().mockResolvedValue({ text: 'OK' })
    };
    expect(await probeWithProvider(provider)).toBe(true);
    expect(provider.complete).toHaveBeenCalledWith(PROBE_TEXT, { temperature: 0, maxTokens: 8 });
  });

  it('returns false when the provider errors', async () => {
    const provider = {
      complete: jest.fn().mockRejectedValue(new Error('401'))
    };
    expect(await probeWithProvider(provider)).toBe(false);
  });

  it('returns false for unknown providers', async () => {
    expect(await probeProvider('madeup', {})).toBe(false);
  });
});

describe('runInit wizard', () => {
  it('collects a key, probes it, and writes a chained config', async () => {
    const config = tmpConfigManager();
    const prompter = {
      confirm: jest.fn()
        .mockResolvedValueOnce(true)  // openai
        .mockResolvedValueOnce(false) // anthropic
        .mockResolvedValueOnce(false) // google
        .mockResolvedValueOnce(true), // ollama
      hidden: jest.fn().mockResolvedValue('sk-secret-key-1234'),
      text: jest.fn().mockResolvedValue('http://ollama:11434')
    };
    const probe = jest.fn()
      .mockResolvedValueOnce(true)  // openai
      .mockResolvedValueOnce(false) // ollama

    const out = { log: jest.fn() };
    const env = { OPENAI_API_KEY: '' };
    const result = await runInit({ config, prompter, probe, env, out });

    expect(result).toEqual({ configured: true, defaultProvider: 'openai', chain: ['openai', 'ollama'] });
    expect(prompter.hidden).toHaveBeenCalledTimes(1);
    expect(prompter.hidden.mock.calls[0][0]).toContain('sk-...');
    expect(String(prompter.hidden.mock.calls[0][0])).not.toContain('sk-secret-key-1234');

    // The secret must not appear in any wizard output.
    expect(out.log.mock.calls.flat().join('\n')).not.toContain('sk-secret-key-1234');

    expect(config.getProviderConfig('openai').apiKey).toBe('sk-secret-key-1234');
    expect(config.getProviderConfig('openai').apiKeySource).toBe('config');
    expect(config.get('providers.ollama.baseUrl')).toBe('http://ollama:11434');
    expect(config.get('defaultProvider')).toBe('openai');
    expect(config.get('failover.order')).toEqual(['openai', 'ollama']);
  });

  it('reuses a detected env key instead of prompting', async () => {
    const config = tmpConfigManager();
    const prompter = {
      confirm: jest.fn()
        .mockResolvedValueOnce(true)  // openai from env
        .mockResolvedValue(false), // decline the rest
      hidden: jest.fn(),
      text: jest.fn()
    };
    const probe = jest.fn().mockResolvedValue(true);
    const env = { OPENAI_API_KEY: 'sk-env-key', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' };
    const out = { log: jest.fn() };

    await runInit({ config, prompter, probe, env, out });

    expect(prompter.hidden).not.toHaveBeenCalled();
    expect(config.getProviderConfig('openai').apiKey).toBe('sk-env-key');
    expect(out.log.mock.calls.flat().join('\n')).toContain('OPENAI_API_KEY is set');
  });

  it('skips configuration when the user declines everything', async () => {
    const config = tmpConfigManager();
    const prompter = {
      confirm: jest.fn().mockResolvedValue(false),
      hidden: jest.fn(),
      text: jest.fn()
    };
    const out = { log: jest.fn() };
    const result = await runInit({ config, prompter, probe: jest.fn(), env: {}, out });

    expect(result.configured).toBe(false);
    expect(fs.existsSync(config.configPath)).toBe(false);
  });
});

describe('PROBE_TEXT', () => {
  it('is a tiny, cheap probe prompt', () => {
    expect(PROBE_TEXT.length).toBeLessThan(60);
  });
});