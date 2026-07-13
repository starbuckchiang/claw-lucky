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
      createdAt: String(record.createdAt)
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
