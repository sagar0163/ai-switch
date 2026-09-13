# Changelog

## [Unreleased]

### Added
- Token streaming for `ask` and `chat` across all providers: OpenAI (`stream: true`),
  Anthropic (content-block deltas), Gemini (`streamGenerateContent?alt=sse`), and
  Ollama (`stream: true` NDJSON). `ai-switch ask` prints tokens as they arrive and
  `ai-switch chat` streams into the growing reply line.
- Mid-stream failures fail over to the next provider without gluing the failed
  provider's partial output into the result; partial text already printed to the
  terminal is followed by a failover notice.
- `ai-switch ask --no-stream` restores the buffered behavior, and
  `ai-switch ask --json` emits a single scriptable JSON object.
- Cache hits short-circuit before any streaming starts; streaming shows the cached
  text in full.

### Changed
- Cost accounting now uses real provider-billed `usage` fields (OpenAI `usage.prompt_tokens`/`completion_tokens`, Anthropic `input_tokens`/`output_tokens` incl. cache reads, Gemini `usageMetadata`, Ollama `prompt_eval_count`/`eval_count`) instead of a `text.length / 4` character heuristic.
- Pricing is resolved for the actual model via a built-in table maintained against models.dev plus `costTracking.pricing` config overrides. Unknown-priced models are flagged in `ai-switch costs` instead of being silently priced at a default.
- Cache hits are recorded as hits and never double-charge cost.

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
