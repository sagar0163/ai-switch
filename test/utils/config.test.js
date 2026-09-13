const fs = require('fs');
const os = require('os');
const path = require('path');

const { ConfigManager } = require('../../src/utils/config');
const { ConfigurationError } = require('../../src/utils/errors');

function tmpConfigFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-config-'));
  const file = path.join(dir, 'config.json');
  if (contents !== undefined) {
    fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
  }
  return file;
}

describe('ConfigManager defaults', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns defaults when no config file exists', () => {
    const config = new ConfigManager(tmpConfigFile(undefined));
    expect(config.get('cache.enabled')).toBe(true);
    expect(config.get('cache.ttl')).toBe(3600);
    expect(config.get('failover')).toBe(true);
    expect(config.get('defaultProvider')).toBe('openai');
    expect(config.get('providers.openai.model')).toBe('gpt-4');
    expect(config.get('providers.openai.baseUrl')).toBe('https://api.openai.com/v1');
    expect(config.get('costTracking.enabled')).toBe(true);
  });

  it('pulls default provider keys from environment variables', () => {
    process.env.OPENAI_API_KEY = 'env-openai-key';
    process.env.ANTHROPIC_API_KEY = 'env-anthropic-key';
    const config = new ConfigManager(tmpConfigFile(undefined));
    expect(config.get('providers.openai.apiKey')).toBe('env-openai-key');
    expect(config.get('providers.anthropic.apiKey')).toBe('env-anthropic-key');
  });

  it('falls back to empty apiKey when no env var is set', () => {
    const config = new ConfigManager(tmpConfigFile(undefined));
    expect(config.get('providers.openai.apiKey')).toBe('');
    expect(config.get('providers.anthropic.apiKey')).toBe('');
  });
});

describe('ConfigManager file precedence and overrides', () => {
  it('config file values take precedence over environment variables', () => {
    process.env.OPENAI_API_KEY = 'env-openai-key';
    const config = new ConfigManager(tmpConfigFile({
      providers: {
        openai: { apiKey: 'file-openai-key', model: 'gpt-4-turbo' }
      }
    }));
    expect(config.get('providers.openai.apiKey')).toBe('file-openai-key');
    expect(config.get('providers.openai.model')).toBe('gpt-4-turbo');
  });

  it('reads the config file as the complete source of truth', () => {
    const config = new ConfigManager(tmpConfigFile({
      providers: { google: { apiKey: 'g', model: 'gemini-pro' } },
      defaultProvider: 'google',
      cache: { enabled: false }
    }));
    expect(config.get('defaultProvider')).toBe('google');
    expect(config.get('cache.enabled')).toBe(false);
    expect(config.get('providers.google.apiKey')).toBe('g');
  });

  it('set() writes through and persists to disk', () => {
    const file = tmpConfigFile({ cache: { enabled: true } });
    const config = new ConfigManager(file);
    config.set('providers.openai.apiKey', 'sk-set');
    config.set('failover', { enabled: true, order: ['anthropic', 'openai'] });

    const reloaded = new ConfigManager(file);
    expect(reloaded.get('providers.openai.apiKey')).toBe('sk-set');
    expect(reloaded.get('failover.order')).toEqual(['anthropic', 'openai']);
  });

  it('get returns the default value for missing keys', () => {
    const config = new ConfigManager(tmpConfigFile({ cache: { enabled: true } }));
    expect(config.get('providers.gemini.apiKey', 'fallback')).toBe('fallback');
    expect(config.get('nope.nope.nope', 42)).toBe(42);
  });

  it('throws ConfigurationError on an unreadable config file', () => {
    expect(() => new ConfigManager(tmpConfigFile('{ not valid json')))
      .toThrow(ConfigurationError);
    expect(() => new ConfigManager(tmpConfigFile('{ not valid json')))
      .toThrow('Failed to load config');
  });

  it('getProviderConfig returns provider sub-tree', () => {
    const config = new ConfigManager(tmpConfigFile({
      providers: { openai: { apiKey: 'k', model: 'm' } }
    }));
    expect(config.getProviderConfig('openai')).toEqual({ apiKey: 'k', model: 'm' });
    expect(config.getProviderConfig('missing')).toBeNull();
  });

  it('getAllProviders lists configured provider names', () => {
    const config = new ConfigManager(tmpConfigFile({
      providers: { openai: {}, anthropic: {}, google: {} }
    }));
    expect(config.getAllProviders()).toEqual(['openai', 'anthropic', 'google']);
  });
});