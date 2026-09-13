/**
 * Streaming helpers shared across providers.
 *
 * Providers expose a `streamComplete()` method that reads a streaming HTTP
 * response body (SSE for OpenAI/Anthropic/Gemini, NDJSON for Ollama) and calls
 * an `onToken(fragment)` callback as text arrives, then resolves with the same
 * `{ text, usage }` shape as the buffered `complete()` path.
 */

const { ProviderError } = require('./errors');

/**
 * Iterate the trimmed lines of a streaming HTTP response body.
 * Falls back to a single JSON line when the body is not a stream.
 * @param {Response} response - fetch() Response
 * @param {(line: string) => void} onLine - Called per trimmed non-empty line
 */
async function forEachLine(response, onLine) {
  if (!response.body) {
    const data = await response.json().catch(() => null);
    if (data) {
      for (const line of JSON.stringify(data).split('\n')) onLine(line.trim());
    }
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) onLine(line);
    }
  }
  if (buffer.trim()) onLine(buffer.trim());
}

/**
 * Parse SSE events from a response body, emitting `{ event, data }` objects.
 * Honors `event:` names (Anthropic), `data:` payloads, blank-line flush
 * boundaries, and `:` comment/keep-alive lines.
 * @param {Response} response - fetch() Response
 * @param {(event: {event: string, data: string}) => void} onEvent
 */
async function forEachSSEEvent(response, onEvent) {
  let event = 'message';
  const data = [];

  const flush = () => {
    if (data.length === 0) return;
    onEvent({ event, data: data.join('\n') });
    data.length = 0;
  };

  await forEachLine(response, (line) => {
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) {
      flush();
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    } else if (line === '') {
      flush();
      event = 'message';
    }
  });
  flush();
}

/**
 * Accumulates streamed fragments and raises provider errors that know whether
 * partial text was already emitted, so callers can avoid concatenating garbage.
 */
class StreamController {
  constructor({ provider, onToken }) {
    this.provider = provider;
    this.onToken = (typeof onToken === 'function' ? onToken : (() => {}));
    this.text = '';
  }

  /**
   * Emit a text fragment: accumulate it and forward it to the onToken callback.
   * @param {string} fragment
   */
  push(fragment) {
    if (!fragment) return;
    this.text += fragment;
    this.onToken(fragment);
  }

  /**
   * Throw a ProviderError that is flagged `partial` when some text already streamed.
   * @param {string} message
   * @param {number} [statusCode]
   * @param {number|string} [retryAfter]
   */
  fail(message, statusCode = null, retryAfter = null) {
    const error = new ProviderError(message, this.provider, statusCode, retryAfter);
    error.partial = this.text.length > 0;
    throw error;
  }
}

module.exports = { forEachLine, forEachSSEEvent, StreamController };