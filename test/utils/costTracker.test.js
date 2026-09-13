const fs = require('fs');
const os = require('os');
const path = require('path');

const { CostTracker } = require('../../src/utils/costTracker');
const { getPricing, calculateCost } = require('../../src/utils/pricing');
const { parseUsage } = require('../../src/utils/usage');

function tmpTracker(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-costs-'));
  return new CostTracker({
    storagePath: path.join(dir, 'costs.json'),
    ...options
  });
}

describe('CostTracker real usage accounting', () => {
  const realisticPayloads = {
    openai: {
      model: 'gpt-4o-2024-08-06',
      choices: [{ message: { content: '  hello world  ' } }],
      usage: { prompt_tokens: 210, completion_tokens: 57 }
    },
    anthropic: {
      model: 'claude-sonnet-4-5-20250929',
      content: [{ text: '  hi' }],
      usage: {
        input_tokens: 342,
        output_tokens: 41,
        cache_read_input_tokens: 1500,
        cache_creation_input_tokens: 60
      }
    },
    google: {
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 128, candidatesTokenCount: 33 }
    },
    ollama: {
      model: 'llama3.2',
      response: 'sure thing',
      prompt_eval_count: 96,
      eval_count: 12
    }
  };

  it('records provider-billed token counts, not char-count estimates', () => {
    const ct = new CostTracker({
      storagePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-ut-')), 'c.json')
    });
    const usage = parseUsage('openai', realisticPayloads.openai, 'gpt-4o-2024-08-06');
    ct.record('openai', usage, { model: 'gpt-4o-2024-08-06' });

    const s = ct.getSummary();
    expect(s.totalRequests).toBe(1);
    expect(s.totalInputTokens).toBe(210);
    expect(s.totalOutputTokens).toBe(57);
    expect(s.byProvider[0]).toMatchObject({
      provider: 'openai',
      inputTokens: 210,
      outputTokens: 57,
      cacheReadTokens: 0,
      unknownPricing: false
    });
    // gpt-4o input $2.5/1M, output $10/1M
    expect(s.byProvider[0].cost).toBeCloseTo((210 / 1e6) * 2.5 + (57 / 1e6) * 10, 8);
  });

  it.each([
    ['openai', 'gpt-4o', 210, 57, 0],
    ['anthropic', 'claude-sonnet-4-5', 342, 41, 1500],
    ['google', 'gemini-2.5-flash', 128, 33, 0],
    ['ollama', 'llama3.2', 96, 12, 0]
  ])('ledger math matches provider-billed counts for %s', (provider, model, inTok, outTok, cacheTok) => {
    const tracker = new CostTracker({
      storagePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-le-')), 'c.json')
    });
    const usage = { inputTokens: inTok, outputTokens: outTok, cacheReadTokens: cacheTok, cacheCreationTokens: 0, model };
    const pricing = getPricing(provider, model);
    const expected = calculateCost(usage, pricing);
    tracker.record(provider, usage, { model });

    const s = tracker.getSummary();
    expect(s.byProvider[0].inputTokens).toBe(inTok);
    expect(s.byProvider[0].outputTokens).toBe(outTok);
    expect(s.byProvider[0].cacheReadTokens).toBe(cacheTok);
    expect(s.byProvider[0].cost).toBeCloseTo(expected.cost, 8);
  });

  it('parses real usage payloads for all four providers', () => {
    expect(parseUsage('openai', realisticPayloads.openai)).toEqual({
      model: 'gpt-4o-2024-08-06', inputTokens: 210, outputTokens: 57, cacheReadTokens: 0, cacheCreationTokens: 0
    });
    const anthropic = parseUsage('anthropic', realisticPayloads.anthropic);
    expect(anthropic.inputTokens).toBe(342);
    expect(anthropic.outputTokens).toBe(41);
    expect(anthropic.cacheReadTokens).toBe(1500);
    const google = parseUsage('google', realisticPayloads.google, 'gemini-pro');
    expect(google.inputTokens).toBe(128);
    expect(google.outputTokens).toBe(33);
    expect(google.model).toBe('gemini-pro');
    const ollama = parseUsage('ollama', realisticPayloads.ollama);
    expect(ollama).toMatchObject({ model: 'llama3.2', inputTokens: 96, outputTokens: 12 });
  });

  it('aggregates total tokens across providers', () => {
    const ct = new CostTracker({
      storagePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-agg-')), 'c.json')
    });
    ct.record('openai', { model: 'gpt-4o', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0 });
    ct.record('google', { model: 'gemini-2.5-flash', inputTokens: 40, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 });
    const s = ct.getSummary();
    expect(s.totalInputTokens).toBe(140);
    expect(s.totalOutputTokens).toBe(60);
    expect(s.totalRequests).toBe(2);
  });
});

