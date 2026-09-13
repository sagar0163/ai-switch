const { OllamaProvider } = require('../../src/providers/ollama');
const { ProviderError } = require('../../src/utils/errors');
const { mockFetch, restoreFetch } = require('../helpers/fetchMock');

function makeProvider(overrides = {}) {
  return new OllamaProvider({
    model: 'llama2',
    baseUrl: 'http://localhost:11434',
    ...overrides
  });
}

describe('OllamaProvider request formatting', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('pings availability, then posts the correct URL and body', async () => {
    const fetchMock = mockFetch(
      { ok: true, status: 200, body: { models: [] } },
      {
        ok: true,
        status: 200,
        body: {
          model: 'llama2',
          response: 'hello',
          prompt_eval_count: 5,
          eval_count: 3
        }
      }
    );
    const provider = makeProvider({ model: 'llama3.2' });

    await provider.complete('ask me', { model: 'llama3.2', temperature: 0.5, maxTokens: 99 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe('http://localhost:11434/api/generate');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      model: 'llama3.2',
      prompt: 'ask me',
      stream: false
    });
    expect(body.options).toEqual({ temperature: 0.5, num_predict: 99 });
  });

  it('defaults temperature and num_predict when options are omitted', async () => {
    const fetchMock = mockFetch(
      { ok: true, body: { models: [] } },
      { ok: true, body: { model: 'llama2', response: 'hi' } }
    );
    await makeProvider().complete('ask me');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.options.temperature).toBe(0.7);
    expect(body.options.num_predict).toBe(2048);
  });
});

describe('OllamaProvider response parsing and availability', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('parses text and usage from a generate response', async () => {
    mockFetch(
      { ok: true, body: { models: [] } },
      {
        ok: true,
        body: {
          model: 'llama3.2',
          response: '  sure thing  ',
          prompt_eval_count: 96,
          eval_count: 12
        }
      }
    );
    const result = await makeProvider({ model: 'llama3.2' }).complete('hi');
    expect(result.text).toBe('sure thing');
    expect(result.usage).toEqual({
      model: 'llama3.2',
      inputTokens: 96,
      outputTokens: 12,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    });
  });

  it('isAvailable reflects a positive tags response', async () => {
    mockFetch({ ok: true, body: { models: ['llama2'] } });
    expect(await makeProvider().isAvailable()).toBe(true);
  });

  it('isAvailable is false when the server is unreachable', async () => {
    const fetchMock = global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await makeProvider().isAvailable()).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('listModels returns model names from tags', async () => {
    mockFetch({ ok: true, body: { models: [{ name: 'llama2' }, { name: 'mistral' }] } });
    expect(await makeProvider().listModels()).toEqual(['llama2', 'mistral']);
  });

  it('listModels returns [] on failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    expect(await makeProvider().listModels()).toEqual([]);
  });
});

describe('OllamaProvider failure modes', () => {
  afterEach(() => {
    restoreFetch();
  });

  it('fails fast when the server is unavailable', async () => {
    mockFetch({ ok: false, status: 500, body: {} });
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Ollama server not running');
  });

  it('throws ProviderError with Retry-After on 429', async () => {
    mockFetch(
      { ok: true, body: { models: [] } },
      {
        ok: false,
        status: 429,
        headers: { 'retry-after': '15' },
        body: { error: 'rate limited' }
      }
    );
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(15);
    expect(err.message).toBe('rate limited');
  });

  it('throws ProviderError on 5xx', async () => {
    mockFetch(
      { ok: true, body: { models: [] } },
      { ok: false, status: 500, body: {} }
    );
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('HTTP 500');
  });

  it('throws ProviderError when the generate response is empty', async () => {
    mockFetch(
      { ok: true, body: { models: [] } },
      { ok: true, body: { model: 'llama2', response: '' } }
    );
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe('No response from Ollama');
  });

  it('wraps malformed JSON in ProviderError', async () => {
    mockFetch(
      { ok: true, jsonError: null, body: { models: [] } },
      { ok: true, jsonError: new SyntaxError('Unexpected token') }
    );
    const err = await makeProvider().complete('hi').catch(e => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain('Unexpected token');
  });
});