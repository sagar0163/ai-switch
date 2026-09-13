# WAR ROOM PLAN — Issue #5: streaming responses for ask and chat

Streaming tokens as they arrive for all four providers (OpenAI, Anthropic, Gemini,
Ollama), wired into `ask` and `chat`, with `--no-stream` and non-streaming JSON output,
cache short-circuit on hits, and stream-error handling that avoids partial garbage.

- [ ] Add shared streaming helpers (SSE + NDJSON line reader) in src/utils/stream.js
- [ ] OpenAI provider: `streamComplete` (SSE `data:` chunks + `stream_options.include_usage`)
- [ ] Anthropic provider: `streamComplete` (content block deltas + message_start/message_delta usage)
- [ ] Gemini provider: `streamComplete` (`streamGenerateContent?alt=sse` + cumulative-text dedupe)
- [ ] Ollama provider: `streamComplete` (stream:true, NDJSON `response`/`message.content` deltas)
- [ ] AISwitch.ask() plumbing: stream/onToken/json options, cache-hit short-circuit, partial-error no-failover
- [ ] CLI: `ask` prints tokens as they arrive; add `--no-stream` and `--json`; `chat` streams into reply line
- [ ] Unit tests: stream utils, per-provider SSE/NDJSON parsing, ask() streaming == non-streaming, cache short-circuit
- [ ] Update README + CHANGELOG for streaming flags/behavior
- [ ] Run lint + full test suite; fix failures
- [ ] Remove plan file, final commit, push branch