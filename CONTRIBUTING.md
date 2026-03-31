# Contributing to AI-Switch

Contributions are welcome! Please feel free to submit a Pull Request.

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Create config: `~/.ai-switch/config.json`

## Adding New Providers

1. Create a new file in `src/providers/`
2. Extend the `BaseProvider` class
3. Implement the `complete()` method
4. Register in `src/providers/manager.js`

## Testing

```bash
npm test
```
