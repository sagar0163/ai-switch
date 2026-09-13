const mockAsk = jest.fn();
const mockListProviders = jest.fn();
const mockGetCosts = jest.fn();
const mockClearCache = jest.fn();
const mockReset = jest.fn();

jest.mock('../src/index', () => ({
  AISwitch: jest.fn().mockImplementation(() => ({
    ask: mockAsk,
    listProviders: mockListProviders,
    getCosts: mockGetCosts,
    clearCache: mockClearCache,
    costs: { reset: mockReset }
  }))
}));

jest.mock('readline', () => {
  const mockQuestion = jest.fn((_prompt, cb) => cb('exit'));
  return {
    createInterface: jest.fn(() => ({
      question: mockQuestion,
      close: jest.fn()
    }))
  };
});

const { program, run } = require('../src/cli');

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function parse(...args) {
  program.exitOverride().parse(['node', 'ai-switch', ...args]);
}

function capturedLogs(fn) {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  fn();
  return log.mock.calls.map((call) => call.join(' '));
}

describe('cli (in-process)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockAsk.mockReset();
    mockListProviders.mockReset();
    mockGetCosts.mockReset();
    mockClearCache.mockReset();
    mockReset.mockReset();
  });

  it('ask prints the response and stops the spinner', async () => {
    mockAsk.mockResolvedValue('the answer');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    parse('ask', 'hello');
    await flush();

    expect(mockAsk).toHaveBeenCalledWith('hello', expect.objectContaining({
      provider: undefined,
      model: undefined
    }));
    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Response:');
    expect(output).toContain('the answer');
  });

  it('ask surfaces errors and exits with code 1', async () => {
    mockAsk.mockRejectedValue(new Error('boom'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});

    parse('ask', 'hello');
    await flush();

    expect(error.mock.calls[0][1]).toBe('boom');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('ask passes provider/model/temperature flags through', async () => {
    mockAsk.mockResolvedValue('ok');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    parse('ask', '-p', 'openai', '-m', 'gpt-4', '-t', '0.3', '-M', '256', 'hi');
    await flush();

    expect(mockAsk).toHaveBeenCalledWith('hi', expect.objectContaining({
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.3,
      maxTokens: 256
    }));
  });

  it('providers lists configured providers', () => {
    mockListProviders.mockReturnValue([
      { name: 'openai', model: 'gpt-4', available: true, isDefault: true },
      { name: 'anthropic', model: 'claude-x', available: false, isDefault: false }
    ]);
    const logs = capturedLogs(() => parse('providers'));
    const output = logs.join('\n');
    expect(output).toContain('openai');
    expect(output).toContain('gpt-4');
    expect(output).toContain('(unavailable)');
  });

  it('costs prints the summary', () => {
    mockGetCosts.mockReturnValue({
      totalRequests: 7,
      cacheHits: 2,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheReadTokens: 0,
      totalCost: 0.0123,
      byProvider: [{
        provider: 'openai',
        cost: 0.0123,
        requests: 7,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        unknownPricing: false,
        unknownModels: []
      }],
      byModel: {}
    });
    const logs = capturedLogs(() => parse('costs'));
    const output = logs.join('\n');
    expect(output).toContain('Total Requests: 7');
    expect(output).toContain('Total Cost: $0.0123');
    expect(output).toContain('By Provider:');
  });

  it('costs flags unknown-priced models', () => {
    mockGetCosts.mockReturnValue({
      totalRequests: 1,
      cacheHits: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCost: 0,
      byProvider: [{
        provider: 'openai',
        cost: 0,
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        unknownPricing: true,
        unknownModels: ['openai:future-model']
      }],
      byModel: {}
    });
    const logs = capturedLogs(() => parse('costs'));
    const output = logs.join('\n');
    expect(output).toContain('[unknown pricing]');
    expect(output).toContain('openai:future-model');
  });

  it('costs --reset resets tracking', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    parse('costs', '--reset');
    expect(mockReset).toHaveBeenCalled();
  });

  it('cache clear clears the cache', async () => {
    mockClearCache.mockResolvedValue();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    parse('cache', 'clear');
    await flush();
    expect(mockClearCache).toHaveBeenCalled();
    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Cache cleared successfully.');
  });

  it('bare cache command shows the usage hint', () => {
    const logs = capturedLogs(() => parse('cache'));
    expect(logs.join('\n')).toContain('Use: ai-switch cache clear');
  });

  it('chat mode runs and exits on "exit"', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    parse('chat');
    const readlineMock = require('readline');
    expect(readlineMock.createInterface).toHaveBeenCalled();
  });

  it('run() dispatches based on argv length', () => {
    mockListProviders.mockReturnValue([]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    program.exitOverride();
    expect(() => run(['node', 'x'])).toThrow();
    expect(() => run(['node', 'x', 'providers'])).not.toThrow();
  });
});