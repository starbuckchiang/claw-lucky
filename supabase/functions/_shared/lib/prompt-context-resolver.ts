// ESM port of `js/services/prompt/prompt-context-resolver.js`. Logic
// unchanged. See that file for the full rationale (P2-AI-03: mascot/gift
// are now queried ONCE by Generation Service and shared with both the
// Shopkeeper Context Agent and this Resolver; the Resolver's only
// remaining I/O responsibility is the Asia/Taipei date).

import type { MascotDto } from "./mascot-repository.ts";
import type { GiftDto } from "./gift-repository.ts";

export const CONTEXT_VERSION = "wallpaper-prompt-context-v1";

export interface WallpaperPromptInput {
  mascot: MascotDto | null;
  gift: GiftDto | null;
  wallpaperStyle: string;
  luckyTheme: string;
  blessing: string;
  date: string;
  contextVersion: string;
}

/**
 * Deterministically formats a Date as "YYYY.MM.DD" in the Asia/Taipei
 * timezone (UTC+8, no DST). NEVER uses UTC and NEVER hardcodes a date —
 * always derived from the injected `now` Date.
 */
export function resolveTaipeiDate(now: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(now);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    lookup[part.type] = part.value;
  }

  return `${lookup.year}.${lookup.month}.${lookup.day}`;
}

export function createPromptContextResolver({
  now = () => new Date()
}: {
  now?: () => Date;
} = {}) {
  /**
   * @param request.mascot Already-resolved mascot DTO (queried ONCE by Generation Service).
   * @param request.gift Already-resolved gift DTO (queried ONCE by Generation Service).
   */
  async function resolve(
    request: {
      mascot?: MascotDto | null;
      gift?: GiftDto | null;
      wallpaperStyle?: string;
      luckyTheme?: string;
      blessing?: string;
    }
  ): Promise<WallpaperPromptInput> {
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
