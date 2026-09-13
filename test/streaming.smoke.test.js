const fs = require('fs');
const os = require('os');
const path = require('path');

const { AISwitch } = require('../src/index');

function tmpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-smoke-'));
  const config = {
    providers: {
      openai: { apiKey: 'sk-openai', model: 'gpt-test', baseUrl: 'https://api.test/v1' }
    },
    cache: { enabled: false },
    costTracking: { enabled: false },
    failover: true,
    defaultProvider: 'openai'
  };
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(config), 'utf8');
  return file;
}

const SSE = (line) => line + '\n\n';

describe('streaming smoke: real provider through AISwitch.ask', () => {
  afterEach(() => jest.restoreAllMocks());

  it('streamed ask() output equals buffered ask() output for the same prompt', async () => {
    const full = 'The quick brown fox.';

    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      if (!body.stream) {
        return new Response(JSON.stringify({
          model: 'gpt-test',
          choices: [{ message: { content: full } }],
          usage: { prompt_tokens: 4, completion_tokens: 6 }
        }), { status: 200 });
      }
      // Streaming mirror: emit the same text in fragments, plus usage chunk.
      const chunks = [
        SSE(`data: {"choices":[{"delta":{"content":"The quick "}}]}`),
        SSE(`data: {"choices":[{"delta":{"content":"brown fox."}}]}`),
        SSE(`data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":6}}`),
        SSE('data: [DONE]'),
        SSE(': keep-alive')
      ].join('');
      return new Response(chunks, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const ai = new AISwitch({ configPath: tmpConfig() });

    const buffered = await ai.ask('tell me a fable', { provider: 'openai', stream: false });
    expect(buffered).toBe(full);

    const tokens = [];
    const streamed = await ai.ask('tell me a fable', {
      provider: 'openai',
      stream: true,
      onToken: (token) => tokens.push(token)
    });

    expect(tokens.join('')).toBe(full);
    expect(streamed).toBe(full);
    expect(streamed).toBe(buffered);
  });
});