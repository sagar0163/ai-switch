/**
 * Streaming helpers: turn a fetch `Response` body into async generators of
 * parsed chunks. Covers SSE (`data:` lines separated by blank lines) and
 * newline-delimited JSON (NDJSON), which is what the supported providers emit.
 */

/**
 * Read a fetch body as an iterator of non-empty lines.
 * @param {Response} response
 * @returns {AsyncGenerator<string>}
 */
async function* readLines(response) {
  const body = response && response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) yield line;
      }
    }

    const rest = buf.trim();
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse a Server-Sent Events stream, yielding one parsed JSON object per
 * `data:` event. Non-JSON and `[DONE]` sentinels are skipped.
 * @param {Response} response
 * @returns {AsyncGenerator<Object>}
 */
async function* parseSSE(response) {
  for await (const line of readLines(response)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;

    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      continue;
    }
    yield data;
  }
}

/**
 * Parse a newline-delimited JSON stream, yielding one object per line.
 * @param {Response} response
 * @returns {AsyncGenerator<Object>}
 */
async function* parseNDJSON(response) {
  for await (const line of readLines(response)) {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    yield data;
  }
}

module.exports = { readLines, parseSSE, parseNDJSON };