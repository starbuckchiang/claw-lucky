const { GoogleGenAI } = require("@google/genai");
const { GeminiProvider } = require("./gemini-provider.js");

function loadConfig() {
  return {
    provider: process.env.AI_PROVIDER || "gemini",
    model: process.env.AI_PROVIDER_MODEL,
    apiKey: process.env.GEMINI_API_KEY,
    timeoutMs: Number(process.env.AI_PROVIDER_TIMEOUT_MS) || 20000,
    maxRetry: Number(process.env.AI_PROVIDER_MAX_RETRY) || 2,
    imageSize: process.env.AI_PROVIDER_IMAGE_SIZE,
    safetyLevel: process.env.AI_PROVIDER_SAFETY_LEVEL,
  };
}

function createProvider(logger, overrideConfig) {
  const config = overrideConfig || loadConfig();
  logger = logger || { info: () => {}, error: console.error };

  switch (config.provider) {
    case "gemini": {
      if (!config.apiKey) {
        throw new Error("GEMINI_API_KEY is not configured.");
      }
      // Create the real GoogleGenAI client instance here.
      const client = new GoogleGenAI({ apiKey: config.apiKey });
      
      // Pass dependencies as a single named object.
      return new GeminiProvider({
        config,
        client,
        logger
      });
    }
    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}

module.exports = { createProvider };