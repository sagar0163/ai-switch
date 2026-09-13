const { ENV_KEYS, PROVIDER_ORDER, envVarNames, resolveKey, maskKey } = require('../../src/utils/keys');

describe('keys env mapping', () => {
  it('maps the canonical env var per cloud provider', () => {
    expect(ENV_KEYS.openai).toBe('OPENAI_API_KEY');
    expect(ENV_KEYS.anthropic).toBe('ANTHROPIC_API_KEY');
    expect(ENV_KEYS.google).toBe('GEMINI_API_KEY');
  });

  it('accepts GOOGLE_API_KEY as a fallback for gemini keys', () => {
    expect(envVarNames('google')).toEqual(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
    const resolved = resolveKey('google', {}, { GEMINI_API_KEY: '', GOOGLE_API_KEY: 'g-alt' });
    expect(resolved).toEqual({ source: 'env', envVar: 'GOOGLE_API_KEY', key: 'g-alt' });
  });

  it('returns no env vars for ollama (local, keyless)', () => {
    expect(envVarNames('ollama')).toEqual([]);
  });
});

describe('keys precedence', () => {
  it('env-var key wins over the config file key', () => {
    const resolved = resolveKey('openai', { apiKey: 'sk-from-file' }, { OPENAI_API_KEY: 'sk-from-env' });
    expect(resolved.source).toBe('env');
    expect(resolved.envVar).toBe('OPENAI_API_KEY');
    expect(resolved.key).toBe('sk-from-env');
  });

  it('falls back to the config file key when no env var is set', () => {
    const resolved = resolveKey('anthropic', { apiKey: 'sk-ant-from-file' }, {});
    expect(resolved).toEqual({ source: 'config', envVar: null, key: 'sk-ant-from-file' });
  });

  it('reports no key when neither source has one', () => {
    expect(resolveKey('openai', {}, {}).source).toBeNull();
  });
});

describe('maskKey', () => {
  it('never returns the plaintext', () => {
    expect(maskKey('sk-super-secret-1234')).not.toContain('super-secret');
  });

  it('reveals only the trailing characters', () => {
    expect(maskKey('sk-super-secret-1234')).toBe('****************1234');
  });

  it('handles short and missing values', () => {
    expect(maskKey('abcd')).toBe('****');
    expect(maskKey('')).toBe('');
    expect(maskKey(null)).toBe('');
  });

  it('honors a custom visible count', () => {
    expect(maskKey('abcdefgh', 2)).toBe('******gh');
  });
});

describe('provider order for init/keys listings', () => {
  it('lists cloud providers before ollama', () => {
    expect(PROVIDER_ORDER).toEqual(['openai', 'anthropic', 'google', 'ollama']);
  });
});