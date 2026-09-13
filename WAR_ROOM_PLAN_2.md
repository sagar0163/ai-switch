# WAR ROOM PLAN — Issue #2 (real usage accounting + current pricing)

Branch: `war-room-issue-2`. Goal: replace `length/4` token estimation + stale 2024
price table with real provider `usage` fields and a maintained pricing source
(models.dev table + config overrides), flagging unknown models instead of silent
defaults, and surface token/cost breakdowns in `ai-switch costs`.

## Subtasks (check off when done; commit after each)

- [x] Add `src/utils/pricing.json` built-in table ($/1M tokens, sourced from models.dev) + `src/utils/pricing.js` (lookup with config overrides, unknown-model flagging, cost calc). Commit.
- [x] Add `src/utils/usage.js` parsing real usage for OpenAI / Anthropic / Google / Ollama payload shapes. Commit.
- [x] Update providers (openai.js, anthropic.js, google.js, ollama.js) to return `{ text, usage }` from `complete()`. Commit.
- [x] Rewrite `src/utils/costTracker.js` ledger: real usage, per-provider/model breakdown, cache-hit counter, unknown-pricing flag, no `length/4`. Commit.
- [x] Wire `src/index.js` `ask()` to pass usage + model into the ledger; record cache hits without charging; keep string text return. Commit.
- [x] Update `src/cli.js` `costs` command: token breakdown (input/output/cached), per-provider cost, `unknown pricing` flags, cache hits. Commit.
- [x] Unit tests: ledger math w/ realistic 4-provider usage payloads; pricing lookup fallbacks; cache-hit no double charge. Commit.
- [ ] Docs: README (pricing overrides config + costs output), examples/config.json, CHANGELOG. Commit.
- [ ] Run lint + tests, fix failures. Delete WAR_ROOM_PLAN_2.md, final commit, push.