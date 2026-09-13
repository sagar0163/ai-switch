# War Room Plan — Issue #4: chat mode must send full conversation history

## Goal
Thread conversation history through `AISwitch.ask()` and provider `complete()`
boundary via a `messages` array while keeping the flat string-prompt path intact.

## Subtasks
- [x] Add `src/utils/messages.js`: normalizeMessages, trimMessages (maxTurns + maxContextTokens), countTurns, estimateTokens, describeHistory
- [x] Add `src/utils/chatSession.js`: ChatSession class (addUser/addAssistant/full/status/reset) for CLI chat mode
- [x] Thread `messages` through `AISwitch.ask()` in `src/index.js` (strings keep behavior; cache key from serialized trimmed messages; read chat config)
- [x] Update all four providers (openai/anthropic/google/ollama) to use `options.messages` when present
- [x] Rework CLI `chat` command (`src/cli.js`) to use ChatSession, send full history, cap it, and show a small turns/tokens indicator
- [x] Config: add `chat` defaults in `src/utils/config.js`, update `examples/config.json` and README (documented + configurable cap)
- [x] Unit tests: `test/utils/messages.test.js` + `test/utils/chatSession.test.js` (assembly, trimming, estimates)
- [x] Integration tests in `test/index.test.js`: mocked provider asserts full history in `messages` payload; single-shot `ask` unchanged
- [ ] Run full test suite + lint, fix failures
- [ ] Delete plan file, final commit, push branch