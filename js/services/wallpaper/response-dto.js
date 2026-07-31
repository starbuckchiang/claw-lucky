"use strict";

function createGenerationSuccessDto(record) {
  return {
    ok: true,
    data: {
      generationId: String(record.generationId),
      status: String(record.status),
      provider: String(record.provider || "unknown"),
      model: record.model ? String(record.model) : null,
      imageUrl: record.imageUrl ? String(record.imageUrl) : null,
      promptVersion: String(record.promptVersion),
      durationMs: Number.isFinite(Number(record.durationMs)) ? Number(record.durationMs) : 0,
      createdAt: String(record.createdAt),
      // Safe Shopkeeper display fields (P2-AI-04 Lite). Sourced from the
      // Shopkeeper Context Agent's output for THIS generation (never
      // reconstructed/re-derived here). Deliberately excludes `source`
      // (ai|fallback) and `shopkeeperVersion` — those stay internal/
      // Observability-only and are never exposed to the client.
      luckyTheme: record.luckyTheme ? String(record.luckyTheme) : null,
      blessing: record.blessing ? String(record.blessing) : null,
      story: record.story ? String(record.story) : null,
      oneLiner: record.oneLiner ? String(record.oneLiner) : null,
      shopkeeperMessage: record.shopkeeperMessage ? String(record.shopkeeperMessage) : null
    }
  };
}

function createGenerationErrorDto({ code, message, retryable = false, details = null }) {
  return {
    ok: false,
    error: {
      code: String(code),
      message: String(message),
      retryable: Boolean(retryable),
      details: details || null
    }
  };
}

module.exports = {
  createGenerationSuccessDto,
  createGenerationErrorDto
};
