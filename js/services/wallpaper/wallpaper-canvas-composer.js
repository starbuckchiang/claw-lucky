(function () {
  "use strict";

  /**
   * Wallpaper Canvas Composer (P2-AI-04 Lite-4).
   *
   * Frontend-only module (no Deno/`.ts` twin \u2014 Supabase Edge Functions never
   * render a canvas). Responsible for compositing the real Traditional
   * Chinese "one-liner" blessing text, the generation date, and the brand
   * name onto a text-free background image produced by Gemini (see
   * wallpaper-prompt-builder.js, which now instructs Gemini to never render
   * any text at all).
   *
   * IMPORTANT (communicated explicitly per product decision): the Prompt
   * Builder change only REDUCES the probability that Gemini bakes fake
   * text/calligraphy into the generated background pixels \u2014 it cannot
   * guarantee 0% occurrence, and this module has no way to detect or clean
   * up fake text that Gemini may still have drawn into the image itself.
   * What this module DOES guarantee is that the text it composites on top
   * (the one-liner, date, and brand) is always correctly-rendered real
   * Traditional Chinese, since it is real DOM/Canvas text using a properly
   * loaded, self-hosted font \u2014 never AI-generated pixels.
   */

  const DEFAULT_BRAND_TEXT = "Claw Lucky";
  const DEFAULT_FONT_FAMILY = '"Noto Serif TC"';
  const SAFE_ZONE_RATIO = 0.2;
  const MAX_ONE_LINER_LINES = 3;

  const CJK_REGEX = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7a3]/;

  function sanitizeOneLiner(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  /**
   * Deterministically formats an ISO timestamp (e.g. a generation record's
   * `createdAt`) as "YYYY.MM.DD" in the Asia/Taipei timezone. Returns null
   * (never throws, never guesses "now") when the input is missing/invalid \u2014
   * callers must treat a null result as "no date available" rather than
   * fabricating one on the client.
   *
   * @param {?string} isoString
   * @returns {?string}
   */
  function formatTaipeiDateFromIso(isoString) {
    if (!isoString || typeof isoString !== "string") return null;

    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) return null;

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });

    const lookup = {};
    for (const part of formatter.formatToParts(parsed)) {
      lookup[part.type] = part.value;
    }

    if (!lookup.year || !lookup.month || !lookup.day) return null;
    return `${lookup.year}.${lookup.month}.${lookup.day}`;
  }

  function buildFooterMetaLine(dateText, brandText) {
    const parts = [dateText, brandText].filter(
      (value) => typeof value === "string" && value.trim().length > 0
    );
    return parts.join("\u3000\u30fb\u3000");
  }

  function tokenize(text) {
    const tokens = [];
    let buffer = "";

    for (const ch of Array.from(text)) {
      if (CJK_REGEX.test(ch)) {
        if (buffer) {
          tokens.push(buffer);
          buffer = "";
        }
        tokens.push(ch);
      } else if (/\s/.test(ch)) {
        if (buffer) {
          tokens.push(buffer);
          buffer = "";
        }
        tokens.push(ch);
      } else {
        buffer += ch;
      }
    }
    if (buffer) tokens.push(buffer);
    return tokens;
  }

  function expandOversizedTokens(tokens, measureFn, maxWidth) {
    const result = [];
    for (const token of tokens) {
      if (token.trim() !== "" && measureFn(token) > maxWidth) {
        result.push(...Array.from(token));
      } else {
        result.push(token);
      }
    }
    return result;
  }

  /**
   * Wraps arbitrary text (Traditional Chinese, Latin, mixed, punctuation,
   * emoji) into at most `maxLines` lines that each fit within `maxWidth`,
   * per the caller-supplied `measureFn`. Truncates with an ellipsis if the
   * content does not fit. Returns `[]` for empty/blank input \u2014 never
   * throws.
   *
   * @param {object} options
   * @param {string} options.text
   * @param {(text:string)=>number} options.measureFn
   * @param {number} options.maxWidth
   * @param {number} [options.maxLines]
   * @returns {string[]}
   */
  function wrapTextByMeasurement({ text, measureFn, maxWidth, maxLines = MAX_ONE_LINER_LINES }) {
    const normalized = sanitizeOneLiner(text);
    if (!normalized) return [];

    const canMeasure = typeof measureFn === "function" && Number.isFinite(maxWidth) && maxWidth > 0;
    if (!canMeasure) return [normalized];

    const tokens = expandOversizedTokens(tokenize(normalized), measureFn, maxWidth);
    const lines = [];
    let currentLine = "";
    let index = 0;

    while (index < tokens.length && lines.length < maxLines) {
      const token = tokens[index];

      if (currentLine === "" && token.trim() === "") {
        index += 1;
        continue;
      }

      const candidate = currentLine + token;
      if (currentLine === "" || measureFn(candidate) <= maxWidth) {
        currentLine = candidate;
        index += 1;
      } else {
        lines.push(currentLine.trimEnd());
        currentLine = "";
      }
    }

    const truncated = index < tokens.length;

    if (currentLine && lines.length < maxLines) {
      lines.push(currentLine.trimEnd());
    }

    if (lines.length > maxLines) {
      lines.length = maxLines;
    }

    if (truncated && lines.length > 0) {
      let lastLine = lines[lines.length - 1];
      while (lastLine.length > 0 && measureFn(`${lastLine}\u2026`) > maxWidth) {
        lastLine = lastLine.slice(0, -1);
      }
      lines[lines.length - 1] = `${lastLine}\u2026`;
    }

    return lines;
  }

  /**
   * Tracks the most recently created `object:` URL and revokes the previous
   * one automatically whenever a new one is tracked (repeat-generation
   * safety) or when `clear()` is called explicitly (page-unload safety).
   * Kept as a small, independently testable unit so wallpaper.js's actual
   * DOM-wiring can stay a thin, untested page controller like the rest of
   * the project's page scripts.
   */
  function createObjectUrlTracker({ urlApi = (typeof URL !== "undefined" ? URL : null) } = {}) {
    let currentUrl = null;

    function safeRevoke(url) {
      if (!url || !urlApi || typeof urlApi.revokeObjectURL !== "function") return;
      try {
        urlApi.revokeObjectURL(url);
      } catch (_error) {
        // Never throw from cleanup.
      }
    }

    function track(nextUrl) {
      if (currentUrl && currentUrl !== nextUrl) {
        safeRevoke(currentUrl);
      }
      currentUrl = nextUrl || null;
      return currentUrl;
    }

    function clear() {
      safeRevoke(currentUrl);
      currentUrl = null;
    }

    function current() {
      return currentUrl;
    }

    return { track, clear, current };
  }

  function loadImageElement({ doc, win, src }) {
    return new Promise((resolve, reject) => {
      const ImageCtor = (win && win.Image) || (typeof Image !== "undefined" ? Image : null);
      if (!ImageCtor) {
        const error = new Error("Image constructor is not available in this environment.");
        error.code = "IMAGE_LOAD_FAILED";
        reject(error);
        return;
      }

      const img = new ImageCtor();
      img.onload = () => {
        if (!img.naturalWidth || !img.naturalHeight) {
          const error = new Error("Loaded image has no natural dimensions.");
          error.code = "IMAGE_LOAD_FAILED";
          reject(error);
          return;
        }
        resolve(img);
      };
      img.onerror = () => {
        const error = new Error("Failed to load the source image for compositing.");
        error.code = "IMAGE_LOAD_FAILED";
        reject(error);
      };
      img.src = src;
    });
  }

  async function ensureFontReady({ doc, fontSpecs }) {
    if (!doc || !doc.fonts || typeof doc.fonts.load !== "function") {
      const error = new Error("The FontFaceSet API (document.fonts) is not available.");
      error.code = "FONT_LOAD_FAILED";
      throw error;
    }

    try {
      await Promise.all(fontSpecs.map((spec) => doc.fonts.load(spec)));
    } catch (_error) {
      // Fall through to the explicit `.check()` verification below \u2014 a
      // rejected `.load()` is not by itself conclusive.
    }

    if (doc.fonts.ready && typeof doc.fonts.ready.then === "function") {
      try {
        await doc.fonts.ready;
      } catch (_error) {
        // `document.fonts.ready` does not normally reject, but guard anyway.
      }
    }

    const allLoaded = fontSpecs.every((spec) => {
      try {
        return doc.fonts.check(spec);
      } catch (_error) {
        return false;
      }
    });

    if (!allLoaded) {
      const error = new Error("Required font failed to load \u2014 refusing to render text with an uncertain font.");
      error.code = "FONT_LOAD_FAILED";
      throw error;
    }
  }

  function drawTextSafeZone(ctx, canvas, { oneLiner, createdAt, brandText, fontFamily }) {
    const safeZoneHeight = Math.round(canvas.height * SAFE_ZONE_RATIO);
    const zoneTop = canvas.height - safeZoneHeight;

    const gradient = ctx.createLinearGradient(0, zoneTop, 0, canvas.height);
    gradient.addColorStop(0, "rgba(20, 12, 8, 0)");
    gradient.addColorStop(0.35, "rgba(20, 12, 8, 0.55)");
    gradient.addColorStop(1, "rgba(20, 12, 8, 0.78)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, zoneTop, canvas.width, safeZoneHeight);

    const oneLinerFontSize = Math.max(22, Math.round(canvas.width * 0.045));
    const metaFontSize = Math.max(16, Math.round(canvas.width * 0.028));
    const maxTextWidth = Math.round(canvas.width * 0.86);
    const centerX = canvas.width / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    ctx.font = `700 ${oneLinerFontSize}px ${fontFamily}`;
    const lines = wrapTextByMeasurement({
      text: sanitizeOneLiner(oneLiner),
      measureFn: (value) => ctx.measureText(value).width,
      maxWidth: maxTextWidth,
      maxLines: MAX_ONE_LINER_LINES
    });

    const metaLine = buildFooterMetaLine(formatTaipeiDateFromIso(createdAt), brandText);

    const lineHeight = Math.round(oneLinerFontSize * 1.35);
    const metaLineHeight = Math.round(metaFontSize * 1.4);
    const blockHeight = lines.length * lineHeight + (metaLine ? metaLineHeight + 10 : 0);

    let cursorY = canvas.height - Math.round(safeZoneHeight * 0.28) - blockHeight + lineHeight;

    ctx.fillStyle = "#fff8ec";
    lines.forEach((line) => {
      ctx.fillText(line, centerX, cursorY);
      cursorY += lineHeight;
    });

    if (metaLine) {
      ctx.font = `400 ${metaFontSize}px ${fontFamily}`;
      ctx.fillStyle = "rgba(255, 248, 236, 0.86)";
      ctx.fillText(metaLine, centerX, cursorY + 6);
    }
  }

  /**
   * Composites the final wallpaper image: draws the (text-free) source
   * image at its own native pixel dimensions (never multiplied by
   * devicePixelRatio), then overlays the one-liner/date/brand text in the
   * bottom safe zone using the self-hosted Noto Serif TC font.
   *
   * Resolves with `{ blob, previewUrl, width, height }` \u2014 deliberately
   * does NOT return a `dataUrl` or an exposed `toBlob()` function, so
   * callers cannot accidentally bypass the object-URL lifecycle.
   *
   * Rejects (never resolves with a blank/partial canvas) with an
   * `Error` carrying a `.code` of `IMAGE_LOAD_FAILED`, `CANVAS_UNSUPPORTED`,
   * `FONT_LOAD_FAILED`, or `BLOB_ENCODE_FAILED` on any failure.
   *
   * @param {object} options
   * @param {string} options.sourceObjectUrl - same-origin `blob:` URL of the raw AI image.
   * @param {?string} options.oneLiner
   * @param {?string} options.createdAt - ISO timestamp from the generation record.
   * @param {string} [options.brandText]
   * @param {string} [options.fontFamily]
   * @param {Document} [options.doc]
   * @param {Window} [options.win]
   * @returns {Promise<{blob: Blob, previewUrl: string, width: number, height: number}>}
   */
  async function composeWallpaperImage({
    sourceObjectUrl,
    oneLiner,
    createdAt,
    brandText = DEFAULT_BRAND_TEXT,
    fontFamily = DEFAULT_FONT_FAMILY,
    doc = (typeof document !== "undefined" ? document : null),
    win = (typeof window !== "undefined" ? window : null)
  } = {}) {
    if (!sourceObjectUrl) {
      const error = new Error("composeWallpaperImage requires sourceObjectUrl.");
      error.code = "IMAGE_LOAD_FAILED";
      throw error;
    }
    if (!doc || typeof doc.createElement !== "function") {
      const error = new Error("A DOM document is required to composite the wallpaper image.");
      error.code = "CANVAS_UNSUPPORTED";
      throw error;
    }

    const img = await loadImageElement({ doc, win, src: sourceObjectUrl });

    await ensureFontReady({
      doc,
      fontSpecs: [`400 48px ${fontFamily}`, `700 48px ${fontFamily}`]
    });

    const canvas = doc.createElement("canvas");
    // Canvas pixel size MUST exactly match the source image's own native
    // dimensions \u2014 never multiplied by devicePixelRatio.
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!ctx) {
      const error = new Error("2D canvas rendering context is not supported in this environment.");
      error.code = "CANVAS_UNSUPPORTED";
      throw error;
    }

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawTextSafeZone(ctx, canvas, { oneLiner, createdAt, brandText, fontFamily });

    const blob = await new Promise((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/png");
    });

    if (!blob) {
      const error = new Error("Canvas failed to encode the composited image (toBlob returned null).");
      error.code = "BLOB_ENCODE_FAILED";
      throw error;
    }

    const UrlApi = (win && win.URL) || (typeof URL !== "undefined" ? URL : null);
    if (!UrlApi || typeof UrlApi.createObjectURL !== "function") {
      const error = new Error("URL.createObjectURL is not available in this environment.");
      error.code = "BLOB_ENCODE_FAILED";
      throw error;
    }

    return {
      blob,
      previewUrl: UrlApi.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height
    };
  }

  const wallpaperCanvasComposerApi = {
    DEFAULT_BRAND_TEXT,
    DEFAULT_FONT_FAMILY,
    sanitizeOneLiner,
    formatTaipeiDateFromIso,
    buildFooterMetaLine,
    wrapTextByMeasurement,
    createObjectUrlTracker,
    composeWallpaperImage
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = wallpaperCanvasComposerApi;
  }

  if (typeof window !== "undefined") {
    window.WallpaperCanvasComposer = wallpaperCanvasComposerApi;
  }
})();
