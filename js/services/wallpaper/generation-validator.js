"use strict";

const SUPPORTED_WALLPAPER_STYLES = Object.freeze([
  "Retro",
  "Cute",
  "Japanese",
  "Fantasy",
  "Minimal"
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCreateGenerationRequest(request) {
  const errors = [];

  if (!request || typeof request !== "object") {
    return {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Request payload must be an object."
      }
    };
  }

  const requiredFields = [
    "userId",
    "mascotId",
    "giftId",
    "wallpaperStyle",
    "luckyTheme",
    "blessing",
    "promptType"
  ];

  for (const field of requiredFields) {
    if (!isNonEmptyString(request[field])) {
      errors.push(`${field} is required`);
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Request validation failed.",
        details: { errors }
      }
    };
  }

  if (!SUPPORTED_WALLPAPER_STYLES.includes(request.wallpaperStyle.trim())) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_WALLPAPER_STYLE",
        message: `Unsupported wallpaper style: ${request.wallpaperStyle}`
      }
    };
  }

  return {
    ok: true,
    value: {
      userId: String(request.userId).trim(),
      mascotId: String(request.mascotId).trim(),
      giftId: String(request.giftId).trim(),
      wallpaperStyle: String(request.wallpaperStyle).trim(),
      luckyTheme: String(request.luckyTheme).trim(),
      blessing: String(request.blessing).trim(),
      promptType: String(request.promptType).trim()
    }
  };
}

module.exports = {
  SUPPORTED_WALLPAPER_STYLES,
  validateCreateGenerationRequest
};
