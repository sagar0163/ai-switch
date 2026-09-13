const { ChatSession } = require('../../src/utils/chatSession');

describe('ChatSession assembly', () => {
  it('assembles user and assistant turns in order', () => {
    const s = new ChatSession();
    s.addUser('hi').addAssistant('hello');
    expect(s.full()).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ]);
  });

  it('prepends a system message', () => {
    const s = new ChatSession();
    s.addSystem('be terse').addUser('hi');
    expect(s.full()).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' }
    ]);
  });

  it('reset clears the history', () => {
    const s = new ChatSession();
    s.addUser('hi').reset();
    expect(s.full()).toEqual([]);
    expect(s.nextRequest().messages).toEqual([]);
  });
});

describe('ChatSession trimming', () => {
  it('nextRequest returns the trimmed history plus turns/tokens stats', () => {
    const s = new ChatSession({ maxTurns: 2, maxContextTokens: 100000 });
    for (let i = 1; i <= 4; i++) {
      s.addUser(`q${i}`);
      s.addAssistant(`a${i}`);
    }

    const req = s.nextRequest();
    expect(req.turns).toBe(2);
    expect(req.messages).toEqual([
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: 'a3' },
      { role: 'user', content: 'q4' },
      { role: 'assistant', content: 'a4' }
    ]);
    expect(typeof req.tokens).toBe('number');
    expect(req.tokens).toBeGreaterThan(0);
  });

  it('caps by approximate context tokens', () => {
    const s = new ChatSession({ maxContextTokens: 60 });
    const long = 'y'.repeat(200);
    s.addUser('first');
    s.addAssistant(long);
    s.addUser(long);

    const req = s.nextRequest();
    expect(req.tokens).toBeLessThanOrEqual(60);
    expect(req.messages[0].role).toBe('user');
  });

  it('full() still exposes the entire untrimmed history', () => {
    const s = new ChatSession({ maxTurns: 1 });
    for (let i = 1; i <= 3; i++) {
      s.addUser(`q${i}`);
      s.addAssistant(`a${i}`);
    }
    expect(s.full().length).toBe(6);
    expect(s.nextRequest().messages.length).toBe(2);
  });
});