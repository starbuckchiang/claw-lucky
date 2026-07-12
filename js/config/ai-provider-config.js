"use strict";

function getProcessEnv() {
  if (typeof process === "undefined" || !process?.env) {
    throw new Error("AI provider config must be loaded from a secure backend environment.");
  }

  return process.env;
}

function readEnvValue(env, key, { required = false, defaultValue = "" } = {}) {
  const value = String(env[key] ?? "").trim();

  if (!value) {
    if (required) {
      throw new Error(`Missing required environment variable: ${key}`);
    }

    return defaultValue;
  }

  return value;
}

function loadAiProviderConfig(env = getProcessEnv()) {
  return {
    providerName: readEnvValue(env, "AI_PROVIDER_NAME", { required: true }),
    model: readEnvValue(env, "AI_PROVIDER_MODEL", { required: true }),
    endpoint: readEnvValue(env, "AI_PROVIDER_ENDPOINT", { required: true }),
    apiKey: readEnvValue(env, "AI_PROVIDER_API_KEY", { required: true })
  };
}

module.exports = {
  loadAiProviderConfig
};
