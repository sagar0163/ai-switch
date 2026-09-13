# WAR ROOM PLAN — Issue #5: streaming responses for ask and chat

## Design

- Streaming contract: each provider gets `async *stream(prompt, options)` yielding
  `{ delta }` per token chunk and a final `{ done: true, text, usage, model }`.
  `BaseProvider.stream` falls back to `complete()` (emit full text as one delta).
- New `src/utils/sse.js` parses SSE (`data:` lines) AND NDJSON (Ollama) from a
  `fetch` Response body into an async generator of JSON events.
- `AISwitch.ask` gets `stream`, `onToken`, `onResult` options. When `stream` is
  truthy it iterates `provider.stream`, calls `onToken(delta)` per chunk, fails
  over to the next provider on error (partial text from a failed provider is
  discarded, not concatenated), caches the completed text, and returns the text
  string as before. Cache hits short-circuit before any streaming starts.
- CLI: `ask` streams by default, `--no-stream` restores buffered behavior,
  `-j/--json` emits a single scriptable JSON object. `chat` streams into the
  growing reply line instead of buffering under a spinner.

## Subtask checklist

- [x] 1. `src/utils/sse.js` — SSE/NDJSON parser (+ unit test)
- [x] 2. BaseProvider + per-provider `stream()` for OpenAI/Anthropic/Google/Ollama
- [ ] 3. `AISwitch.ask` streaming path (onToken/onResult, mid-stream failover, cache short-circuit)
- [ ] 4. CLI `ask` streaming + `--no-stream` + `--json`; CLI `chat` streaming
- [ ] 5. Unit tests: stream-concat == non-stream output, mid-stream failover, no stream on cache hit, --no-stream path
- [ ] 6. README + CHANGELOG docs for streaming
- [ ] 7. Lint + full test run green