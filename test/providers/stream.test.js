const { OpenAIProvider } = require('../../src/providers/openai');
const { AnthropicProvider } = require('../../src/providers/anthropic');
const { GoogleProvider } = require('../../src/providers/google');
const { OllamaProvider } = require('../../src/providers/ollama');
const { BaseProvider } = require('../../src/providers/base');
const { ProviderError } = require('../../src/utils/errors');

const { ReadableStream } = require('node:stream/web');

function streamResponse(chunks, status = 200, headers = {}) {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream({
    async pull(c) {
      if (i >= chunks.length) {
        c.close();
        return;
      }
      c.enqueue(enc.encode(chunks[i]));
      i += 1;
    }
  });
  return new Response(body, { status, headers });
}

function errorResponse(status, body) {
  return new Response(JSON.stringify(body), { status });
}

async function pumpStream(gen) {
  const events = [];
  let text = '';
  for await (const evt of gen) {
    events.push(evt);
    if (evt.delta) text += evt.delta;
  }
  const done = events.find((e) => e.done);
  return { events, text, done };
}

describe('OpenAIProvider.stream', () => {
  afterEach(() => jest.restoreAllMocks());

  it('streams deltas and reports usage from the final chunk', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(streamResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n'
    ]));

    const p = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4' });
    const { text, done } = await pumpStream(p.stream('hi'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"stream":true')
      })
    );
    expect(text).toBe('Hello world');
    expect(done.text).toBe('Hello world');
    expect(done.usage).toEqual(expect.objectContaining({ inputTokens: 5, outputTokens: 3 }));
  });

  it('throws ProviderError with retry info on non-ok responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      errorResponse(429, { error: { message: 'rate limited' } })
    );
    const p = new OpenAIProvider({ apiKey: 'k' });
    await expect(
      (async () => { for await (const _e of p.stream('hi')) { /* noop */ } })()
    ).rejects.toMatchObject({ name: 'ProviderError', statusCode: 429 });
  });
});

describe('AnthropicProvider.stream', () => {
  it('streams text_delta events and aggregates input/output tokens', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(streamResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":0}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":6}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]));

    const p = new AnthropicProvider({ apiKey: 'k', model: 'claude-3-haiku' });
    const { text, done } = await pumpStream(p.stream('hi'));

    expect(text).toBe('Hi there');
    expect(done.usage).toEqual(expect.objectContaining({ inputTokens: 9, outputTokens: 6 }));
  });

  it('throws ProviderError on a mid-stream error event', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(streamResponse([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n',
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}\n\n'
    ]));

    const p = new AnthropicProvider({ apiKey: 'k' });
    await expect(
      (async () => { for await (const _e of p.stream('hi')) { /* noop */ } })()
    ).rejects.toMatchObject({ name: 'ProviderError', message: 'overloaded' });
  });
});

describe('GoogleProvider.stream', () => {
  it('streams text deltas across parts and chunks', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(streamResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"Yo"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"!"},{"text":"!"}]}}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":3}}\n\n'
    ]));

    const p = new GoogleProvider({ apiKey: 'k', model: 'gemini-pro' });
    const { text, done } = await pumpStream(p.stream('hi'));

    expect(text).toBe('Yo!!');
    expect(done.usage).toEqual(expect.objectContaining({ inputTokens: 4, outputTokens: 3 }));
  });

  it('throws ProviderError when the request is blocked', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(streamResponse([
      'data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n'
    ]));

    const p = new GoogleProvider({ apiKey: 'k' });
    await expect(
      (async () => { for await (const _e of p.stream('hi')) { /* noop */ } })()
    ).rejects.toMatchObject({ name: 'ProviderError', message: expect.stringContaining('blocked') });
  });
});

describe('OllamaProvider.stream', () => {
  it('streams NDJSON response deltas and reads the final usage', async () => {
    const p = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    p.isAvailable = jest.fn().mockResolvedValue(true);
    jest.spyOn(global, 'fetch').mockResolvedValue(streamResponse([
      '{"model":"llama2","response":"How","done":false}\n',
      '{"model":"llama2","response":"dy","done":false}\n',
      '{"model":"llama2","response":"","done":true,"prompt_eval_count":4,"eval_count":3}\n'
    ]));

    const { text, done } = await pumpStream(p.stream('hi'));

    expect(text).toBe('Howdy');
    expect(done.usage).toEqual(expect.objectContaining({ inputTokens: 4, outputTokens: 3 }));
  });

  it('throws ProviderError when the server is unreachable', async () => {
    const p = new OllamaProvider({ baseUrl: 'http://localhost:11434' });
    p.isAvailable = jest.fn().mockResolvedValue(false);

    await expect(
      (async () => { for await (const _e of p.stream('hi')) { /* noop */ } })()
    ).rejects.toMatchObject({ name: 'ProviderError', message: expect.stringContaining('Ollama server not running') });
  });
});

describe('BaseProvider.stream fallback', () => {
  class Stub extends BaseProvider {
    async complete() {
      return { text: 'unbuffered text', usage: { inputTokens: 2 } };
    }
  }

  it('yields the buffered complete() result as a single delta + done event', async () => {
    const p = new Stub({});
    const { text, done, events } = await pumpStream(p.stream('hi'));
    expect(text).toBe('unbuffered text');
    expect(done.text).toBe('unbuffered text');
    expect(done.usage).toEqual({ inputTokens: 2 });
    expect(events.filter((e) => e.delta).length).toBe(1);
  });
});