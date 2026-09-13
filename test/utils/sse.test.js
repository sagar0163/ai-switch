const { parseSSE } = require('../../src/utils/sse');

const { ReadableStream } = require('node:stream/web');

function streamBody(chunks) {
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
  return new Response(body, { status: 200 });
}

async function collect(chunks) {
  const out = [];
  for await (const evt of parseSSE(streamBody(chunks))) {
    out.push(evt);
  }
  return out;
}

describe('parseSSE', () => {
  it('parses SSE data: events and skips the [DONE] sentinel', async () => {
    const evts = await collect([
      'data: {"a":1}\n\n',
      'data: {"b":2}\n\n',
      'data: [DONE]\n\n'
    ]);
    expect(evts).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('parses plain NDJSON lines (Ollama style)', async () => {
    const evts = await collect([
      '{"response":"hi","done":false}\n',
      '{"response":"there","done":true}\n'
    ]);
    expect(evts).toEqual([
      { response: 'hi', done: false },
      { response: 'there', done: true }
    ]);
  });

  it('assembles events split across chunk boundaries', async () => {
    const evts = await collect([
      'data: {"x":',
      '123,"y":4}\n\n',
      'event: ping\ndata: {"z":5}\n\n'
    ]);
    expect(evts).toEqual([{ x: 123, y: 4 }, { z: 5 }]);
  });

  it('skips non-JSON lines (keepalives, retry/event metadata)', async () => {
    const evts = await collect([
      ': keep-alive comment\n',
      'retry: 1000\n',
      'event: ping\n',
      'data: not-json\n\n',
      'data: {"ok":true}\n\n'
    ]);
    expect(evts).toEqual([{ ok: true }]);
  });

  it('handles \r\n line endings', async () => {
    const evts = await collect(['data: {"a":1}\r\n\r\n', 'data: {"b":2}\r\n\r\n']);
    expect(evts).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('throws when the response has no streamable body', async () => {
    await expect(async () => {
      for await (const _e of parseSSE({})) { /* noop */ }
    }).rejects.toThrow('not streamable');
  });
});