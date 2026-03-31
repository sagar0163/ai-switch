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
  "failover": true
}
```

## Usage

```bash
# Ask a question (auto-selects best available provider)
ai-switch ask "What is quantum computing?"

# Use specific provider
ai-switch ask --provider openai "Explain neural networks"

# Set primary and backup providers
ai-switch ask --primary anthropic --backup openai "Write a poem"

# View cost tracking
ai-switch costs

# Clear cache
ai-switch cache clear

# List configured providers
ai-switch providers
```

## License

MIT
