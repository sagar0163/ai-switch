# AI-Switch

**The intelligent switch between all your AI providers — cost-aware routing, failover, and a running cost ledger.**

![AI-Switch Demo](docs/ai-switch-demo.gif)

AI-Switch is a unified CLI tool for OpenAI, Anthropic, Google Gemini, and Ollama. It doesn't just route your prompts—it protects your API budget, automatically falls back to secondary models if one goes down, and manages your keys securely without requiring manual JSON configuration.

## Quickstart

Get started in under a minute with the interactive setup wizard:

```bash
# 1. Install globally
npm install -g ai-switch

# 2. Run the interactive setup (detects env vars, asks for keys, validates them)
ai-switch init

# 3. Ask your first question! (Auto-routes to your best available provider)
ai-switch ask "hi"
```

## Why AI-Switch?

| Feature | AI-Switch | SimonW/llm | sigoden/aichat | LiteLLM (CLI) |
|---|---|---|---|---|
| **Primary Focus** | Cost-aware routing & resilient failover | Extensibility & SQLite logging | Chat UI & REPL | Enterprise proxy / API standardization |
| **Interactive Setup** | Yes (`ai-switch init`) | No (manual keys) | Yes | No |
| **Failover / Fallback** | Automatic (ordered chains, cooldowns) | No | No | Yes (mostly proxy) |
| **Cost Ledger** | Yes (real token tracking, cache-hits) | No | No | Yes |
| **Secure Key Storage** | Masked out, Env-var precedence | File-based | File-based | Env-var based |

## Configuration & Key Management

Keys are managed interactively. They are never printed to the terminal in plaintext, and environment variables always take precedence.

```bash
# Safely add or update a provider key
ai-switch keys set anthropic

# List configured providers (keys are masked)
ai-switch keys list

# View the effective configuration (resolves env vars vs file configs)
ai-switch config
```

### Advanced Failover

Configure how AI-Switch handles provider outages:

```json
{
  "failover": {
    "enabled": true,
    "order": ["openai", "anthropic"],
    "maxFailures": 3,
    "cooldownSeconds": 60
  }
}
```

A provider that replies with a `Retry-After` header is backed off for that window immediately.
You can also override the order for a single call:

```bash
ai-switch ask --primary anthropic --backup openai "Write a poem"
```

### Chat Mode & Context Budget

`ai-switch chat` sends full conversation history to the provider, smartly trimming older messages to fit a token budget:

```json
{
  "chat": {
    "maxTurns": 20,
    "maxContextTokens": 4000
  }
}
```

### Cost Tracking & Pricing

Costs are computed from real token `usage` returned by providers. Cache hits are never double-charged. Prices are looked up from a built-in table, and you can override them:

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

Check your total usage at any time:

```bash
ai-switch costs
```

## License

MIT
