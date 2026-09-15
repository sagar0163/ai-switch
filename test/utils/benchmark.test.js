const { runBenchmark, runRound, median } = require('../../src/utils/benchmark');
const { BaseProvider } = require('../../src/providers/base');

class FakeStreamProvider {
  constructor({ name, model, deltas, usage, fail, firstDeltaMs = 20, deltaMs = 5 }) {
    this.name = name;
    this.defaultModel = model;
    this.deltas = deltas;
    this.captureUsage = usage;
    this.fail = fail;
    this.firstDeltaMs = firstDeltaMs;
    this.deltaMs = deltaMs;
    this.streamUsage = null;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async *stream(prompt, options = {}) {
    if (this.fail) throw new Error(this.fail);
    await this._sleep(this.firstDeltaMs);
    for (const d of this.deltas) {
      yield d;
      await this._sleep(this.deltaMs);
    }
    this.streamUsage = this.captureUsage;
  }
}

class FallbackProvider extends BaseProvider {
  constructor(usage) {
    super({});
    this.name = 'openai';
    this.defaultModel = 'gpt-4o';
    this.usage = usage;
  }

  async complete() {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { text: 'whole response', usage: this.usage };
  }
}

describe('benchmark util', () => {
  const usage = { model: 'gpt-4o', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 };

  it('computes ttfb, latency and usage-derived cost per run', async () => {
    const provider = new FakeStreamProvider({
      name: 'openai',
      model: 'gpt-4o',
      deltas: ['hello', ' world'],
      usage,
      firstDeltaMs: 25,
      deltaMs: 5
    });

    const round = await runRound(provider, 'hi');
    expect(round.ttfb).toBeGreaterThanOrEqual(25);
    expect(round.latency).toBeGreaterThanOrEqual(25 + 5);
    expect(round.ttfb).toBeLessThanOrEqual(round.latency);
    expect(round.costSource).toBe('usage');
    // gpt-4o: 1000 @ $2.5/1M + 500 @ $10/1M
    expect(round.cost).toBeCloseTo((1000 / 1e6) * 2.5 + (500 / 1e6) * 10, 8);
    expect(round.textLength).toBe('hello world'.length);
  });

  it('reports median latency/ttfb/cost across multiple runs', async () => {
    const provider = new FakeStreamProvider({
      name: 'openai',
      model: 'gpt-4o',
      deltas: ['a', 'b', 'c'],
      usage,
      firstDeltaMs: 30,
      deltaMs: 10
    });

    const rows = await runBenchmark([provider], 'hi', { runs: 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0].runs).toBe(3);
    expect(rows[0].latencyMs).toBeGreaterThanOrEqual(30 + 20);
    expect(rows[0].ttfbMs).toBeGreaterThanOrEqual(30);
    expect(rows[0].costUsd).toBeCloseTo((1000 / 1e6) * 2.5 + (500 / 1e6) * 10, 8);
    expect(rows[0].costSource).toBe('usage');
    expect(rows[0].errors).toBeUndefined();
  });

  it('is reproducible: identical providers produce identical cost across runs', async () => {
    const make = () => new FakeStreamProvider({
      name: 'openai',
      model: 'gpt-4o',
      deltas: ['same', 'output'],
      usage
    });

    const a = await runBenchmark([make()], 'hi', { runs: 2 });
    const b = await runBenchmark([make()], 'hi', { runs: 2 });
    expect(a[0].costUsd).toBe(b[0].costUsd);
    expect(a[0].ttfbMs).not.toBeNull();
  });

  it('falls back to complete() when the provider cannot stream (ttfb == latency)', async () => {
    const provider = new FallbackProvider(usage);
    const rows = await runBenchmark([provider], 'hi');
    expect(rows[0].latencyMs).toBeGreaterThan(0);
    expect(rows[0].ttfbMs).toBe(rows[0].latencyMs);
    expect(rows[0].costUsd).toBeCloseTo((1000 / 1e6) * 2.5 + (500 / 1e6) * 10, 8);
  });

  it('leaves cost null when the provider reports no usage in its stream', async () => {
    const provider = new FakeStreamProvider({
      name: 'google',
      model: 'gemini-2.5-flash',
      deltas: ['no', 'usage'],
      usage: null
    });
    const rows = await runBenchmark([provider], 'hi');
    expect(rows[0].costUsd).toBeNull();
    expect(rows[0].costSource).toBeNull();
  });

  it('captures failures per provider without aborting the benchmark', async () => {
    const failing = new FakeStreamProvider({
      name: 'openai',
      model: 'gpt-4o',
      deltas: [],
      usage,
      fail: 'rate limited'
    });
    const ok = new FakeStreamProvider({
      name: 'anthropic',
      model: 'claude-haiku-4-5',
      deltas: ['works'],
      usage: { model: 'claude-haiku-4-5', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0 }
    });

    const rows = await runBenchmark([failing, ok], 'hi', { runs: 2 });
    const failed = rows.find((r) => r.provider === 'openai');
    expect(failed.errors.length).toBe(2);
    expect(failed.latencyMs).toBeNull();
    expect(failed.costUsd).toBeNull();
    expect(rows.find((r) => r.provider === 'anthropic').errors).toBeUndefined();
  });

  it('computes medians, including the even-length midpoint', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});