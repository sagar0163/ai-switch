/**
 * Pricing source for known models.
 *
 * The built-in table (`./pricing.json`) is maintained against models.dev
 * (`https://models.dev/api.json`; unit: USD per 1M tokens). Per-model config
 * overrides layered on top (see `costTracking.pricing`). Models with no known
 * price are *flagged* (`{ known: false }`) instead of silently mispriced.
 */

const BUILT_IN = require('./pricing.json').models;

const DATE_SUFFIX_RE = /-(\d{4}(-\d{2}){2}|\d{6,8})$/;

/**
 * Resolve the pricing entry for a provider/model combination.
 * Lookup order: config overrides (exact `provider:model`, bare model, or
 * `provider.model` nesting) -> built-in table -> family fallback (date-suffixed
 * model ids) -> `known: false`.
 * @param {string} provider - Provider name (openai, anthropic, google, ollama)
 * @param {string} model - Model id as reported by the provider
 * @param {Object} [overrides] - Config overrides (USD per 1M tokens)
 * @returns {{known: boolean, input: number, output: number, cacheRead: number}}
 */
function getPricing(provider, model, overrides = {}) {
  const o = overrides || {};
  const key = `${provider}:${model}`;

  let entry = o[key] || o[model] || (o[provider] && o[provider][model]) || BUILT_IN[key];
  if (!entry) {
    const family = String(model).replace(DATE_SUFFIX_RE, '');
    if (family && family !== model) {
      entry = o[`${provider}:${family}`] || o[family] || BUILT_IN[`${provider}:${family}`];
    }
  }

  if (!entry && provider === 'ollama') {
    entry = BUILT_IN['ollama:*'];
  }

  if (!entry) {
    return { known: false, input: 0, output: 0, cacheRead: 0 };
  }

  return {
    known: true,
    input: Number(entry.input ?? 0),
    output: Number(entry.output ?? 0),
    cacheRead: Number(entry.cacheRead ?? 0)
  };
}

/**
 * Compute a monetary cost for a usage record against resolved pricing.
 * Unknown pricing yields 0 cost (the caller flags the model separately).
 * @param {{inputTokens: number, outputTokens: number, cacheReadTokens: number}} usage
 * @param {{known: boolean, input: number, output: number, cacheRead: number}} pricing
 * @returns {{inputCost: number, outputCost: number, cacheReadCost: number, cost: number}}
 */
function calculateCost(usage, pricing) {
  if (!pricing || !pricing.known) {
    return { inputCost: 0, outputCost: 0, cacheReadCost: 0, cost: 0 };
  }
  const inputCost = (usage.inputTokens / 1e6) * pricing.input;
  const outputCost = (usage.outputTokens / 1e6) * pricing.output;
  const cacheReadCost = (usage.cacheReadTokens / 1e6) * pricing.cacheRead;
  return { inputCost, outputCost, cacheReadCost, cost: inputCost + outputCost + cacheReadCost };
}

module.exports = { getPricing, calculateCost };