# WAR_ROOM_PLAN_3.md

Prior commits shipped a plan + the CostTracker/ProviderManager/failover tests
(landed earlier under #1/#2). Remaining work:

- [x] Write `WAR_ROOM_PLAN_3.md` with plan
- [x] Baseline: existing Jest suite passes (41 tests)
- [ ] Add `_retrying` single-flight guard to `AISwitch.ask()` (refactor body into `_doAsk`)
- [ ] Make `CacheManager.cacheDir` injectable (testability refactor)
- [ ] Write `jest.config.js` (coverage collection, 70% thresholds)
- [ ] Add tests for `ConfigManager` (defaults, env precedence, overrides, bad file)
- [ ] Add tests for `CacheManager` (get/set, TTL, prune, clear, disabled)
- [ ] Add `openai` provider tests (request format + 429/5xx/empty/malformed)
- [ ] Add `anthropic` provider tests (request format + 429/5xx/empty/malformed)
- [ ] Add `google` provider tests (request format + 429/5xx/empty/malformed)
- [ ] Add `ollama` provider tests (request format + availability + failures)
- [ ] Add `_retrying` guard + cache-hit tests to `AISwitch.ask()` suite
- [ ] Add availability test to `ProviderManager` suite
- [ ] Add CLI subprocess tests (ask/providers/costs/reset/cache/help via local HTTP stub)
- [ ] Iterate coverage until every `src/**` file >= 70% lines
- [ ] Add GitHub Actions CI workflow (`.github/workflows/ci.yml`, Node 18/20/22)
- [ ] Add CI badge to `README.md`
- [ ] Ensure `npm run lint` and `npm test` pass locally
- [ ] Delete plan file, final commit, push `war-room-issue-3`