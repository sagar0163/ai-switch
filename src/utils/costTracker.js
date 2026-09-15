/**
 * Cost Tracker
 * Records provider-billed token usage and prices it with the actual model's
 * current rate (models.dev table + config overrides). Unknown models are
 * flagged, never silently priced.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { getPricing, calculateCost } = require('./pricing');

function emptyProvider() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cost: 0,
    unknownPricing: false,
    unknownModels: []
  };
}

class CostTracker {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.storagePath = options.storagePath ||
      path.join(os.homedir(), '.ai-switch', 'costs.json');
    this.pricingOverrides = options.pricing || {};

    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        return this._normalize(JSON.parse(raw));
      }
    } catch (error) {
      // Ignore load errors
    }

    return this._fresh();
  }

  _fresh() {
    return {
      totalRequests: 0,
      cacheHits: 0,
      currentDay: new Date().toISOString().split('T')[0],
      currentMonth: new Date().toISOString().slice(0, 7),
      dailyCost: { total: 0, byProvider: {} },
      monthlyCost: { total: 0, byProvider: {} },
      totalTokens: { input: 0, output: 0, cacheRead: 0 },
      byProvider: {},
      byModel: {}
    };
  }

  _normalize(data) {
    const base = this._fresh();
    if (!data || typeof data !== 'object') return base;
    base.totalRequests = data.totalRequests || 0;
    base.cacheHits = data.cacheHits || 0;
    base.totalTokens = {
      input: data.totalTokens?.input || 0,
      output: data.totalTokens?.output || 0,
      cacheRead: data.totalTokens?.cacheRead || 0
    };
    base.byProvider = data.byProvider || {};
    
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().slice(0, 7);
    
    if (data.currentDay === today) {
      base.dailyCost = data.dailyCost || { total: 0, byProvider: {} };
    } else {
      base.dailyCost = { total: 0, byProvider: {} };
    }
    
    if (data.currentMonth === thisMonth) {
      base.monthlyCost = data.monthlyCost || { total: 0, byProvider: {} };
    } else {
      base.monthlyCost = { total: 0, byProvider: {} };
    }
    
    base.currentDay = today;
    base.currentMonth = thisMonth;
    base.byModel = data.byModel || {};
    return base;
  }

  
  _updatePeriodicCosts(provider, cost) {
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().slice(0, 7);

    if (this.data.currentDay !== today) {
      this.data.currentDay = today;
      this.data.dailyCost = { total: 0, byProvider: {} };
    }
    if (this.data.currentMonth !== thisMonth) {
      this.data.currentMonth = thisMonth;
      this.data.monthlyCost = { total: 0, byProvider: {} };
    }

    this.data.dailyCost.total += cost;
    this.data.dailyCost.byProvider[provider] = (this.data.dailyCost.byProvider[provider] || 0) + cost;

    this.data.monthlyCost.total += cost;
    this.data.monthlyCost.byProvider[provider] = (this.data.monthlyCost.byProvider[provider] || 0) + cost;
  }

  checkBudget(configBudgets, provider = null) {
    if (!configBudgets) return { allowed: true };

    const today = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().slice(0, 7);

    // Refresh buckets if needed
    if (this.data.currentDay !== today) {
      this.data.currentDay = today;
      this.data.dailyCost = { total: 0, byProvider: {} };
    }
    if (this.data.currentMonth !== thisMonth) {
      this.data.currentMonth = thisMonth;
      this.data.monthlyCost = { total: 0, byProvider: {} };
    }

    const checkConstraints = (budget, currentCost, scopeName) => {
      if (!budget) return { allowed: true };

      let warning = null;
      if (budget.monthly) {
        if (budget.action === 'hard' && currentCost.monthly >= budget.monthly) {
          return { allowed: false, reason: `Monthly budget exceeded for ${scopeName} (${currentCost.monthly} >= ${budget.monthly})` };
        } else if (currentCost.monthly >= budget.monthly) {
          warning = `Monthly budget exceeded for ${scopeName} (${currentCost.monthly} >= ${budget.monthly})`;
        }
      }

      if (budget.daily) {
        if (budget.action === 'hard' && currentCost.daily >= budget.daily) {
          return { allowed: false, reason: `Daily budget exceeded for ${scopeName} (${currentCost.daily} >= ${budget.daily})` };
        } else if (currentCost.daily >= budget.daily) {
          warning = `Daily budget exceeded for ${scopeName} (${currentCost.daily} >= ${budget.daily})`;
        }
      }

      return { allowed: true, warning };
    };

    const warnings = [];

    // Check total budget
    if (configBudgets.total) {
      const totalCosts = { daily: this.data.dailyCost.total, monthly: this.data.monthlyCost.total };
      const result = checkConstraints(configBudgets.total, totalCosts, 'total');
      if (!result.allowed) return result;
      if (result.warning) warnings.push(result.warning);
    }

    // Check provider budget
    if (provider && configBudgets.providers && configBudgets.providers[provider]) {
      const pCosts = {
        daily: this.data.dailyCost.byProvider[provider] || 0,
        monthly: this.data.monthlyCost.byProvider[provider] || 0
      };
      const result = checkConstraints(configBudgets.providers[provider], pCosts, provider);
      if (!result.allowed) return result;
      if (result.warning) warnings.push(result.warning);
    }

    if (warnings.length > 0) {
      return { allowed: true, warning: warnings.join('; ') };
    }
    return { allowed: true };
  }

  _save() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  _modelFor(usage, fallback) {
    return usage.model || fallback || 'unknown';
  }

  _recordProvider(provider, modelKey, usage, costs, pricing) {
    if (!this.data.byProvider[provider]) {
      this.data.byProvider[provider] = emptyProvider();
    }
    const p = this.data.byProvider[provider];
    p.requests += 1;
    p.inputTokens += usage.inputTokens;
    p.outputTokens += usage.outputTokens;
    p.cacheReadTokens += usage.cacheReadTokens;
    p.inputCost += costs.inputCost;
    p.outputCost += costs.outputCost;
    p.cacheReadCost += costs.cacheReadCost;
    p.cost += costs.cost;
    if (pricing && !pricing.known) {
      p.unknownPricing = true;
      if (!p.unknownModels.includes(modelKey)) {
        p.unknownModels.push(modelKey);
      }
    }

    if (!this.data.byModel[modelKey]) {
      this.data.byModel[modelKey] = { provider, model: usage.model, ...emptyProvider() };
    }
    const m = this.data.byModel[modelKey];
    m.requests += 1;
    m.inputTokens += usage.inputTokens;
    m.outputTokens += usage.outputTokens;
    m.cacheReadTokens += usage.cacheReadTokens;
    m.inputCost += costs.inputCost;
    m.outputCost += costs.outputCost;
    m.cacheReadCost += costs.cacheReadCost;
    m.cost += costs.cost;
    if (pricing && !pricing.known) {
      m.unknownPricing = true;
    }
  }

  /**
   * Record a real API call.
   * @param {string} provider - Provider name
   * @param {Object} usage - Canonical usage record ({ inputTokens, outputTokens,
   *   cacheReadTokens, cacheCreationTokens, model })
   * @param {Object} [options] - Options ({ model: fallback model id })
   */
  record(provider, usage, options = {}) {
    if (!this.enabled) return;

    usage = usage || {};
    const normalized = {
      model: usage.model,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cacheReadTokens: usage.cacheReadTokens || 0,
      cacheCreationTokens: usage.cacheCreationTokens || 0
    };
    const modelFor = this._modelFor(normalized, options.model);
    const modelKey = `${provider}:${modelFor}`;
    const pricing = getPricing(provider, modelFor, this.pricingOverrides);
    const costs = calculateCost(normalized, pricing);

    this.data.totalRequests++;
    this.data.totalTokens.input += normalized.inputTokens;
    this.data.totalTokens.output += normalized.outputTokens;
    this.data.totalTokens.cacheRead += normalized.cacheReadTokens;
    
    this._updatePeriodicCosts(provider, costs.cost);

    this._recordProvider(provider, modelKey, normalized, costs, pricing);
    this._save();
  }

  /**
   * Record a cache hit. The underlying API call was already charged once, so
   * this adds no tokens and no cost.
   * @param {string} provider - Provider whose cached response was served
   */
  recordCacheHit(provider) {
    if (!this.enabled) return;
    this.data.cacheHits++;
    if (provider && !this.data.byProvider[provider]) {
      this.data.byProvider[provider] = emptyProvider();
    }
    this._save();
  }

  /**
   * Get cost summary
   */
  getSummary() {
    const totalCost = Object.values(this.data.byProvider)
      .reduce((sum, p) => sum + p.cost, 0);

    const byProvider = Object.entries(this.data.byProvider)
      .map(([provider, d]) => ({
        provider,
        requests: d.requests,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        cacheReadTokens: d.cacheReadTokens,
        inputCost: d.inputCost,
        outputCost: d.outputCost,
        cacheReadCost: d.cacheReadCost,
        cost: d.cost,
        unknownPricing: d.unknownPricing,
        unknownModels: d.unknownModels
      }))
      .sort((a, b) => b.cost - a.cost);

    return {
      totalRequests: this.data.totalRequests,
      cacheHits: this.data.cacheHits,
      totalInputTokens: this.data.totalTokens.input,
      totalOutputTokens: this.data.totalTokens.output,
      totalCacheReadTokens: this.data.totalTokens.cacheRead,
      totalCost,
      byProvider,
      byModel: this.data.byModel
    };
  }

  /**
   * Reset all tracking data
   */
  reset() {
    this.data = this._fresh();
    this._save();
  }
}

module.exports = { CostTracker };