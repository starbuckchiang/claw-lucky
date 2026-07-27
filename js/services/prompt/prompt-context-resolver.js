"use strict";

/**
 * Prompt Context Resolver.
 *
 * Responsibility (AI Constitution Principle 5/6/7): assembles the fully
 * structured `WallpaperPromptInput` — the ONLY input shape the (pure,
 * DB-free) Wallpaper Prompt Builder is allowed to consume.
 *
 * P2-AI-03 Product Decision: mascot/gift are now queried EXACTLY ONCE by
 * Generation Service and shared with both the Shopkeeper Context Agent and
 * this Resolver — this Resolver no longer queries the Mascot/Gift
 * repositories itself (it did in P2-AI-02; that responsibility moved up to
 * Generation Service to eliminate the duplicate query). The Resolver's
 * remaining (and only) I/O responsibility is generating the current
 * Asia/Taipei date deterministically.
 *
 * It is intentionally NOT a pure function (it still does the date I/O),
 * which is exactly why the Wallpaper Prompt Builder must never do this
 * work itself.
 *
 * `WallpaperPromptInput` shape:
 * {
 *   mascot: { id, species, title, appearance, colors } | null,
 *   gift: { id, name, description } | null,
 *   wallpaperStyle: string,
 *   luckyTheme: string,
 *   blessing: string,
 *   date: string,           // "YYYY.MM.DD", Asia/Taipei, e.g. "2026.07.21"
 *   contextVersion: string  // versioned per Constitution Principle 9
 * }
 */

const CONTEXT_VERSION = "wallpaper-prompt-context-v1";

/**
 * Deterministically formats a Date as "YYYY.MM.DD" in the Asia/Taipei
 * timezone (UTC+8, no DST). NEVER uses UTC and NEVER hardcodes a date —
 * always derived from the injected `now` Date.
 *
 * @param {Date} now
 * @returns {string}
 */
function resolveTaipeiDate(now) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(now);
  const lookup = {};
  for (const part of parts) {
    lookup[part.type] = part.value;
  }

  return `${lookup.year}.${lookup.month}.${lookup.day}`;
}

function createPromptContextResolver({ now = () => new Date() } = {}) {
  /**
   * @param {object} request
   * @param {{id:string,species:string,title:string,appearance:string,colors:?string}|null} request.mascot
   *   Already-resolved mascot DTO (queried ONCE by Generation Service).
   * @param {{id:string,name:string,description:string}|null} request.gift
   *   Already-resolved gift DTO (queried ONCE by Generation Service).
   */
  async function resolve(request) {
    return {
      mascot: request?.mascot || null,
      gift: request?.gift || null,
      wallpaperStyle: String(request?.wallpaperStyle || "").trim(),
      luckyTheme: String(request?.luckyTheme || "").trim(),
      blessing: String(request?.blessing || "").trim(),
      date: resolveTaipeiDate(now()),
      contextVersion: CONTEXT_VERSION
    };
  }

  return { resolve };
}

module.exports = {
  CONTEXT_VERSION,
  resolveTaipeiDate,
  createPromptContextResolver
};
