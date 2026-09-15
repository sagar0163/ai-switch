# Changelog

## [0.2.0] - Unreleased

### Added
- `ai-switch init`: interactive first-run setup wizard.
- `ai-switch keys set|list|remove` and `ai-switch config` for secure key management.
- Environment variable API key precedence over config files.
- Masked keys in output (keys are never printed in plaintext).

### Added
- Cost-aware routing: with no provider flags, requests go to the cheapest configured provider whose model meets the optional `--tier fast|balanced|strong`.
- Daily/monthly spend budgets per provider and total (`costTracking.budgets`); soft caps warn, hard caps block. Cache hits never count against spend.
- Routing transparency: `ai-switch route <prompt>` and `ask --explain` print the decision and rationale (tier, cost score, cooldowns, budget state); every response is tracked to the serving provider/model and its real cost.
- `ai-switch compare <prompt> [--runs n] [--provider x]`: benchmark the same prompt across providers into a median latency / first-token (TTFB) / cost table. Uses real token streaming to measure TTFB, and never touches cache or the cost ledger.

### Changed
- `ai-switch providers` now shows health (cooldown/available) and last known cost.
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
