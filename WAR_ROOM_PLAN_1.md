# WAR ROOM PLAN — Issue #1: ordered failover + per-provider cooldown

## Subtasks

- [ ] Add `failover` settings parsing (boolean/array/object) + ordered provider resolution (`getOrder`) and ordered `getBackup` to `src/providers/manager.js`
- [ ] Add per-provider cooldown/circuit-breaker state to `ProviderManager` (consecutive-failure counter, cooldown window, `recordFailure`/`recordSuccess`/`isInCooldown`)
- [x] Add `retryAfter` support: `ProviderError.retryAfter` field + `Retry-After` header parsing; capture header in openai/anthropic/google/ollama providers
- [ ] Rewrite `AISwitch.ask()` to iterate an explicit provider order, skip cooldown providers, honor `Retry-After`, and emit a single failover warning per hop
- [ ] Thread `--primary`/`--backup` from `src/cli.js` into `ask()`
- [ ] Unit tests: ordering, cooldown expiry, Retry-After handling, `ask --primary openai --backup anthropic` fails over to backup on mocked failure
- [ ] `npm test` + `npm run lint` green
- [ ] Final commit (rm plan file) + push `war-room-issue-1`