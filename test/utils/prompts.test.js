const { PassThrough } = require('stream');
const { Prompter } = require('../../src/utils/prompts');

function pipePrompter(inputLines) {
  const stdin = new PassThrough();
  const stdout = { chunks: [], write(c) { this.chunks.push(String(c)); } };
  const p = new Prompter(stdin, stdout);
  stdin.end(inputLines.join('\n') + '\n');
  return { p, stdout };
}

describe('Prompter non-TTY (piped input)', () => {
  it('reads multiple lines deterministically from a pipe', async () => {
    const { p } = pipePrompter(['y', 'sk-secret-1', 'n', 'n', 'n']);
    expect(await p.confirm('Q1 ', false)).toBe(true);
    expect(await p.hidden('Key: ')).toBe('sk-secret-1');
    expect(await p.confirm('Q2 ', false)).toBe(false);
    expect(await p.confirm('Q3 ', false)).toBe(false);
    expect(await p.confirm('Q4 ', false)).toBe(false);
  });

  it('returns the default when a piped confirm line is blank', async () => {
    const { p } = pipePrompter(['', 'yes']);
    expect(await p.confirm('Use default?', true)).toBe(true);
    expect(await p.confirm('Plain?', false)).toBe(true);
  });

  it('trim()s piped answers', async () => {
    const { p } = pipePrompter(['  sk-abc  ']);
    expect(await p.hidden('K: ')).toBe('sk-abc');
  });

  it('does not echo the piped secret to the output', async () => {
    const { p, stdout } = pipePrompter(['sk-very-secret-value']);
    await p.hidden('Key: ');
    const out = stdout.chunks.join('');
    expect(out).not.toContain('sk-very-secret-value');
    expect(out).toContain('Key:');
  });
});