describe('CostTracker pricing lookup fallbacks', () => {
  it('flags unknown-priced models instead of pricing them silently', () => {
    const ct = tmpTracker();
    ct.record('openai', { model: 'brand-new-future-model', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 });
    const s = ct.getSummary();
    expect(s.byProvider[0].unknownPricing).toBe(true);
    expect(s.byProvider[0].unknownModels).toContain('openai:brand-new-future-model');
    expect(s.byProvider[0].cost).toBe(0);
    expect(s.totalCost).toBe(0);
  });

  it('applies per-model config overrides (costTracking.pricing)', () => {
    const overrides = {
      'openai:gpt-4o': { input: 5, output: 20 }
    };
    const ct = tmpTracker({ pricing: overrides });
    ct.record('openai', { model: 'gpt-4o', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 });
    const s = ct.getSummary();
    expect(s.byProvider[0].cost).toBeCloseTo((1000 / 1e6) * 5 + (500 / 1e6) * 20, 8);
  });

  it('falls back from a date-suffixed model id to its base family price', () => {
    const pricing = getPricing('anthropic', 'claude-sonnet-4-5-20250929');
    expect(pricing.known).toBe(true);
    expect(pricing.input).toBe(3);
    expect(pricing.output).toBe(15);
  });

  it('recognizes versioned and base ollama models as free', () => {
    expect(getPricing('ollama', 'llama2').known).toBe(true);
    expect(getPricing('ollama', 'llama2').input).toBe(0);
    expect(getPricing('ollama', 'anything').known).toBe(true);
    expect(getPricing('ollama', 'anything').output).toBe(0);
  });

  it('calculateCost returns zeros for unknown pricing', () => {
    const costs = calculateCost({ inputTokens: 100, outputTokens: 200, cacheReadTokens: 0 }, { known: false });
    expect(costs.cost).toBe(0);
    expect(costs.inputCost).toBe(0);
    expect(costs.outputCost).toBe(0);
  });

  it('supports bare-model and nested provider-model config overrides', () => {
    const bare = tmpTracker({ pricing: { 'gpt-4o': { input: 1, output: 2 } } });
    bare.record('openai', { model: 'gpt-4o', inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheCreationTokens: 0 });
    expect(bare.getSummary().byProvider[0].cost).toBeCloseTo(3, 8);

    const nested = tmpTracker({ pricing: { openai: { 'gpt-4o': { input: 4, output: 8 } } } });
    nested.record('openai', { model: 'gpt-4o', inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheCreationTokens: 0 });
    expect(nested.getSummary().byProvider[0].cost).toBeCloseTo(12, 8);
  });

  it('prices cache-read tokens using the cacheRead rate', () => {
    const ct = tmpTracker();
    ct.record('openai', { model: 'gpt-4o', inputTokens: 0, outputTokens: 0, cacheReadTokens: 1000, cacheCreationTokens: 0 });
    const s = ct.getSummary();
    expect(s.totalCacheReadTokens).toBe(1000);
    expect(s.byProvider[0].cacheReadCost).toBeCloseTo((1000 / 1e6) * 1.25, 8);
  });
});

describe('CostTracker cache hits', () => {
  it('counts cache hits without charging any cost or tokens', () => {
    const ct = tmpTracker();
    ct.record('openai', { model: 'gpt-4o', inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0 });
    ct.recordCacheHit('openai');
    ct.recordCacheHit('openai');

    const s = ct.getSummary();
    expect(s.cacheHits).toBe(2);
    expect(s.totalRequests).toBe(1);
    // no double charge from cache hits
    expect(s.byProvider[0].inputTokens).toBe(1000);
    expect(s.byProvider[0].cost).toBeCloseTo((1000 / 1e6) * 2.5 + (200 / 1e6) * 10, 8);
    expect(s.totalCost).toBeCloseTo((1000 / 1e6) * 2.5 + (200 / 1e6) * 10, 8);
  });

  it('records nothing when tracking is disabled', () => {
    const ct = tmpTracker({ enabled: false });
    ct.record('openai', { model: 'gpt-4o', inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 });
    ct.recordCacheHit('openai');
    expect(ct.getSummary().totalRequests).toBe(0);
  });
});

describe('CostTracker persistence and reset', () => {
  it('persists the ledger and reloads it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-per-'));
    const storagePath = path.join(dir, 'costs.json');
    const ct = new CostTracker({ storagePath });
    ct.record('openai', { model: 'gpt-4o', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 });
    const reloaded = new CostTracker({ storagePath });
    expect(reloaded.getSummary().totalInputTokens).toBe(10);
  });

  it('reset clears the ledger', () => {
    const ct = tmpTracker();
    ct.record('openai', { model: 'gpt-4o', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 });
    ct.reset();
    const s = ct.getSummary();
    expect(s.totalRequests).toBe(0);
    expect(s.totalCost).toBe(0);
    expect(s.byProvider).toEqual([]);
  });
});