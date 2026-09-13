/**
 * ChatSession
 * Holds the conversation history for `ai-switch chat`, applies the configured
 * caps when building a request, and reports what is about to be sent.
 */

const { trimMessages, describeHistory, estimateTokens } = require('./messages');

class ChatSession {
  constructor(options = {}) {
    this.options = {
      maxTurns: options.maxTurns ?? 20,
      maxContextTokens: options.maxContextTokens ?? 4000
    };
    this.messages = [];
  }

  addUser(content) {
    this.messages.push({ role: 'user', content });
    return this;
  }

  addAssistant(content) {
    this.messages.push({ role: 'assistant', content });
    return this;
  }

  addSystem(content) {
    this.messages.unshift({ role: 'system', content });
    return this;
  }

  /**
   * Full untrimmed history.
   * @returns {Array} Copy of the accumulated messages
   */
  full() {
    return this.messages.slice();
  }

  /**
   * History trimmed to the configured caps, ready to send to a provider.
   * @returns {Array} Trimmed messages copy
   */
  toRequest() {
    return trimMessages(this.messages, this.options);
  }

  /**
   * What will actually be sent on the next request, plus its stats.
   * @returns {{messages: Array, turns: number, tokens: number}}
   */
  nextRequest() {
    const messages = this.toRequest();
    return { messages, ...describeHistory(messages) };
  }

  /**
   * Estimated tokens for the untrimmed session.
   * @returns {number}
   */
  estimateTokens() {
    return estimateTokens(this.messages);
  }

  reset() {
    this.messages = [];
    return this;
  }
}

module.exports = { ChatSession };