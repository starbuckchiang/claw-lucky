"use strict";

/**
 * Prompt Snapshot.
 *
 * Responsibility (AI Constitution Principle 9: "Version Everything" +
 * Observability): captures exactly what was sent to the image provider,
 * and which context/builder version produced it, so a later "why did it
 * draw a fox today?" question can be answered directly from the persisted
 * `wallpaper_generations.metadata_json` row instead of needing to
 * reconstruct/guess. Reuses the EXISTING `metadata_json` column — no new
 * table or storage mechanism introduced.
 *
 * @param {object} params
 * @param {{promptText:string, builderVersion:string}} params.promptResult
 * @param {string} params.contextVersion
 * @returns {{ promptSnapshot: string, contextVersion: string, builderVersion: string }}
 */
function buildPromptSnapshot({ promptResult, contextVersion }) {
  return {
    promptSnapshot: String(promptResult?.promptText || ""),
    contextVersion: String(contextVersion || ""),
    builderVersion: String(promptResult?.builderVersion || "")
  };
}

module.exports = {
  buildPromptSnapshot
};
