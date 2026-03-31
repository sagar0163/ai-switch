/**
 * Cost Tracker
 * Tracks API usage and estimated costs per provider
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Pricing per 1K tokens (approximate)
const PRICING = {
  'openai:gpt-4': { input: 0.03, output: 0.06 },
  'openai:gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'anthropic:claude-3-opus': { input: 0.015, output: 0.075 },
  'anthropic:claude-3-sonnet': { input: 0.003, output: 0.015 },
  'anthropic:claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'google:gemini-pro': { input: 0.001, output: 0.002 },
  'ollama:local': { input: 0, output: 0 } // Free for local models
};

class CostTracker {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.storagePath = options.storagePath || 
      path.join(os.homedir(), '.ai-switch', 'costs.json');
    
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (error) {
      // Ignore load errors
    }
    
    return {
      totalRequests: 0,
      totalTokens: { input: 0, output: 0 },
      byProvider: {}
    };
  }

  _save() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  /**
   * Estimate token count (rough approximation)
   */
  _estimateTokens(text) {
    // Rough estimate: ~4 characters per token for English
    return Math.ceil(text.length / 4);
  }

  /**
   * Get pricing for a provider/model combination
   */
  _getPricing(provider, model) {
    const key = `${provider}:${model}`;
    return PRICING[key] || { input: 0.01, output: 0.03 }; // Default fallback
  }

  /**
   * Calculate cost from token counts
   */
  _calculateCost(provider, model, inputTokens, outputTokens) {
    const pricing = this._getPricing(provider, model);
    const inputCost = (inputTokens / 1000) * pricing.input;
    const outputCost = (outputTokens / 1000) * pricing.output;
    return inputCost + outputCost;
  }

  /**
   * Record an API call
   */
  record(provider, response, options = {}) {
    if (!this.enabled) return;

    const model = options.model || 'unknown';
    const prompt = options.prompt || '';
    
    const inputTokens = this._estimateTokens(prompt);
    const outputTokens = this._estimateTokens(response);
    const cost = this._calculateCost(provider, model, inputTokens, outputTokens);

    this.data.totalRequests++;
    this.data.totalTokens.input += inputTokens;
    this.data.totalTokens.output += outputTokens;

    if (!this.data.byProvider[provider]) {
      this.data.byProvider[provider] = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0
      };
    }

    this.data.byProvider[provider].requests++;
    this.data.byProvider[provider].inputTokens += inputTokens;
    this.data.byProvider[provider].outputTokens += outputTokens;
    this.data.byProvider[provider].cost += cost;

    this._save();
  }

  /**
   * Get cost summary
   */
  getSummary() {
    const totalCost = Object.values(this.data.byProvider)
      .reduce((sum, p) => sum + p.cost, 0);

    const byProvider = Object.entries(this.data.byProvider)
      .map(([provider, data]) => ({
        provider,
        requests: data.requests,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cost: data.cost
      }))
      .sort((a, b) => b.cost - a.cost);

    return {
      totalRequests: this.data.totalRequests,
      totalInputTokens: this.data.totalTokens.input,
      totalOutputTokens: this.data.totalTokens.output,
      totalCost,
      byProvider
    };
  }

  /**
   * Reset all tracking data
   */
  reset() {
    this.data = {
      totalRequests: 0,
      totalTokens: { input: 0, output: 0 },
      byProvider: {}
    };
    this._save();
  }
}

module.exports = { CostTracker };
