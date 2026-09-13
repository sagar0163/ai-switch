/**
 * Server-Sent Events / NDJSON parser.
 *
 * Reads a `fetch` Response body and yields parsed JSON events as they arrive.
 * Supports both SSE framing (`data: {...}` lines, optionally split across
 * chunks) and plain newline-delimited JSON (used by Ollama's streaming API).
 *
 * The final `[DONE]` sentinel is consumed and not yielded.
 */

/**
 * Parse a streaming response body into JSON events.
 * @param {Response} response - A `fetch` Response with a readable body
 * @returns {AsyncGenerator<Object>} Parsed JSON events
 */
async function* parseSSE(response) {
  if (!response || !response.body) {
    throw new Error('Response body is not streamable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        let payload = line;
        if (payload.startsWith('data:')) {
          const data = payload.slice(5).trim();
          if (data === '[DONE]') return;
          payload = data;
        }

        if (payload) {
          let event;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }
          yield event;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

module.exports = { parseSSE };