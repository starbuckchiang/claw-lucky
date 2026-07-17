/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
// Directly import the factory, removing all dynamic discovery logic.
import { createProvider } from "../js/services/ai/provider-factory.js";

const ROOT = path.resolve(path.dirname(import.meta.url), "..").replace("file:///", "");
const OUTPUT_PATH = path.join(ROOT, "output", "provider-adapter-wallpaper.png");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return String(value).trim();
}

function normalizeError(err, correlationId) {
  return {
    failureCode: err?.code || err?.name || "PROVIDER_UNKNOWN",
    failureMessage: err?.message || "Provider call failed",
    retryable: typeof err?.retryable === "boolean" ? err.retryable : false,
    correlationId,
  };
}

function writeImageIfNeeded(response) {
  const base64 = response?.image?.base64;
  if (!base64) return null;
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, Buffer.from(base64, "base64"));
  return OUTPUT_PATH;
}

function printSafeSummary(response, correlationId, outputPath) {
  console.log(
    JSON.stringify(
      {
        provider: response?.provider,
        model: response?.model,
        durationMs: response?.durationMs,
        mimeType: response?.image?.mimeType,
        correlationId,
        outputPath: outputPath || null,
      },
      null,
      2
    )
  );
}

async function main() {
  const correlationId = `real-gemini-test-${Date.now()}`;
  
  // Ensure all required env vars are set
  requiredEnv("GEMINI_API_KEY");
  requiredEnv("AI_PROVIDER_MODEL");
  requiredEnv("AI_PROVIDER_TIMEOUT_MS");
  requiredEnv("AI_PROVIDER_MAX_RETRY");
  requiredEnv("AI_PROVIDER_IMAGE_SIZE");
  requiredEnv("AI_PROVIDER_SAFETY_LEVEL");

  const logger = { info: console.log, error: console.error };

  console.log("Creating provider via factory...");
  // Use the factory to create the provider. The factory handles config loading.
  const provider = createProvider(logger);

  const renderedPrompt = `Create a vertical 9:16 mobile wallpaper. Main character: A warm, cute lucky bear mascot. Accessory: A small lucky table-tennis guardian charm. Style: Refined retro Japanese collectible-card illustration, warm sunlight, soft texture, premium composition, clean background, no logos, no copyrighted characters. Include a small tasteful date watermark: 2026-07-16. Do not include additional text.`;

  console.log(`Calling provider method 'generateWallpaper'...`);
  const response = await provider.generateWallpaper({
    renderedPrompt,
    correlationId,
  });

  const outputPath = writeImageIfNeeded(response);
  console.log("\n--- Real Provider Test Successful ---");
  printSafeSummary(response, correlationId, outputPath);
}

main().catch((err) => {
  const correlationId = `real-gemini-error-${Date.now()}`;
  console.error("\n--- Real Provider Test Failed ---");
  console.error(JSON.stringify(normalizeError(err, correlationId), null, 2));
  process.exitCode = 1;
});