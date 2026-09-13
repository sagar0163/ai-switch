const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

let homeDir;
let server;
let port;
let mode = 'ok';

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        if (mode === 'error') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'stub exploded' } }));
          return;
        }
        if (mode === '429') {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': '60'
          });
          res.end(JSON.stringify({ error: { message: 'stub rate limited' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          model: 'gpt-4',
          choices: [{ message: { content: 'Hello from stub' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 }
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
}

function runCli(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, HOME: homeDir },
      timeout: 20000
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ status: code, signal, stdout, stderr }));
    if (input !== undefined) child.stdin.write(input);
    if (input !== undefined) child.stdin.end();
  });
}

beforeAll(async () => {
  await startServer();
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-switch-cli-'));
  const configDir = path.join(homeDir, '.ai-switch');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
    providers: {
      openai: {
        apiKey: 'sk-test',
        model: 'gpt-4',
        baseUrl: `http://127.0.0.1:${port}/v1`
      }
    },
    cache: { enabled: true, ttl: 3600, maxSize: 100 },
    failover: true,
    costTracking: { enabled: true, storagePath: path.join(configDir, 'costs.json') },
    defaultProvider: 'openai'
  }), 'utf8');
});

afterAll((done) => {
  server.close(done);
});

afterEach(() => {
  mode = 'ok';
});

describe('ai-switch CLI', () => {
  it('ask prints the provider response', async () => {
    const result = await runCli(['ask', 'hello there']);
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Response:');
    expect(result.stdout).toContain('Hello from stub');
  });

  it('ask passes flags through and reports provider errors with exit code 1', async () => {
    mode = 'error';
    const result = await runCli([
      'ask', '--primary', 'openai', '--backup', 'openai',
      '-m', 'gpt-4', '-t', '0.1', '-M', '64', 'hello'
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Error:');
    expect(result.stderr).toContain('stub exploded');
  });

  it('ask surfaces HTTP 429 failures', async () => {
    mode = '429';
    const result = await runCli(['ask', 'hello']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stub rate limited');
  });

  it('providers lists configured providers', async () => {
    const result = await runCli(['providers']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('openai');
    expect(result.stdout).toContain('gpt-4');
  });

  it('costs reports recorded usage', async () => {
    const result = await runCli(['costs']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Total Requests:\s*\d+/);
    expect(result.stdout).toContain('By Provider:');
  });

  it('costs --reset clears tracking data', async () => {
    const result = await runCli(['costs', '--reset']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Cost tracking data reset.');
  });

  it('cache clear clears the response cache', async () => {
    const result = await runCli(['cache', 'clear']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Cache cleared successfully.');
  });

  it('bare cache command shows usage hint', async () => {
    const result = await runCli(['cache']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Use: ai-switch cache clear');
  });

  it('runs with no arguments and prints help', async () => {
    const result = await runCli([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('chat exits cleanly on "exit"', async () => {
    const result = await runCli(['chat'], 'exit\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('AI Chat Mode');
  });
});