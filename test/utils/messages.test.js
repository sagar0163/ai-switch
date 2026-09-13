const {
  normalizeMessages,
  countTurns,
  estimateTokens,
  describeHistory,
  trimToMaxTurns,
  trimToMaxTokens,
  trimMessages
} = require('../../src/utils/messages');
const { AIError } = require('../../src/utils/errors');

describe('normalizeMessages', () => {
  it('wraps a prompt string as a single user message', () => {
    expect(normalizeMessages('hi')).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('rejects an empty or whitespace-only prompt string', () => {
    expect(() => normalizeMessages('')).toThrow(AIError);
    expect(() => normalizeMessages('   ')).toThrow(AIError);
  });

  it('passes through a valid messages array unchanged', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'again' }
    ];
    expect(normalizeMessages(messages)).toEqual(messages);
  });

  it('drops messages with unknown roles, non-string content, or null entries', () => {
    const input = [
      { role: 'user', content: 'keep' },
      { role: 'system', content: 'be nice' },
      { role: 'tool', content: 'drop' },
      { role: 'user', content: 42 },
      null
    ];
    expect(normalizeMessages(input)).toEqual([
      { role: 'user', content: 'keep' },
      { role: 'system', content: 'be nice' }
    ]);
  });

  it('rejects an empty messages array', () => {
    expect(() => normalizeMessages([])).toThrow(AIError);
  });

  it('rejects inputs that are neither string nor array', () => {
    expect(() => normalizeMessages(123)).toThrow(AIError);
    expect(() => normalizeMessages(null)).toThrow(AIError);
    expect(() => normalizeMessages(undefined)).toThrow(AIError);
  });
});

describe('history stats', () => {
  const history = [
    { role: 'user', content: 'hello world' },
    { role: 'assistant', content: 'hi there' }
  ];

  it('counts user turns', () => {
    expect(countTurns(history)).toBe(1);
    expect(countTurns([...history, { role: 'user', content: 'again' }])).toBe(2);
  });

  it('estimates tokens from content length plus per-message overhead', () => {
    expect(estimateTokens([{ role: 'user', content: 'hello' }]))
      .toBe(Math.ceil('hello'.length / 4) + 4);
  });

  it('returns zero tokens for empty or non-array input', () => {
    expect(estimateTokens([])).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  it('describeHistory reports turns and tokens', () => {
    const s = describeHistory(history);
    expect(s.turns).toBe(1);
    expect(s.tokens).toBe(estimateTokens(history));
  });
});

describe('trimToMaxTurns', () => {
  const history = [
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' }
  ];

  it('returns a copy unchanged when within the turn cap', () => {
    const result = trimToMaxTurns(history, 5);
    expect(result).toEqual(history);
    expect(result).not.toBe(history);
  });

  it('drops the oldest full turns to reach the cap', () => {
    expect(trimToMaxTurns(history, 2)).toEqual([
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' }
    ]);
  });

  it('preserves a leading system message when trimming', () => {
    const withSystem = [{ role: 'system', content: 'you are helpful' }, ...history];
    expect(trimToMaxTurns(withSystem, 2)).toEqual([
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' }
    ]);
  });
});

describe('trimToMaxTokens', () => {
  it('returns a copy unchanged when within budget', () => {
    const messages = [{ role: 'user', content: 'short' }];
    const result = trimToMaxTokens(messages, 1000);
    expect(result).toEqual(messages);
    expect(result).not.toBe(messages);
  });

  it('drops the oldest non-system messages until the estimate fits', () => {
    const big = 'x'.repeat(2000);
    const messages = [
      { role: 'system', content: 's' },
      { role: 'user', content: big },
      { role: 'assistant', content: big },
      { role: 'user', content: big }
    ];
    const result = trimToMaxTokens(messages, 1000);
    expect(result.length).toBeLessThan(messages.length);
    expect(result[0]).toEqual({ role: 'system', content: 's' });
    expect(estimateTokens(result)).toBeLessThanOrEqual(1000);
  });
});

describe('trimMessages', () => {
  let history;
  beforeEach(() => {
    history = [];
    for (let i = 0; i < 10; i++) {
      history.push({ role: 'user', content: `question${i}` });
      history.push({ role: 'assistant', content: `answer${i}` });
    }
  });

  it('caps the number of turns', () => {
    const result = trimMessages(history, { maxTurns: 3 });
    expect(countTurns(result)).toBe(3);
    expect(result).toEqual(history.slice(14));
  });

  it('returns an empty array for empty input', () => {
    expect(trimMessages([])).toEqual([]);
  });

  it('returns an untouched copy when no caps are configured', () => {
    const result = trimMessages(history, {});
    expect(result).toEqual(history);
    expect(result).not.toBe(history);
  });

  it('ignores zero or negative caps', () => {
    const result = trimMessages(history, { maxTurns: 0, maxContextTokens: -1 });
    expect(result).toEqual(history);
  });
});