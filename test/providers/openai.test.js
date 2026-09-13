const { OpenAIProvider } = require('../../src/providers/openai');
const { ProviderError } = require('../../src/utils/errors');
const { mockFetch, restoreFetch } = require('../helpers/fetchMock');

function makeProvider(overrides = {}) {
  return new OpenAIProvider({
    apiKey: 'sk-test',
    model: 'gpt-4',
    baseUrl: 'https://api.openai.com/v1',
    ...overrides
  });
}

describe('OpenAIProvider request formatting', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('posts the correct URL, headers, and body', async () => {
    const fetchMock = mockFetch({
      body: {
        model: 'gpt-4',
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 }
      }
    });
    const provider = makeProvider({ model: 'gpt-4-turbo' });

    await provider.complete('ask me', { model: 'gpt-4-turbo', temperature: 0.2, maxTokens: 512 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-test'
    });
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      model: 'gpt-4-turbo',
      temperature: 0.2,
      max_tokens: 512
    });
    expect(body.messages).toEqual([{ role: 'user', content: 'ask me' }]);
  });

  it('defaults temperature and max_tokens when options are omitted', async () => {
    const fetchMock = mockFetch({
      body: {
        model: 'gpt-4',
        choices: [{ message: { content: 'hi' } }],
        usage: {}
      }
    });
    await makeProvider().complete('ask me');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(2048);
  });
});

describe('OpenAIProvider response parsing', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('parses text and usage from a chat completion', async () => {
    mockFetch({
      body: {
        model: 'gpt-4o-2024-08-06',
        choices: [{ message: { content: '  Hello world  ' } }],
        usage: { prompt_tokens: 210, completion_tokens: 57 }
      }
    });
    const result = await makeProvider({ model: 'gpt-4o-2024-08-06' }).complete('hi');
    expect(result.text).toBe('Hello world');
    expect(result.usage).toEqual({
      model: 'gpt-4o-2024-08-06',
      inputTokens: 210,
      outputTokens: 57,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    });
  });
});

describe('OpenAIProvider failure modes', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('throws ProviderError with Retry-After on 429', async () => {
    mockFetch({
      ok: false,
      status: 429,
      headers: { 'retry-after': '120' },
      body: { error: { message: 'rate limited' } }
    });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(120);
    expect(err.provider).toBe('openai');
    expect(err.message).toBe('rate limited');
  });

  it('throws ProviderError on 5xx with default HTTP message', async () => {
    mockFetch({ ok: false, status: 503, body: {} });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(503);
    expect(err.message).toBe('HTTP 503');
  });

  it('handles an non-JSON error body on 5xx', async () => {
    mockFetch({ ok: false, status: 500, jsonError: new SyntaxError('bad json') });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('HTTP 500');
  });

  it('throws ProviderError for an empty success body', async () => {
    mockFetch({ ok: true, status: 200, body: {} });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('Invalid response format from OpenAI');
  });

  it('wraps malformed JSON in ProviderError', async () => {
    mockFetch({ ok: true, status: 200, jsonError: new SyntaxError('Unexpected token < in JSON') });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.provider).toBe('openai');
    expect(err.message).toContain('Unexpected token');
  });
});