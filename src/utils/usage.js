/**
 * Usage parsing: extract provider-billed token counts from real API responses.
 *
 * Each parser returns a canonical usage record:
 *   { model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }
 * where every count defaults to 0 when the field is absent.
 */

function parseOpenAIUsage(data) {
  const u = (data && data.usage) || {};
  return {
    model: (data && data.model) || null,
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0
  };
}

function parseAnthropicUsage(data) {
  const u = (data && data.usage) || {};
  return {
    model: (data && data.model) || null,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0
  };
}

function parseGoogleUsage(data, model = null) {
  const m = (data && data.usageMetadata) || {};
  return {
    model,
    inputTokens: m.promptTokenCount ?? 0,
    outputTokens: m.candidatesTokenCount ?? 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0
  };
}

function parseOllamaUsage(data) {
  return {
    model: (data && data.model) || null,
    inputTokens: data && data.prompt_eval_count != null ? data.prompt_eval_count : 0,
    outputTokens: data && data.eval_count != null ? data.eval_count : 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0
  };
}

const PARSERS = {
  openai: parseOpenAIUsage,
  anthropic: parseAnthropicUsage,
  google: parseGoogleUsage,
  ollama: parseOllamaUsage
};

/**
 * Parse a raw provider data payload into a canonical usage record.
 * @param {string} provider - Provider name
 * @param {Object} data - Raw response JSON from the provider
 * @param {string} [model] - Fallback model id (used when the payload omits it)
 * @returns {Object} Canonical usage record
 */
function parseUsage(provider, data, model = null) {
  const parser = PARSERS[provider];
  if (!parser) {
    return {
      model: model || null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    };
  }
  return parser(data, model);
}

module.exports = {
  parseOpenAIUsage,
  parseAnthropicUsage,
  parseGoogleUsage,
  parseOllamaUsage,
  parseUsage
};