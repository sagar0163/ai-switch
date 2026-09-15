const { ProviderManager } = require('../src/providers/manager');
const { ConfigManager } = require('../src/utils/config');
const { CostTracker } = require('../src/utils/costTracker');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getModelTier } = require('../src/utils/capabilities');

function tmpTracker(label) {
  return new CostTracker({
    enabled: true,
    storagePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), `ai-switch-${label}-`)), 'costs.json')
  });
}

describe('Routing Engine', () => {
  let config;
  let cache = { isEnabled: () => false };
  let costs;
  
  beforeEach(() => {
    config = new ConfigManager(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-cfg-')), 'config.json'));
    config.config = {
      providers: {
        openai: { apiKey: 'test', model: 'gpt-4o' },
        anthropic: { apiKey: 'test', model: 'claude-haiku-4-5' }
      },
      costTracking: { enabled: true }
    };
    costs = tmpTracker('routing');
  });

  it('selects the cheaper provider by default', () => {
    const manager = new ProviderManager(config, cache, costs);
    const best = manager.getBestAvailable();
    // gpt-4o is strong ($2.5 in, $10 out)
    // claude-haiku is fast ($1 in, $5 out)
    // claude-haiku should be cheaper
    expect(best.name).toBe('anthropic');
  });

  it('respects tier requirements', () => {
    const manager = new ProviderManager(config, cache, costs);
    // Requires strong, haiku is fast, so it should pick openai
    const best = manager.getBestAvailable(null, 'strong');
    expect(best.name).toBe('openai');
  });

  it('enforces hard budget limits', () => {
    config.set('costTracking.budgets', {
      total: { daily: 1, action: 'hard' }
    });
    const manager = new ProviderManager(config, cache, costs);
    
    // Cost is 0, should allow
    expect(manager.getBestAvailable().name).toBe('anthropic');
    
    // Simulate cost > 1
    costs._updatePeriodicCosts('anthropic', 1.5);
    
    expect(() => {
      manager.getBestAvailable();
    }).toThrow(/budget exceeded/);
  });
  
  it('soft budget limits do not block', () => {
    config.set('costTracking.budgets', {
      total: { daily: 1, action: 'soft' }
    });
    const manager = new ProviderManager(config, cache, costs);
    
    // Simulate cost > 1
    costs._updatePeriodicCosts('anthropic', 1.5);
    
    // Should still allow
    expect(manager.getBestAvailable().name).toBe('anthropic');
  });

  it('provides routing rationale', () => {
    const manager = new ProviderManager(config, cache, costs);
    const best = manager.getBestAvailable(null, 'strong');
    
    expect(best.rationale).toBeDefined();
    expect(best.rationale.decision).toBe('openai');
    expect(best.rationale.evaluated.length).toBe(2);
  });
});

describe('Routing transparency', () => {
  let config;
  let cache = { isEnabled: () => false };
  let costs;

  beforeEach(() => {
    config = new ConfigManager(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-tr-cfg-')), 'config.json'));
    config.config = {
      providers: {
        openai: { apiKey: 'test', model: 'gpt-4o' },
        anthropic: { apiKey: 'test', model: 'claude-haiku-4-5' }
      },
      costTracking: { enabled: true }
    };
    costs = tmpTracker('transparency');
  });

  it('exposes plain-text rationale with per-provider tier/cost/eligibility', () => {
    const manager = new ProviderManager(config, cache, costs);
    const best = manager.getBestAvailable(null, 'strong');
    const r = best.rationale;

    expect(r.decision).toBe('openai');
    expect(typeof r.reason).toBe('string');
    expect(r.reason.length).toBeGreaterThan(0);
    expect(typeof r.requiredTier).toBe('string');
    expect(r.evaluated).toHaveLength(2);

    const entry = r.evaluated.find(p => p.provider === 'openai');
    expect(entry).toMatchObject({ model: 'gpt-4o', tier: 'strong', eligible: true });
    expect(entry.costScore).toBeGreaterThan(0);
    expect(typeof entry.cooldown).toBe('boolean');
    expect(typeof entry.budgetAllowed).toBe('boolean');
  });

  it('default decision names the cheaper eligible provider with a plain reason', () => {
    const manager = new ProviderManager(config, cache, costs);
    const best = manager.getBestAvailable('hello');
    const r = best.rationale;

    expect(r.decision).toBe('anthropic');
    expect(r.reason).toMatch(/eligible/i);
    const haiku = r.evaluated.find(p => p.provider === 'anthropic');
    const gpt = r.evaluated.find(p => p.provider === 'openai');
    expect(haiku.costScore).toBeLessThan(gpt.costScore);
  });

  it('warns on soft budget caps without blocking routing', () => {
    config.set('costTracking.budgets', { total: { daily: 1, action: 'soft' } });
    const manager = new ProviderManager(config, cache, costs);
    costs._updatePeriodicCosts('anthropic', 1.5);

    const best = manager.getBestAvailable();
    expect(best.name).toBe('anthropic');
    expect(best.rationale.warnings.length).toBeGreaterThan(0);
    expect(best.rationale.evaluated.some(p => p.budgetWarning)).toBe(true);
  });

  it('rejects unknown tiers with a descriptive message', () => {
    const manager = new ProviderManager(config, cache, costs);
    expect(() => manager.getBestAvailable(null, 'turbo')).toThrow(/Unknown tier/);
  });

  it('lists provider health and last known cost', () => {
    const manager = new ProviderManager(config, cache, costs);
    costs.record('openai', { model: 'gpt-4o', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 });

    const list = manager.listProviders();
    const openai = list.find(p => p.name === 'openai');
    const anthropic = list.find(p => p.name === 'anthropic');

    expect(openai).toMatchObject({ available: true, model: 'gpt-4o' });
    expect(typeof openai.inCooldown).toBe('boolean');
    expect(typeof openai.cooldownRemaining).toBe('number');
    expect(openai.lastCost).toBeGreaterThan(0);
    expect(anthropic.lastCost).toBe(0);
  });

  it('marks cooldown state in the provider listing', () => {
    const manager = new ProviderManager(config, cache, costs);
    const settings = manager.getFailoverSettings();
    manager._failures.openai = { count: settings.maxFailures, until: Date.now() + 60000 };

    const list = manager.listProviders();
    const openai = list.find(p => p.name === 'openai');
    expect(openai.inCooldown).toBe(true);
    expect(openai.cooldownRemaining).toBeGreaterThan(0);
  });
});

describe('Budget caps vs cache hits', () => {
  let config;
  let cache = { isEnabled: () => false };
  let costs;

  beforeEach(() => {
    config = new ConfigManager(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-bu-cfg-')), 'config.json'));
    config.config = {
      providers: {
        openai: { apiKey: 'test', model: 'gpt-4o' },
        anthropic: { apiKey: 'test', model: 'claude-haiku-4-5' }
      },
      costTracking: { enabled: true }
    };
    costs = tmpTracker('budget');
  });

  it('cache hits neither count against spend nor trip hard caps', () => {
    config.set('costTracking.budgets', { total: { daily: 1, action: 'hard' } });
    const manager = new ProviderManager(config, cache, costs);

    costs._updatePeriodicCosts('openai', 0.8);
    expect(manager.getBestAvailable().name).toBe('anthropic');

    costs.recordCacheHit('openai');
    costs.recordCacheHit('openai');
    costs.recordCacheHit('openai');

    expect(costs.data.cacheHits).toBe(3);
    expect(costs.data.dailyCost.total).toBeCloseTo(0.8, 8);
    const status = costs.checkBudget(config.get('costTracking.budgets'));
    expect(status.allowed).toBe(true);
  });
});
