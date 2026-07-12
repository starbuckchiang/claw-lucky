"use strict";

const {
  SUPPORTED_PROMPT_TYPES,
  getFallbackPrompt
} = require("./fallback-templates");

class PromptRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PromptRegistryError";
    this.code = code;
    this.details = details;
  }
}

function isNonEmptyTemplate(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeMetadata(rawMetadata) {
  if (rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)) {
    return rawMetadata;
  }

  return {};
}

function createInMemoryCache({ enabled = true, ttlMs = 60_000 } = {}) {
  const useCache = Boolean(enabled);
  const normalizedTtlMs = Number.isFinite(Number(ttlMs)) ? Math.max(1, Number(ttlMs)) : 60_000;
  const store = new Map();

  function getValid(promptType, nowMs) {
    if (!useCache) {
      return null;
    }

    const item = store.get(promptType);

    if (!item) {
      return null;
    }

    if (item.expiresAtMs <= nowMs) {
      store.delete(promptType);
      return null;
    }

    return item.value;
  }

  function set(promptType, value, nowMs) {
    if (!useCache || value?.source !== "database") {
      return;
    }

    store.set(promptType, {
      value,
      expiresAtMs: nowMs + normalizedTtlMs
    });
  }

  function clear() {
    store.clear();
  }

  return {
    enabled: useCache,
    ttlMs: normalizedTtlMs,
    getValid,
    set,
    clear
  };
}

function createPromptRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "prompt_versions"
}) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return {
    async fetchActivePromptsByType(promptType) {
      const { data, error } = await supabaseClient
        .from(tableName)
        .select("prompt_type,version,template,metadata_json,is_active,created_at")
        .eq("prompt_type", promptType)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      return Array.isArray(data) ? data : [];
    }
  };
}

function createPromptRegistryLoader({
  repository,
  cache = { enabled: true, ttlMs: 60_000 },
  now = () => Date.now()
}) {
  if (!repository || typeof repository.fetchActivePromptsByType !== "function") {
    throw new Error("Prompt loader requires repository.fetchActivePromptsByType(promptType).");
  }

  const memoryCache = createInMemoryCache(cache);

  async function loadActivePrompt(promptType) {
    const normalizedPromptType = String(promptType || "").trim();

    if (!SUPPORTED_PROMPT_TYPES.includes(normalizedPromptType)) {
      throw new PromptRegistryError(
        "UNSUPPORTED_PROMPT_TYPE",
        `Unsupported promptType: ${normalizedPromptType || "(empty)"}`,
        { promptType: normalizedPromptType }
      );
    }

    const nowMs = Number(now());
    const cached = memoryCache.getValid(normalizedPromptType, nowMs);

    if (cached) {
      return cached;
    }

    let rows;
    try {
      rows = await repository.fetchActivePromptsByType(normalizedPromptType);
    } catch (error) {
      return getFallbackPrompt(normalizedPromptType);
    }

    if (!rows.length) {
      return getFallbackPrompt(normalizedPromptType);
    }

    if (rows.length > 1) {
      throw new PromptRegistryError(
        "MULTIPLE_ACTIVE_PROMPTS",
        `Multiple active prompts found for promptType: ${normalizedPromptType}`,
        { promptType: normalizedPromptType, count: rows.length }
      );
    }

    const row = rows[0];
    const template = String(row?.template || "");

    if (!isNonEmptyTemplate(template)) {
      throw new PromptRegistryError(
        "INVALID_TEMPLATE",
        `Template is empty for promptType: ${normalizedPromptType}`,
        { promptType: normalizedPromptType }
      );
    }

    const normalized = {
      promptType: normalizedPromptType,
      version: String(row?.version || "").trim() || "unknown",
      template: template.trim(),
      metadata: normalizeMetadata(row?.metadata_json),
      source: "database"
    };

    memoryCache.set(normalizedPromptType, normalized, nowMs);

    return normalized;
  }

  return {
    loadActivePrompt,
    clearCache() {
      memoryCache.clear();
    },
    getCacheInfo() {
      return {
        enabled: memoryCache.enabled,
        ttlMs: memoryCache.ttlMs
      };
    }
  };
}

module.exports = {
  PromptRegistryError,
  createPromptRepositoryFromSupabaseClient,
  createPromptRegistryLoader
};
