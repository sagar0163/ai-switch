/**
 * Benchmark utility for `ai-switch compare`.
 *
 * Runs a prompt through each provider's stream API `runs` times and produces
 * a comparable table of median latency, median first-token time (TTFB) and
 * median cost derived from provider-reported usage. Because it calls providers
 * directly it neither touches the response cache nor the cost ledger, so a
 * benchmark never pollutes usage or spend statistics.
 */

const { getPricing, calculateCost } = require('./pricing');

/**
 * Execute a single benchmark round against one provider.
 * @param {Object} provider - Provider instance (with `stream`)
 * @param {string} prompt - Prompt to run
 * @param {Object} [options] - Request options ({ model, temperature, maxTokens })
 * @returns {Promise<Object>} Round metrics
 */
async function runRound(provider, prompt, options = {}) {
  const model = options.model || provider.defaultModel;
  const started = Date.now();
  let ttfb = null;
  let text = '';
  let error = null;

  try {
    const iterator = provider.stream(prompt, { ...options, model })[Symbol.asyncIterator]();
    let next = await iterator.next();
    while (!next.done) {
      if (next.value) {
        if (ttfb === null) ttfb = Date.now() - started;
        text += next.value;
      }
      next = await iterator.next();
    }
  } catch (err) {
    error = err.message || String(err);
  }

  const latency = Date.now() - started;
  const round = { provider: provider.name, model, latency, ttfb, textLength: text.length };

  if (error) {
    round.error = error;
    round.cost = null;
    round.costSource = null;
  } else if (provider.streamUsage) {
    const pricing = getPricing(provider.name, model);
    const costs = calculateCost(provider.streamUsage, pricing);
    round.cost = costs.cost;
    round.costSource = pricing.known ? 'usage' : 'estimate';
  } else {
    round.cost = null;
    round.costSource = null;
  }

  return round;
}

/**
 * Median of a numeric array (null for empty).
 */
function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Summarize several rounds for one provider into a single table row.
 */
function summarize(provider, rounds) {
  const ok = rounds.filter((r) => !r.error);
  const row = {
    provider: provider.name,
    model: rounds[0]?.model || provider.defaultModel,
    runs: rounds.length,
    latencyMs: median(ok.map((r) => r.latency)),
    ttfbMs: median(ok.map((r) => (r.ttfb == null ? null : r.ttfb)).filter((v) => v != null)),
    costUsd: median(ok.map((r) => r.cost).filter((v) => v != null)),
    costSource: ok[0]?.costSource || null
  };
  const errors = rounds.filter((r) => r.error).map((r) => r.error);
  if (errors.length > 0) row.errors = errors;
  return row;
}

/**
 * Benchmark a prompt against a list of providers.
 * @param {Array} providers - Provider instances
 * @param {string} prompt - Prompt to run
 * @param {Object} [options] - { runs, model, temperature, maxTokens }
 * @returns {Promise<Array>} One summary row per provider
 */
async function runBenchmark(providers, prompt, options = {}) {
  const runs = Math.max(1, Math.min(20, options.runs || 1));
  const rows = [];

  for (const provider of providers) {
    const rounds = [];
    for (let i = 0; i < runs; i++) {
      rounds.push(await runRound(provider, prompt, options));
    }
    rows.push(summarize(provider, rounds));
  }

  return rows;
}

module.exports = { runBenchmark, runRound, median };