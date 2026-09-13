const { AnthropicProvider } = require('../../src/providers/anthropic');
const { ProviderError } = require('../../src/utils/errors');
const { mockFetch, restoreFetch } = require('../helpers/fetchMock');

function makeProvider(overrides = {}) {
  return new AnthropicProvider({
    apiKey: 'sk-ant-test',
    model: 'claude-3-opus-20240229',
    baseUrl: 'https://api.anthropic.com/v1',
    ...overrides
  });
}

describe('AnthropicProvider request formatting', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('posts the correct URL, headers, and body', async () => {
    const fetchMock = mockFetch({
      body: {
        model: 'claude-sonnet-4-5',
        content: [{ text: 'hi' }],
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    });
    const provider = makeProvider();

    await provider.complete('ask me', { model: 'claude-sonnet-4-5', temperature: 1, maxTokens: 128 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01'
    });
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      model: 'claude-sonnet-4-5',
      temperature: 1,
      max_tokens: 128
    });
    expect(body.messages).toEqual([{ role: 'user', content: 'ask me' }]);
  });

  it('defaults temperature and max_tokens when options are omitted', async () => {
    const fetchMock = mockFetch({
      body: {
        model: 'claude-3-opus-20240229',
        content: [{ text: 'hi' }],
        usage: {}
      }
    });
    await makeProvider().complete('ask me');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(2048);
  });
});

describe('AnthropicProvider response parsing', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('parses text and usage including cache token counts', async () => {
    mockFetch({
      body: {
        model: 'claude-sonnet-4-5-20250929',
        content: [{ text: '  Hello there  ' }],
        usage: {
          input_tokens: 342,
          output_tokens: 41,
          cache_read_input_tokens: 1500,
          cache_creation_input_tokens: 60
        }
      }
    });
    const result = await makeProvider().complete('hi');
    expect(result.text).toBe('Hello there');
    expect(result.usage).toEqual({
      model: 'claude-sonnet-4-5-20250929',
      inputTokens: 342,
      outputTokens: 41,
      cacheReadTokens: 1500,
      cacheCreationTokens: 60
    });
  });
});

describe('AnthropicProvider failure modes', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('throws ProviderError with Retry-After on 429', async () => {
    mockFetch({
      ok: false,
      status: 429,
      headers: { 'retry-after': '300' },
      body: { error: { message: 'too many requests' } }
    });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(300);
    expect(err.message).toBe('too many requests');
  });

  it('throws ProviderError on 5xx with default HTTP message', async () => {
    mockFetch({ ok: false, status: 529, body: {} });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(529);
    expect(err.message).toBe('HTTP 529');
  });

  it('throws ProviderError for an empty success body', async () => {
    mockFetch({ ok: true, body: {} });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Invalid response format from Anthropic');
  });

  it('wraps malformed JSON in ProviderError', async () => {
    mockFetch({ ok: true, jsonError: new SyntaxError('Unexpected end of JSON input') });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Unexpected end of JSON');
  });
});