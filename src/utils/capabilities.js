/**
 * Model capabilities metadata for routing
 * Tiers: fast, balanced, strong
 */

const MODEL_TIERS = {
  // OpenAI
  'gpt-4o': 'strong',
  'gpt-4o-mini': 'fast',
  'gpt-4': 'strong',
  'gpt-4-turbo': 'strong',
  'gpt-4.1': 'strong',
  'gpt-4.1-mini': 'balanced',
  'gpt-4.1-nano': 'fast',
  'gpt-3.5-turbo': 'fast',
  'gpt-5-nano': 'fast',
  'gpt-5': 'strong',
  'o3': 'strong',
  'o3-mini': 'balanced',
  'o4-mini': 'balanced',
  
  // Anthropic
  'claude-sonnet-4-6': 'strong',
  'claude-sonnet-4-5': 'strong',
  'claude-haiku-4-5': 'fast',
  'claude-opus-4-6': 'strong',
  'claude-opus-4-5': 'strong',
  'claude-3-opus-20240229': 'strong',
  'claude-3-sonnet-20240229': 'balanced',
  'claude-3-haiku-20240307': 'fast',

  // Google
  'gemini-2.5-pro': 'strong',
  'gemini-2.5-flash': 'balanced',
  'gemini-2.5-flash-lite': 'fast',
  'gemini-1.5-pro': 'strong',
  'gemini-1.5-flash': 'fast',

  // Ollama default mappings based on size (rough approximations)
  'llama3': 'balanced',
  'llama3:70b': 'strong',
  'mistral': 'fast',
  'mixtral': 'balanced',
  'gemma:7b': 'fast',
  'gemma:2b': 'fast'
};

const TIER_LEVELS = {
  'fast': 1,
  'balanced': 2,
  'strong': 3
};

function getModelTier(modelName) {
  // Try exact match first
  if (MODEL_TIERS[modelName]) {
    return MODEL_TIERS[modelName];
  }
  
  // Fallbacks based on naming heuristics
  const lower = modelName.toLowerCase();
  if (lower.includes('opus') || lower.includes('gpt-4') || lower.includes('pro') || lower.includes('70b')) {
    return 'strong';
  }
  if (lower.includes('mini') || lower.includes('haiku') || lower.includes('flash') || lower.includes('nano') || lower.includes('3.5')) {
    return 'fast';
  }
  
  // Default to balanced if unknown
  return 'balanced';
}

function meetsTier(modelTier, requiredTier) {
  if (!requiredTier) return true;
  
  const modelLevel = TIER_LEVELS[modelTier] || 2;
  const reqLevel = TIER_LEVELS[requiredTier] || 2;
  
  return modelLevel >= reqLevel;
}

module.exports = { getModelTier, meetsTier, MODEL_TIERS, TIER_LEVELS };
