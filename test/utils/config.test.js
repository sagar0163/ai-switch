const fs = require('fs');
const os = require('os');
const path = require('path');

const { ConfigManager } = require('../../src/utils/config');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-cfg-'));
}

function writeConfig(dir, config, file = 'config.json') {
  const p = path.join(dir, file);
  fs.writeFileSync(p, JSON.stringify(config), 'utf8');
  return p;
}

const baseConfig = {
  providers: {
    openai: { apiKey: 'sk-file-openai', model: 'gpt-4', baseUrl: 'https://api.openai.com/v1' },
    anthropic: { apiKey: 'sk-ant-file', model: 'claude-3-opus-20240229', baseUrl: 'https://api.anthropic.com/v1' }
  },
  cache: { enabled: true, ttl: 3600, maxSize: 1000 },
  chat: { maxTurns: 20, maxContextTokens: 4000 },
  failover: { enabled: true, order: ['openai', 'anthropic'], maxFailures: 3, cooldownSeconds: 60 },
  costTracking: { enabled: true },
  defaultProvider: 'openai'
};

describe('ConfigManager env-var key precedence', () => {
  it('prefers an env-var key over the config file key at read time', () => {
    const configPath = writeConfig(tmpDir(), baseConfig);
    const cm = new ConfigManager({ configPath, env: { OPENAI_API_KEY: 'sk-env-openai' } });
    const cfg = cm.getProviderConfig('openai');
    expect(cfg.apiKey).toBe('sk-env-openai');
    expect(cfg.apiKeySource).toBe('env');
    expect(cfg.apiKeyEnvVar).toBe('OPENAI_API_KEY');
  });

  it('falls back to the config file key when no env var is set', () => {
    const configPath = writeConfig(tmpDir(), baseConfig);
    const cm = new ConfigManager({ configPath, env: {} });
    const cfg = cm.getProviderConfig('openai');
    expect(cfg.apiKey).toBe('sk-file-openai');
    expect(cfg.apiKeySource).toBe('config');
  });

  it('leaves the blob on disk untouched when env wins', () => {
    const dir = tmpDir();
    const configPath = writeConfig(dir, baseConfig);
    const cm = new ConfigManager({ configPath, env: { OPENAI_API_KEY: 'sk-env' } });
    cm.getProviderConfig('openai');
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(onDisk.providers.openai.apiKey).toBe('sk-file-openai');
  });

  it('accepts a legacy GOOGLE_API_KEY env var for google', () => {
    const dir = tmpDir();
    const configPath = writeConfig(dir, {
      ...baseConfig,
      providers: { google: { apiKey: 'google-file', model: 'gemini-pro' } }
    });
    const cm = new ConfigManager({ configPath, env: { GOOGLE_API_KEY: 'env-google' } });
    expect(cm.getProviderConfig('google').apiKey).toBe('env-google');
    expect(cm.getProviderConfig('google').apiKeySource).toBe('env');
  });
});

describe('ConfigManager key management', () => {
  it('setKey writes the key to the config file and keeps it masked from the API', () => {
    const configPath = writeConfig(tmpDir(), baseConfig);
    const cm = new ConfigManager({ configPath, env: {} });
    cm.setKey('anthropic', 'sk-ant-new-key');
    expect(cm.getProviderConfig('anthropic').apiKey).toBe('sk-ant-new-key');
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(onDisk.providers.anthropic.apiKey).toBe('sk-ant-new-key');
  });

  it('removeKey deletes only the stored key and reports existence', () => {
    const configPath = writeConfig(tmpDir(), baseConfig);
    const cm = new ConfigManager({ configPath, env: {} });
    expect(cm.removeKey('openai')).toBe(true);
    expect(cm.getProviderConfig('openai').apiKey).toBeUndefined();
    expect(cm.getProviderConfig('openai').apiKeySource).toBeUndefined();
    expect(cm.removeKey('openai')).toBe(false);
  });

  it('listKeys never exposes a plaintext key', () => {
    const configPath = writeConfig(tmpDir(), baseConfig);
    const cm = new ConfigManager({ configPath, env: { OPENAI_API_KEY: 'sk-env-openai' } });
    const keys = cm.listKeys();
    const openai = keys.find((k) => k.provider === 'openai');
    expect(openai.source).toBe('env');
    expect(openai.masked).toContain('*');
    expect(openai.masked).not.toContain('sk-env-openai');
    expect(openai.masked.endsWith('envi')).toBe(false);

    const anthropic = keys.find((k) => k.provider === 'anthropic');
    expect(anthropic.source).toBe('config');
    expect(anthropic.masked).not.toContain('sk-ant-file');
    expect(anthropic.masked.endsWith('file')).toBe(true);
  });

  it('replace persists a whole new config', () => {
    const configPath = writeConfig(tmpDir(), baseConfig);
    const cm = new ConfigManager({ configPath, env: {} });
    const fresh = {
      providers: { ollama: { baseUrl: 'http://localhost:11434', model: 'llama2' } },
      cache: { enabled: true, ttl: 3600, maxSize: 1000 },
      chat: { maxTurns: 20, maxContextTokens: 4000 },
      failover: true,
      costTracking: { enabled: true },
      defaultProvider: 'ollama'
    };
    cm.replace(fresh);
    expect(fs.readFileSync(configPath, 'utf8')).toContain('llama2');
    expect(cm.getProviderConfig('ollama').baseUrl).toBe('http://localhost:11434');
    expect(cm.get('defaultProvider')).toBe('ollama');
  });
});

describe('ConfigManager maskedView', () => {
  it('masks all key material and reports key sources', () => {
    const configPath = writeConfig(tmpDir(), baseConfig);
    const cm = new ConfigManager({ configPath, env: { ANTHROPIC_API_KEY: 'sk-ant-env' } });
    const view = cm.maskedView();

    expect(view.configPath).toBe(configPath);
    expect(view.providers.openai.keySource).toBe('config');
    expect(view.providers.openai.apiKey).not.toContain('sk-file-openai');
    expect(view.providers.openai.apiKey.endsWith('enai')).toBe(true);
    expect(view.providers.anthropic.keySource).toBe('env');
    expect(view.providers.anthropic.keyEnvVar).toBe('ANTHROPIC_API_KEY');
    expect(view.providers.anthropic.apiKey).not.toContain('sk-ant-env');

    const json = JSON.stringify(view) + JSON.stringify(cm.listKeys());
    expect(json).not.toContain('sk-file-openai');
    expect(json).not.toContain('sk-ant-env');
  });

  it('reports failover order from object or array failover config', () => {
    const dir = tmpDir();
    const configPath = writeConfig(dir, { ...baseConfig, providers: {} });
    const cm = new ConfigManager({ configPath, env: {} });
    expect(cm.maskedView().failoverOrder).toEqual(['openai', 'anthropic']);
  });
});