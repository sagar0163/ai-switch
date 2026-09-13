/**
 * Interactive prompt helpers.
 *
 * On a TTY, `text()`/`confirm()` use cooked-mode readline and `hidden()` reads
 * a secret with terminal echo disabled (raw mode) so keys are never printed.
 * On non-TTY stdin (piped input, tests) the same helpers drain lines from a
 * shared queue, so `printf 'y\nsk-...\n...' | ai-switch init` works too.
 */

const readline = require('readline');

class Prompter {
  constructor(input = process.stdin, output = process.stdout) {
    this.input = input;
    this.output = output;
    this._rl = null;
    this._ttd = false;
    this._lineQueue = [];
    this._waiters = [];
  }

  _setupTTYInterface() {
    if (this._rl) return this._rl;
    this._rl = readline.createInterface({ input: this.input, output: this.output });
    return this._rl;
  }

  _setupPipedBuffer() {
    if (this._rl) return this._rl;
    this._rl = true;
    const rl = readline.createInterface({ input: this.input });
    rl.on('line', (line) => {
      if (this._waiters.length > 0) this._waiters.shift()(line);
      else this._lineQueue.push(line);
    });
    rl.on('close', () => {
      this._closed = true;
      while (this._waiters.length > 0) this._waiters.shift()('');
    });
    return rl;
  }

  _nextPipedLine() {
    this._setupPipedBuffer();
    if (this._lineQueue.length > 0) {
      return Promise.resolve(this._lineQueue.shift());
    }
    if (this._closed) return Promise.resolve('');
    return new Promise((resolve) => this._waiters.push(resolve));
  }

  /**
   * Ask a plain question. On a TTY the user's keystrokes echo normally.
   * @param {string} query - Invitation text
   * @returns {Promise<string>} Trimmed answer
   */
  text(query) {
    this.output.write(query);
    if (!this.input.isTTY) {
      return this._nextPipedLine().then((line) => String(line).trim());
    }
    return new Promise((resolve) => {
      this._setupTTYInterface().question('', (answer) => resolve(String(answer).trim()));
    });
  }

  /**
   * Ask a yes/no question with a sensible default.
   * @param {string} query - Invitation text (without the [y/N] suffix)
   * @param {boolean} defaultYes - Enter-to-accept default
   * @returns {Promise<boolean>}
   */
  async confirm(query, defaultYes = false) {
    const suffix = defaultYes ? ' [Y/n]' : ' [y/N]';
    const answer = await this.text(`${query}${suffix} `);
    if (!answer) return defaultYes;
    return /^y/i.test(answer);
  }

  /**
   * Read a secret without echoing it to the terminal. On non-TTY stdin the
   * value is consumed from the pipe and never printed by this CLI.
   * @param {string} query - Invitation text
   * @returns {Promise<string>} The typed/piped secret (trimmed)
   */
  hidden(query) {
    this.output.write(query);
    if (!this.input.isTTY) {
      return this._nextPipedLine().then((line) => String(line).trim());
    }

    return new Promise((resolve, reject) => {
      readline.emitKeypressEvents(this.input);
      this.input.setRawMode(true);
      this.input.resume();

      let value = '';
      const onKeypress = (str, key) => {
        if (key && key.name === 'return') {
          stop();
          resolve(value);
          return;
        }
        if (key && key.ctrl && key.name === 'c') {
          stop();
          reject(new Error('cancelled'));
          return;
        }
        if (key && (key.name === 'backspace' || key.name === 'delete')) {
          value = value.slice(0, -1);
          this.output.write('\b \b');
          return;
        }
        if (str && !key.ctrl && !key.meta) {
          value += str;
          this.output.write('*');
        }
      };
      const stop = () => {
        this.input.removeListener('keypress', onKeypress);
        this.input.setRawMode(false);
        this.input.pause();
        this.output.write('\n');
      };

      this.input.on('keypress', onKeypress);
    });
  }
}

module.exports = { Prompter };