const realFetch = global.fetch;

function jsonResponse({ ok = true, status = 200, body = null, headers = {}, jsonError = null } = {}) {
  return {
    ok,
    status,
    headers: {
      get: (name) => headers[String(name).toLowerCase()] ?? null
    },
    json: () => (jsonError ? Promise.reject(jsonError) : Promise.resolve(body))
  };
}

/**
 * Mock global.fetch with a queue of response descriptors. Each descriptor is
 * merged into `jsonResponse` defaults; the mock resolves calls in order.
 */
function mockFetch(...responses) {
  const fn = jest.fn();
  const queue = responses.length > 0 ? responses : [{}];
  for (const r of queue) {
    fn.mockResolvedValueOnce(jsonResponse(r));
  }
  global.fetch = fn;
  return fn;
}

function restoreFetch() {
  global.fetch = realFetch;
}

module.exports = { mockFetch, restoreFetch, jsonResponse };