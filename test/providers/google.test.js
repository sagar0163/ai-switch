const { GoogleProvider } = require('../../src/providers/google');
const { ProviderError } = require('../../src/utils/errors');
const { mockFetch, restoreFetch } = require('../helpers/fetchMock');

function makeProvider(overrides = {}) {
  return new GoogleProvider({
    apiKey: 'google-key',
    model: 'gemini-pro',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    ...overrides
  });
}

describe('GoogleProvider request formatting', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('posts the correct URL (with key) and body', async () => {
    const fetchMock = mockFetch({
      body: {
        candidates: [{ content: { parts: [{ text: 'hi' }] } }],
        usageMetadata: {}
      }
    });
    const provider = makeProvider({ model: 'gemini-2.5-flash' });

    await provider.complete('ask me', { model: 'gemini-2.5-flash', temperature: 0.3, maxTokens: 64 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=google-key'
    );
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.contents).toEqual([{ parts: [{ text: 'ask me' }] }]);
    expect(body.generationConfig).toMatchObject({
      temperature: 0.3,
      maxOutputTokens: 64
    });
  });

  it('defaults temperature and maxOutputTokens when options are omitted', async () => {
    const fetchMock = mockFetch({
      body: {
        candidates: [{ content: { parts: [{ text: 'hi' }] } }],
        usageMetadata: {}
      }
    });
    await makeProvider().complete('ask me');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.generationConfig.temperature).toBe(0.7);
    expect(body.generationConfig.maxOutputTokens).toBe(2048);
  });
});

describe('GoogleProvider response parsing', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('parses text and usage from generateContent', async () => {
    mockFetch({
      body: {
        candidates: [{ content: { parts: [{ text: '  Great answer  ' }] } }],
        usageMetadata: { promptTokenCount: 128, candidatesTokenCount: 33 }
      }
    });
    const result = await makeProvider({ model: 'gemini-pro' }).complete('hi');
    expect(result.text).toBe('Great answer');
    expect(result.usage).toEqual({
      model: 'gemini-pro',
      inputTokens: 128,
      outputTokens: 33,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    });
  });
});

describe('GoogleProvider failure modes', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('throws ProviderError with Retry-After on 429', async () => {
    mockFetch({
      ok: false,
      status: 429,
      headers: { 'retry-after': '30' },
      body: { error: { message: 'quota exceeded' } }
    });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(30);
    expect(err.message).toBe('quota exceeded');
  });

  it('throws ProviderError on 5xx with default HTTP message', async () => {
    mockFetch({ ok: false, status: 500, body: {} });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('HTTP 500');
  });

  it('throws ProviderError for an empty success body', async () => {
    mockFetch({ ok: true, body: {} });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Invalid response format from Google AI');
  });

  it('wraps malformed JSON in ProviderError', async () => {
    mockFetch({ ok: true, jsonError: new SyntaxError('Unexpected token') });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Unexpected token');
  });
});