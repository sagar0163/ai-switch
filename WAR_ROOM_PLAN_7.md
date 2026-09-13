# WAR ROOM PLAN — Issue #7: interactive first-run setup + README rewrite

## Goal
Adoption-friendly `ai-switch init` (interactive, masked keys, probe-validated, suggested
default/backup chain), `ai-switch keys set|list|remove`, `ai-switch config` (secrets masked),
env-var key precedence, README rewrite with value promise + quickstart + comparison table +
usage GIF, and GitHub repo description.

## Subtasks
- [ ] Keys util: ENV_KEYS mapping, maskKey, key source resolution (env wins over config) + unit tests
- [ ] ConfigManager: env precedence in getProviderConfig, setKey/removeKey/listKeys/maskedView, replace() + unit tests
- [ ] CLI `keys set|list|remove` + `config` commands (masked output, never print plaintext keys)
- [ ] Prompter: interactive confirm/text + hidden (masked) key input in src/utils/prompts.js
- [ ] src/init.js: env detection, key collection, probe validation, suggestChain(), buildInitConfig(), runInit() wizard
- [ ] CLI `init` command wired to the wizard
- [ ] Tests for init.js (suggestChain, probe, buildInitConfig, wizard with injected prompter)
- [ ] README rewrite: value-promise header, end-to-end quickstart, why-vs-llm/aichat/LiteLLM table, usage GIF
- [ ] Generate docs/ai-switch-demo.gif (ffmpeg/ImageMagick) for the README
- [ ] CHANGELOG + package.json description/version bump + examples/config.json touch
- [ ] Set GitHub repository description
- [ ] Full jest + eslint pass; remove WAR_ROOM_PLAN_7.md; final commit; push branch