#!/usr/bin/env node

/**
 * AI-Switch CLI
 * Command-line interface entry point
 */

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const { AISwitch } = require('./index');
const { version } = require('../package.json');

const program = new Command();

program
  .name('ai-switch')
  .description('Unified CLI for multiple AI LLM providers')
  .version(version);

// Global AI-Switch instance
let aiSwitch;

function getAISwitch() {
  if (!aiSwitch) {
    aiSwitch = new AISwitch();
  }
  return aiSwitch;
}

// Ask command
program
  .command('ask <prompt>')
  .description('Ask an AI provider a question')
  .option('-p, --provider <name>', 'Specific provider to use (openai, anthropic, etc.)')
  .option('-m, --model <model>', 'Specific model to use')
  .option('-t, --temperature <value>', 'Temperature (0-1)', parseFloat)
  .option('-M, --max-tokens <value>', 'Max tokens', parseInt)
  .option('--primary <provider>', 'Primary provider for failover')
  .option('--backup <provider>', 'Backup provider for failover')
  .option('--no-stream', 'Buffer the full response instead of streaming tokens')
  .option('-j, --json', 'Emit a single JSON object (disables streaming)')
  .action(async (prompt, options) => {
    const ai = getAISwitch();
    const jsonMode = Boolean(options.json);
    const streamMode = !jsonMode && options.stream !== false;

    const baseOptions = {
      provider: options.provider,
      primary: options.primary,
      backup: options.backup,
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens
    };

    if (streamMode) {
      let started = false;
      let meta = null;
      process.stdout.write(chalk.dim('Assistant: ') + '\n');

      try {
        await ai.ask(prompt, {
          ...baseOptions,
          stream: true,
          onToken: (delta) => {
            started = true;
            process.stdout.write(delta);
          },
          onResult: (r) => {
            meta = r;
            if (r.cache && !started) {
              started = true;
              process.stdout.write(r.text);
            }
          }
        });
        process.stdout.write('\n');
        if (meta) {
          const tag = meta.cache
            ? 'cache hit'
            : `via ${meta.provider} (${meta.model})`;
          console.log(chalk.dim(`\n[${tag}]`));
        }
      } catch (error) {
        if (started) process.stdout.write('\n');
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
      return;
    }

    const spinner = ora({
      text: 'Thinking...',
      spinner: 'dots'
    }).start();
    let metaResult = null;

    try {
      const response = await ai.ask(prompt, {
        ...baseOptions,
        onResult: (r) => { metaResult = r; }
      });

      spinner.stop();

      if (jsonMode) {
        process.stdout.write(JSON.stringify({
          provider: metaResult?.provider ?? null,
          model: metaResult?.model ?? null,
          cache: metaResult?.cache ?? false,
          usage: metaResult?.usage ?? null,
          response
        }) + '\n');
      } else {
        console.log('\n' + chalk.green('Response:'));
        console.log(response);
      }
    } catch (error) {
      spinner.stop();
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Providers list command
program
  .command('providers')
  .description('List all configured AI providers')
  .action(() => {
    const ai = getAISwitch();
    const providers = ai.listProviders();

    console.log(chalk.bold('\nConfigured Providers:\n'));
    providers.forEach(p => {
      const status = p.available ? chalk.green('✓') : chalk.red('✗');
      const prefix = p.isDefault ? ' *' : '  ';
      console.log(`${prefix} ${status} ${chalk.cyan(p.name)} - ${p.model} ${p.available ? '' : '(unavailable)'}`);
    });
    console.log('');
  });

// Costs command
program
  .command('costs')
  .description('Show API usage and cost tracking')
  .option('--reset', 'Reset cost tracking data')
  .action((options) => {
    const ai = getAISwitch();
    
    if (options.reset) {
      ai.costs.reset();
      console.log(chalk.green('Cost tracking data reset.'));
      return;
    }

    const summary = ai.getCosts();

    console.log(chalk.bold('\nAPI Usage & Costs:\n'));
    console.log(`Total Requests: ${chalk.cyan(summary.totalRequests)}`);
    console.log(`Cache Hits: ${chalk.cyan(summary.cacheHits)}`);
    console.log(`Input Tokens: ${chalk.cyan(summary.totalInputTokens)}`);
    console.log(`Output Tokens: ${chalk.cyan(summary.totalOutputTokens)}`);
    console.log(`Cached Input Tokens: ${chalk.cyan(summary.totalCacheReadTokens)}`);
    console.log(`Total Cost: ${chalk.yellow(`$${summary.totalCost.toFixed(4)}`)}\n`);

    if (summary.byProvider.length > 0) {
      console.log('By Provider:');
      summary.byProvider.forEach(p => {
        const flag = p.unknownPricing ? chalk.yellow(' [unknown pricing]') : '';
        console.log(`  ${chalk.cyan(p.provider)}: $${p.cost.toFixed(4)} (${p.requests} requests, ${p.inputTokens} in / ${p.outputTokens} out / ${p.cacheReadTokens} cached)${flag}`);
        if (p.unknownModels.length > 0) {
          console.log(`      unknown pricing models: ${p.unknownModels.join(', ')} — set costTracking.pricing overrides`);
        }
      });
    }
    console.log('');
  });

// Cache command
program
  .command('cache')
  .description('Manage response cache')
  .command('clear', 'Clear the response cache')
  .action(() => {
    console.log(chalk.yellow('Use: ai-switch cache clear'));
  });

program
  .command('cache clear')
  .description('Clear the response cache')
  .action(async () => {
    const ai = getAISwitch();
    await ai.clearCache();
    console.log(chalk.green('Cache cleared successfully.'));
  });

// Interactive chat mode
program
  .command('chat')
  .description('Start an interactive chat session')
  .option('-p, --provider <name>', 'Specific provider to use (openai, anthropic, etc.)')
  .option('-m, --model <model>', 'Specific model to use')
  .option('--no-stream', 'Buffer the full response instead of streaming tokens')
  .action((options) => {
    console.log(chalk.bold('\nAI Chat Mode (type "exit" to quit)\n'));

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const ai = getAISwitch();
    const session = ai.createChatSession();

    const askQuestion = () => {
      rl.question(chalk.cyan('You: '), async (prompt) => {
        if (prompt.toLowerCase() === 'exit') {
          rl.close();
          return;
        }

        session.addUser(prompt);

        const { messages, turns, tokens } = session.nextRequest();
        console.log(chalk.dim(`  ↪ sending ${turns} turn${turns === 1 ? '' : 's'} (~${tokens.toLocaleString()} tokens)`));

        process.stdout.write(chalk.green('AI: '));

        try {
          const response = await ai.ask(messages, {
            provider: options.provider,
            model: options.model,
            stream: options.stream !== false,
            onToken: (delta) => process.stdout.write(delta)
          });
          session.addAssistant(response);
          process.stdout.write('\n\n');
        } catch (error) {
          process.stdout.write('\n');
          console.error(chalk.red('Error:'), error.message + '\n');
        }
        askQuestion();
      });
    };

    askQuestion();
  });

// Default command - show help
if (process.argv.length === 2) {
  program.parse(['node', 'ai-switch', '--help']);
} else {
  program.parse(process.argv);
}
