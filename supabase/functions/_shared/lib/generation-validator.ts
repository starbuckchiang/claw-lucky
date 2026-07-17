// ESM port of `js/services/wallpaper/generation-validator.js`. Logic
// unchanged (same required fields, same supported wallpaper styles).

export const SUPPORTED_WALLPAPER_STYLES = Object.freeze([
  "Retro",
  "Cute",
  "Japanese",
  "Fantasy",
  "Minimal"
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// deno-lint-ignore no-explicit-any
export function validateCreateGenerationRequest(request: any) {
  const errors: string[] = [];

  if (!request || typeof request !== "object") {
    return {
      ok: false as const,
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
      ok: false as const,
      error: {
        code: "INVALID_REQUEST",
        message: "Request validation failed.",
        details: { errors }
      }
    };
  }

  if (!SUPPORTED_WALLPAPER_STYLES.includes(request.wallpaperStyle.trim())) {
    return {
      ok: false as const,
      error: {
        code: "UNSUPPORTED_WALLPAPER_STYLE",
        message: `Unsupported wallpaper style: ${request.wallpaperStyle}`
      }
    };
  }

  return {
    ok: true as const,
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
