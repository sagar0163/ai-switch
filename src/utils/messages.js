/**
 * Message assembly, validation and trimming helpers.
 * Chat history is exchanged between the CLI, AISwitch and providers as an array
 * of OpenAI-style messages: { role: 'system'|'user'|'assistant', content: string }.
 */

const { AIError } = require('./errors');

const VALID_ROLES = new Set(['system', 'user', 'assistant']);

/**
 * Normalize an `ask()` argument into a messages array.
 * A plain string stays a single user message; an array is validated and cleaned.
 * @param {string|Array} input - Prompt string or messages array
 * @returns {Array} Non-empty messages array
 */
function normalizeMessages(input) {
  if (typeof input === 'string') {
    if (!input.trim()) {
      throw new AIError('ask() requires a non-empty prompt or messages array');
    }
    return [{ role: 'user', content: input }];
  }

  if (Array.isArray(input)) {
    const messages = input
      .filter((m) => m && typeof m === 'object' && VALID_ROLES.has(m.role) && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content }));

    if (messages.length === 0) {
      throw new AIError('ask() requires a non-empty prompt or messages array');
    }
    return messages;
  }

  throw new AIError('ask() requires a prompt string or a messages array');
}

/**
 * Number of user turns in a history (each user turn is a round of the conversation).
 * @param {Array} messages - Messages array
 * @returns {number} Turn count
 */
function countTurns(messages) {
  return messages.filter((m) => m.role === 'user').length;
}

/**
 * Rough token estimate for the request payload (chars/4 plus per-message overhead).
 * Not a billing number; used only for the chat-mode "what's being sent" indicator.
 * @param {Array} messages - Messages array
 * @returns {number} Approximate token count
 */
function estimateTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, m) => total + Math.ceil((m.content.length || 0) / 4) + 4, 0);
}

/**
 * Describe a history for the chat indicator.
 * @param {Array} messages - Messages array
 * @returns {{turns: number, tokens: number}}
 */
function describeHistory(messages) {
  return { turns: countTurns(messages), tokens: estimateTokens(messages) };
}

/**
 * Drop whole user->assistant turns from the front until `maxTurns` user turns
 * remain. Leading system messages are preserved and reattached.
 * @param {Array} messages - Messages array
 * @param {number} maxTurns - Maximum user turns to keep
 * @returns {Array} Copy with at most maxTurns turns
 */
function trimToMaxTurns(messages, maxTurns) {
  const userCount = countTurns(messages);
  if (userCount <= maxTurns) return messages.slice();

  const excess = userCount - maxTurns;
  let seen = 0;
  let startIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      seen += 1;
      if (seen === excess + 1) {
        startIndex = i;
        break;
      }
    }
  }

  // Re-attach any contiguous leading system messages.
  const leadingSystem = [];
  for (const m of messages) {
    if (m.role === 'system') leadingSystem.push(m);
    else break;
  }

  return startIndex < leadingSystem.length
    ? messages.slice(startIndex)
    : [...leadingSystem, ...messages.slice(startIndex)];
}

/**
 * Drop the oldest non-system messages until the estimated token count fits.
 * @param {Array} messages - Messages array
 * @param {number} maxContextTokens - Estimated-token budget for the request
 * @returns {Array} Copy that fits within the budget
 */
function trimToMaxTokens(messages, maxContextTokens) {
  if (estimateTokens(messages) <= maxContextTokens) return messages.slice();

  const trimmed = messages.slice();
  while (trimmed.length > 1 && estimateTokens(trimmed) > maxContextTokens) {
    const idx = trimmed.findIndex((m) => m.role !== 'system');
    if (idx === -1) break;
    trimmed.splice(idx, 1);
  }
  return trimmed;
}

/**
 * Cap a conversation history before it is sent to a provider.
 * Applies the turn cap first, then the approximate-token budget.
 * @param {Array} messages - Messages array
 * @param {{maxTurns?: number, maxContextTokens?: number}} [options] - Caps
 * @returns {Array} Trimmed copy of the history
 */
function trimMessages(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  let trimmed = messages.slice();
  if (typeof options.maxTurns === 'number' && options.maxTurns > 0) {
    trimmed = trimToMaxTurns(trimmed, options.maxTurns);
  }
  if (typeof options.maxContextTokens === 'number' && options.maxContextTokens > 0) {
    trimmed = trimToMaxTokens(trimmed, options.maxContextTokens);
  }
  return trimmed;
}

module.exports = {
  VALID_ROLES,
  normalizeMessages,
  countTurns,
  estimateTokens,
  describeHistory,
  trimToMaxTurns,
  trimToMaxTokens,
  trimMessages
};