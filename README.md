# AI-Switch

A CLI tool that provides a unified interface for multiple AI LLM providers with automatic failover, cost tracking, and response caching.

## Features

- **Multi-Provider Support**: OpenAI, Anthropic, Google AI, Ollama (local)
- **Automatic Failover**: Falls back to backup provider on failure
- **Cost Tracking**: Tracks API usage and costs per provider
- **Response Caching**: Avoids redundant API calls
- **Unified Interface**: Single CLI for all providers

## Installation

```bash
npm install -g ai-switch
```

## Configuration

Create `~/.ai-switch/config.json`:

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-...",
      "model": "gpt-4"
    },
    "anthropic": {
      "apiKey": "sk-ant-...",
      "model": "claude-3-opus-20240229"
    }
  },
  "cache": {
    "enabled": true,
    "ttl": 3600
  },
  "failover": {
    "enabled": true,
    "order": ["openai", "anthropic"],
    "maxFailures": 3,
    "cooldownSeconds": 60
  }
}
```

`failover` accepts `true`/`false`, or an object with:
- `order` — the default failover chain (providers are tried in this order)
- `maxFailures` — consecutive failures before a provider is put on cooldown (default: 3)
- `cooldownSeconds` — how long a provider is skipped after tripping the breaker (default: 60)

A provider that replies with a `Retry-After` header is backed off for that window immediately.
The `--primary`/`--backup` flags override the configured order for a single call.

### Cost tracking & pricing

Costs are computed from the real token `usage` the providers return with every
response (OpenAI `usage.prompt_tokens`/`completion_tokens`, Anthropic
`input_tokens`/`output_tokens` including cache reads, Gemini `usageMetadata`,
Ollama `prompt_eval_count`/`eval_count`) — not from a character-count estimate.

Prices are looked up for the actual model from a built-in table (maintained
against [models.dev](https://models.dev)) in USD per 1M tokens, with optional
per-model overrides under `costTracking.pricing`:

```json
{
  "costTracking": {
    "enabled": true,
    "pricing": {
      "openai:gpt-4o": { "input": 2.5, "output": 10, "cacheRead": 1.25 }
    }
  }
}
```

Models without a known price are **flagged** in `ai-switch costs` (`[unknown
pricing]`) rather than silently priced at a default; add a `costTracking.pricing`
override to price them. Cache hits are counted separately and never double-charge
cost.

## Usage

```bash
# Ask a question (auto-selects best available provider)
ai-switch ask "What is quantum computing?"

# Use specific provider
ai-switch ask --provider openai "Explain neural networks"

# Set primary and backup providers
ai-switch ask --primary anthropic --backup openai "Write a poem"

# View cost tracking (token breakdown per provider, unknown-pricing flags)
ai-switch costs

# Clear cache
ai-switch cache clear

# List configured providers
ai-switch providers
```

## License

MIT
