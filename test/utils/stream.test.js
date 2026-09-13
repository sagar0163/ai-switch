const { forEachLine, forEachSSEEvent } = require('../../src/utils/stream');

const enc = new TextEncoder();

function chunkedBody(parts) {
  const stream = new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(enc.encode(part));
      controller.close();
    }
  });
  return new Response(stream);
}

describe('forEachLine', () => {
  it('splits a body into trimmed lines (blank lines preserved)', async () => {
    const lines = [];
    await forEachLine(new Response('a\n  b  \n\nc\n'), (line) => lines.push(line));
    expect(lines).toEqual(['a', 'b', '', 'c', '']);
  });

  it('joins fragments split across stream chunks', async () => {
    const lines = [];
    await forEachLine(
      chunkedBody(['Hel', 'lo\nWo', 'rld\n', 'tail']),
      (line) => lines.push(line)
    );
    expect(lines).toEqual(['Hello', 'World', 'tail']);
  });

  it('falls back to buffered JSON when there is no streamable body', async () => {
    const lines = [];
    await forEachLine({ body: null, json: async () => ({ ok: true }) }, (line) => lines.push(line));
    expect(lines).toEqual(['{"ok":true}']);
  });
});

describe('forEachSSEEvent', () => {
  it('parses a simple data-only event on blank-line flush', async () => {
    const events = [];
    await forEachSSEEvent(new Response('data: {"a":1}\n\ndata: {"a":2}\n\n'), (e) => events.push(e));
    expect(events).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'message', data: '{"a":2}' }
    ]);
  });

  it('carries event: names (Anthropic-style)', async () => {
    const events = [];
    await forEachSSEEvent(
      new Response([
        'event: message_start\n',
        'data: {"type":"message_start"}\n\n',
        'event: content_block_delta\n',
        'data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n'
      ].join('')),
      (e) => events.push(e)
    );
    expect(events).toEqual([
      { event: 'message_start', data: '{"type":"message_start"}' },
      { event: 'content_block_delta', data: '{"type":"content_block_delta","delta":{"text":"hi"}}' }
    ]);
  });

  it('joins multi-line data payloads into one event', async () => {
    const events = [];
    await forEachSSEEvent(
      new Response('data: {"a":\n  1}\n\ndata: [DONE]\n\n'),
      (e) => events.push(e)
    );
    expect(events).toEqual([
      { event: 'message', data: '{"a":\n1}' },
      { event: 'message', data: '[DONE]' }
    ]);
  });

  it('ignores comment/keep-alive lines', async () => {
    const events = [];
    await forEachSSEEvent(
      new Response(': ping\ndata: {"ok":true}\n\n'),
      (e) => events.push(e)
    );
    expect(events).toEqual([{ event: 'message', data: '{"ok":true}' }]);
  });
});