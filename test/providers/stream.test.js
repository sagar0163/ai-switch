const { OpenAIProvider } = require('../../src/providers/openai');
const { AnthropicProvider } = require('../../src/providers/anthropic');
const { GoogleProvider } = require('../../src/providers/google');
const { OllamaProvider } = require('../../src/providers/ollama');

function respond(payload, status = 200) {
  return new Response(payload, {
    status,
    headers: { 'content-type': 'text/event-stream' }
  });
}

describe('OpenAI streaming', () => {
  afterEach(() => jest.restoreAllMocks());

  it('concatenates stream deltas into the full answer and parses usage', async () => {
    const payload = [
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}',
      '',
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"}}]}',
      '',
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3}}',
      '',
      'data: [DONE]',
      '',
      ''
    ].join('\n');

    jest.spyOn(global, 'fetch').mockResolvedValue(respond(payload));

    const provider = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-test', baseUrl: 'https://api.test/v1' });
    const tokens = [];
    const result = await provider.streamComplete('hi', { maxTokens: 64 }, (t) => tokens.push(t));

    expect(tokens.join('')).toBe('Hello world');
    expect(result.text).toBe('Hello world');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(3);
    expect(result.usage.model).toBe('gpt-test');

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.test/v1/chat/completions');
    expect(JSON.parse(init.body).stream).toBe(true);
    expect(init.headers['Accept']).toBe('text/event-stream');
  });

  it('raises a ProviderError flagged partial when the stream dies after tokens', async () => {
    const payload = [
      'data: {"choices":[{"delta":{"content":"only"}}]}',
      '',
      'data: {"error":{"message":"overloaded"}}',
      '',
      ''
    ].join('\n');

    jest.spyOn(global, 'fetch').mockResolvedValue(respond(payload));

    const provider = new OpenAIProvider({ apiKey: 'sk-test', baseUrl: 'https://api.test/v1' });
    const tokens = [];
    let caught;
    try {
      await provider.streamComplete('hi', {}, (t) => tokens.push(t));
    } catch (error) {
      caught = error;
    }

    expect(tokens.join('')).toBe('only');
    expect(caught).toMatchObject({
      name: 'ProviderError',
      message: expect.stringContaining('overloaded'),
      partial: true
    });
  });
});

describe('Anthropic streaming', () => {
  afterEach(() => jest.restoreAllMocks());

  it('assembles content block deltas and merges usage from message events', async () => {
    const payload = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-test","usage":{"input_tokens":25,"output_tokens":0}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
      ''
    ].join('\n');

    jest.spyOn(global, 'fetch').mockResolvedValue(respond(payload));

    const provider = new AnthropicProvider({ apiKey: 'sk-ant', model: 'claude-opus', baseUrl: 'https://api.test/v1' });
    const tokens = [];
    const result = await provider.streamComplete('hi', {}, (t) => tokens.push(t));

    expect(tokens.join('')).toBe('Hello world');
    expect(result.text).toBe('Hello world');
    expect(result.usage.inputTokens).toBe(25);
    expect(result.usage.outputTokens).toBe(3);
    expect(result.usage.model).toBe('claude-test');

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init.body).stream).toBe(true);
  });

  it('fails on an error event', async () => {
    const payload = [
      'event: error',
      'data: {"type":"error","error":{"type":"overloaded_error","message":"nope"}}',
      '',
      ''
    ].join('\n');
    jest.spyOn(global, 'fetch').mockResolvedValue(respond(payload));

    const provider = new AnthropicProvider({ apiKey: 'sk-ant', baseUrl: 'https://api.test/v1' });
    await expect(provider.streamComplete('hi')).rejects.toThrow('nope');
  });
});

describe('Gemini streaming', () => {
  afterEach(() => jest.restoreAllMocks());

  it('dedupes cumulative text chunks into deltas and parses usageMetadata', async () => {
    const payload = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}',
      '',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello world"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":2,"totalTokenCount":11}}',
      '',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello world!"}]}}]}',
      '',
      ''
    ].join('\n');

    jest.spyOn(global, 'fetch').mockResolvedValue(respond(payload));

    const provider = new GoogleProvider({ apiKey: 'gk', model: 'gemini-test', baseUrl: 'https://api.test/v1beta' });
    const tokens = [];
    const result = await provider.streamComplete('hi', {}, (t) => tokens.push(t));

    expect(tokens).toEqual(['Hello', ' world', '!']);
    expect(result.text).toBe('Hello world!');
    expect(result.usage.outputTokens).toBe(2);
    expect(result.usage.inputTokens).toBe(9);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.test/v1beta/models/gemini-test:streamGenerateContent?alt=sse&key=gk');
    expect(init.headers['Accept']).toBe('text/event-stream');
  });

  it('fails on an in-band error block without emitting junk', async () => {
    const payload = [
      'data: {"error":{"code":429,"message":"quota exceeded"}}',
      '',
      ''
    ].join('\n');
    jest.spyOn(global, 'fetch').mockResolvedValue(respond(payload));

    const provider = new GoogleProvider({ apiKey: 'gk', baseUrl: 'https://api.test/v1beta' });
    await expect(provider.streamComplete('hi')).rejects.toThrow('quota exceeded');
  });
});

describe('Ollama streaming', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockOllama(generateLines) {
    jest.spyOn(global, 'fetch').mockImplementation((url, init) => {
      if (!init || init.method === 'GET') {
        return Promise.resolve(new Response('{"models":[]}', { status: 200 }));
      }
      const prefix = url.includes('/api/chat') ? 'chat' : 'generate';
      return Promise.resolve(respond(generateLines[prefix]), {});
    });
  }

  it('concatenates response deltas and parses final token counts (generate)', async () => {
    const lines = {
      generate: [
        '{"model":"llama-test","response":"Hello","done":false}',
        '{"model":"llama-test","response":" world","done":false}',
        '{"model":"llama-test","response":"","done":true,"prompt_eval_count":11,"eval_count":4}',
        ''
      ].join('\n')
    };
    mockOllama(lines);

    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434' });
    const tokens = [];
    const result = await provider.streamComplete('hi', {}, (t) => tokens.push(t));

    expect(tokens.join('')).toBe('Hello world');
    expect(result.text).toBe('Hello world');
    expect(result.usage.inputTokens).toBe(11);
    expect(result.usage.outputTokens).toBe(4);

    const [, init] = fetch.mock.calls.find(([url, init]) => init && init.method === 'POST');
    expect(JSON.parse(init.body).stream).toBe(true);
    expect(JSON.parse(init.body).prompt).toBe('hi');
  });

  it('concatenates message.content deltas on the chat endpoint', async () => {
    const lines = {
      chat: [
        '{"model":"llama-test","message":{"role":"assistant","content":"Hi"},"done":false}',
        '{"model":"llama-test","message":{"role":"assistant","content":" there"},"done":true,"prompt_eval_count":5,"eval_count":3}',
        ''
      ].join('\n')
    };
    mockOllama(lines);

    const provider = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434' });
    const tokens = [];
    const result = await provider.streamComplete('hi', {
      messages: [{ role: 'user', content: 'hi' }]
    }, (t) => tokens.push(t));

    expect(tokens.join('')).toBe('Hi there');
    expect(result.text).toBe('Hi there');
    expect(result.usage.inputTokens).toBe(5);
    expect(result.usage.outputTokens).toBe(3);

    const [, init] = fetch.mock.calls.find(([url, init]) => init && init.method === 'POST');
    expect(JSON.parse(init.body).messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});