const { ProviderManager } = require('../src/providers/manager');
const { ConfigManager } = require('../src/utils/config');
const { CostTracker } = require('../src/utils/costTracker');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getModelTier } = require('../src/utils/capabilities');

describe('Routing Engine', () => {
  let config;
  let cache = { isEnabled: () => false };
  let costs;
  
  beforeEach(() => {
    config = new ConfigManager(path.join(os.tmpdir(), 'test-config.json'));
    config.config = {
      providers: {
        openai: { apiKey: 'test', model: 'gpt-4o' },
        anthropic: { apiKey: 'test', model: 'claude-haiku-4-5' }
      },
      costTracking: { enabled: true }
    };
    costs = new CostTracker({ enabled: true, storagePath: path.join(os.tmpdir(), 'test-costs.json') });
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
