const { BaseProvider } = require('../../src/providers/base');
const { ProviderError } = require('../../src/utils/errors');

class StubProvider extends BaseProvider {}

describe('BaseProvider', () => {
  it('complete() throws by default', async () => {
    const provider = new StubProvider({ apiKey: 'k' });
    await expect(provider.complete('hi')).rejects.toThrow('must be implemented');
  });

  it('isAvailable() requires an apiKey or baseUrl', () => {
    expect(new StubProvider({ apiKey: 'k' }).isAvailable()).toBe(true);
    expect(new StubProvider({ baseUrl: 'http://x' }).isAvailable()).toBe(true);
    expect(new StubProvider({}).isAvailable()).toBe(false);
    expect(new StubProvider().isAvailable()).toBe(false);
  });

  it('_formatError prefers the response error message over the caught message', () => {
    const provider = new StubProvider({ apiKey: 'k' });
    const caught = new Error('network failure');
    expect(provider._formatError(caught)).toBe('network failure');
    expect(provider._formatError(caught, { error: { message: 'server said no' } }))
      .toBe('server said no');
    expect(provider._formatError(caught, {})).toBe('network failure');
  });

  it('exposes default name, model, and null baseUrl', () => {
    const provider = new StubProvider({});
    expect(provider.name).toBe('base');
    expect(provider.defaultModel).toBe('unknown');
    expect(provider.baseUrl).toBeNull();
  });
});