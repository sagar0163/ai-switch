# Plan
- [x] Initial commit
- [ ] Add model capability metadata for tiers (fast, balanced, strong).
- [ ] Add budget checks to `CostTracker` (soft-warn/hard-block) taking cache hits into account.
- [ ] Update `ProviderManager` to use the routing engine (`getBestAvailable(prompt, tier)`) selecting the cheapest eligible provider.
- [ ] Add `route` command, `--explain` flag to `ask`, and update `providers` command.
- [ ] Add `compare` command for benchmark.
- [ ] Write unit tests and ensure CI passes.
