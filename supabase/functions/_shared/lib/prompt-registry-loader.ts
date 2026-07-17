// ESM port of `js/services/prompt/prompt-registry-loader.js`. Logic
// unchanged (active-prompt lookup, in-memory TTL cache, fallback template,
// MULTIPLE_ACTIVE_PROMPTS / INVALID_TEMPLATE errors).

import { SUPPORTED_PROMPT_TYPES, getFallbackPrompt } from "./fallback-templates.ts";

export class PromptRegistryError extends Error {
  code: string;
  // deno-lint-ignore no-explicit-any
  details: any;

  // deno-lint-ignore no-explicit-any
  constructor(code: string, message: string, details: any = {}) {
    super(message);
    this.name = "PromptRegistryError";
    this.code = code;
    this.details = details;
  }
}

function isNonEmptyTemplate(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// deno-lint-ignore no-explicit-any
function normalizeMetadata(rawMetadata: any): Record<string, unknown> {
  if (rawMetadata && typeof rawMetadata === "object" && !Array.isArray(rawMetadata)) {
    return rawMetadata;
  }

  return {};
}

function createInMemoryCache({ enabled = true, ttlMs = 60_000 }: { enabled?: boolean; ttlMs?: number } = {}) {
  const useCache = Boolean(enabled);
  const normalizedTtlMs = Number.isFinite(Number(ttlMs)) ? Math.max(1, Number(ttlMs)) : 60_000;
  // deno-lint-ignore no-explicit-any
  const store = new Map<string, { value: any; expiresAtMs: number }>();

  function getValid(promptType: string, nowMs: number) {
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

  // deno-lint-ignore no-explicit-any
  function set(promptType: string, value: any, nowMs: number) {
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

export function createPromptRepositoryFromSupabaseClient({
  supabaseClient,
  tableName = "prompt_versions"
  // deno-lint-ignore no-explicit-any
}: { supabaseClient: any; tableName?: string }) {
  if (!supabaseClient || typeof supabaseClient.from !== "function") {
    throw new Error("A valid supabaseClient with from() is required.");
  }

  return {
    async fetchActivePromptsByType(promptType: string) {
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

export function createPromptRegistryLoader({
  repository,
  cache = { enabled: true, ttlMs: 60_000 },
  now = () => Date.now()
}: {
  repository: {
    // deno-lint-ignore no-explicit-any
    fetchActivePromptsByType(promptType: string): Promise<any[]>;
  };
  cache?: { enabled?: boolean; ttlMs?: number };
  now?: () => number;
}) {
  if (!repository || typeof repository.fetchActivePromptsByType !== "function") {
    throw new Error("Prompt loader requires repository.fetchActivePromptsByType(promptType).");
  }

  const memoryCache = createInMemoryCache(cache);

  async function loadActivePrompt(promptType: string) {
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

    // deno-lint-ignore no-explicit-any
    let rows: any[];
    try {
      rows = await repository.fetchActivePromptsByType(normalizedPromptType);
    } catch (_error) {
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
