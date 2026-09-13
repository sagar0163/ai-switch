/**
 * Interactive prompt helpers.
 *
 * `hidden()` reads a secret with terminal echo disabled (raw mode) so keys are
 * never printed to the screen. When stdin is not a TTY (piped input, tests) it
 * falls back to a plain line read so `echo $KEY | ai-switch keys set openai`
 * still works.
 */

const readline = require('readline');

class Prompter {
  constructor(input = process.stdin, output = process.stdout) {
    this.input = input;
    this.output = output;
    this._rl = null;
  }

  _interface() {
    if (!this._rl) {
      this._rl = readline.createInterface({ input: this.input, output: this.output });
    }
    return this._rl;
  }

  /**
   * Ask a plain question. The answer is not echoed back in the response.
   * @param {string} query - Invitation text
   * @returns {Promise<string>} Trimmed answer
   */
  text(query) {
    return new Promise((resolve) => {
      this._interface().question(query, (answer) => resolve(String(answer).trim()));
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
   * Read a secret without echoing it when possible. Never returns the caller
   * the responsibility to print it.
   * @param {string} query - Invitation text
   * @returns {Promise<string>} The typed secret
   */
  hidden(query) {
    this.output.write(query);
    return new Promise((resolve, reject) => {
      if (!this.input.isTTY) {
        this._interface().question('', (answer) => resolve(String(answer).trim()));
        return;
      }

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