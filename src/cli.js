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
  .option('-j, --json', 'Output raw JSON (non-streaming, for scripting)')
  .option('--no-stream', 'Disable token streaming (buffered response)')
  .action(async (prompt, options) => {
    const ai = getAISwitch();
    const json = Boolean(options.json);
    const streaming = !json && options.stream !== false;

    const request = {
      provider: options.provider,
      primary: options.primary,
      backup: options.backup,
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens
    };

    let spinner;
    if (!json) {
      spinner = ora({ text: 'Thinking...', spinner: 'dots' }).start();
    }

    let sawToken = false;
    const emitToken = (delta) => {
      if (spinner && spinner.isSpinning) spinner.stop();
      sawToken = true;
      process.stdout.write(delta);
    };

    try {
      const response = await ai.ask(prompt, {
        ...request,
        stream: streaming,
        json,
        onToken: streaming ? emitToken : undefined
      });

      if (json) {
        if (spinner) spinner.stop();
        console.log(JSON.stringify(response, null, 2));
      } else if (streaming) {
        if (spinner && spinner.isSpinning) spinner.stop();
        if (sawToken) {
          process.stdout.write('\n');
        } else {
          // Cache hit (or provider didn't stream): print the full response.
          console.log('\n' + chalk.green('Response:'));
          console.log(response);
        }
      } else {
        spinner.stop();
        console.log('\n' + chalk.green('Response:'));
        console.log(response);
      }
    } catch (error) {
      if (spinner) spinner.stop();
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
  .option('--no-stream', 'Disable token streaming (buffered response)')
  .action((options) => {
    console.log(chalk.bold('\nAI Chat Mode (type "exit" to quit)\n'));

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const ai = getAISwitch();
    const session = ai.createChatSession();
    const streaming = options.stream !== false;

    const askQuestion = () => {
      rl.question(chalk.cyan('You: '), async (prompt) => {
        if (prompt.toLowerCase() === 'exit') {
          rl.close();
          return;
        }

        session.addUser(prompt);

        const spinner = ora('Thinking...').start();
        const { messages, turns, tokens } = session.nextRequest();
        console.log(chalk.dim(`  ↪ sending ${turns} turn${turns === 1 ? '' : 's'} (~${tokens.toLocaleString()} tokens)`));

        let sawToken = false;
        const emitToken = (delta) => {
          if (spinner.isSpinning) spinner.stop();
          sawToken = true;
          process.stdout.write(delta);
        };

        try {
          const response = await ai.ask(messages, {
            provider: options.provider,
            model: options.model,
            stream: streaming,
            onToken: streaming ? emitToken : undefined
          });

          session.addAssistant(response);

          if (streaming) {
            if (spinner.isSpinning) spinner.stop();
            if (sawToken) {
              process.stdout.write('\n');
            } else {
              console.log(chalk.green('AI: ') + response + '\n');
            }
          } else {
            spinner.stop();
            console.log(chalk.green('AI: ') + response + '\n');
          }
        } catch (error) {
          spinner.stop();
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
