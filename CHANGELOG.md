# Changelog

## [Unreleased]

### Added
- Token streaming for `ask` and `chat` across all providers (OpenAI SSE, Anthropic content block deltas, Gemini `streamGenerateContent?alt=sse`, Ollama NDJSON). Responses print incrementally instead of waiting for the full request to finish.
- `--no-stream` flag on `ask`/`chat` restores the buffered (non-streaming) path.
- `-j/--json` output mode for `ask` for scripting, returning `{ text, provider, model, usage }`.

### Changed
- Cost accounting now uses real provider-billed `usage` fields (OpenAI `usage.prompt_tokens`/`completion_tokens`, Anthropic `input_tokens`/`output_tokens` incl. cache reads, Gemini `usageMetadata`, Ollama `prompt_eval_count`/`eval_count`) instead of a `text.length / 4` character heuristic.
- Pricing is resolved for the actual model via a built-in table maintained against models.dev plus `costTracking.pricing` config overrides. Unknown-priced models are flagged in `ai-switch costs` instead of being silently priced at a default.
- Cache hits are recorded as hits and never double-charge cost.

### Behavior
- Streaming composes with caching: a cache hit short-circuits and returns the full stored response without streaming.
- A stream that dies mid-token preserves the partial output but does not fail over (no concatenated garbage); failover still applies when a provider fails before emitting any token.

## [0.1.0] - 2026-03-31

### Added
- Multi-provider support (OpenAI, Anthropic, Google AI, Ollama)
- Automatic failover between providers
- Response caching with TTL
- Cost tracking per provider
- Interactive chat mode
- Comprehensive CLI with multiple commands

### Features
- `ai-switch ask` - Query AI providers
- `ai-switch providers` - List configured providers
- `ai-switch costs` - View usage and costs
- `ai-switch cache` - Manage response cache
- `ai-switch chat` - Interactive chat session
