/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "output", "provider-adapter-wallpaper.png");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return String(value).trim();
}

function toNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number env: ${name}`);
  }
  return n;
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
  const image = response?.image || {};
  const base64 = image?.base64 || response?.imageBase64;
  if (!base64) return null;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, Buffer.from(base64, "base64"));
  return OUTPUT_PATH;
}

function printSafeSummary(response, correlationId, outputPath) {
  const mimeType = response?.image?.mimeType || "image/png";
  console.log(
    JSON.stringify(
      {
        provider: response?.provider,
        model: response?.model,
        durationMs: response?.durationMs,
        mimeType,
        outputPath: outputPath || response?.imageUrl || null,
        correlationId,
      },
      null,
      2
    )
  );
}

async function findModuleFile() {
  const override = process.env.TEST_REAL_PROVIDER_MODULE;
  if (override) {
    const abs = path.isAbsolute(override) ? override : path.resolve(ROOT, override);
    if (!fs.existsSync(abs)) throw new Error(`找不到 TEST_REAL_PROVIDER_MODULE：${abs}`);
    return abs;
  }

  const candidates = [];
  const searchDirs = [path.join(ROOT, "js"), path.join(ROOT, "src")];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const walk = (currentDir) => {
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          walk(full);
          continue;
        }
        if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue;
        const n = full.replace(/\\/g, "/").toLowerCase();
        if (n.includes("provider") && (n.includes("gemini") || n.includes("adapter"))) {
          candidates.push(full);
        }
      }
    };
    walk(dir);
  }

  if (candidates.length === 0) {
    throw new Error("找不到 provider 模組。請設定 TEST_REAL_PROVIDER_MODULE。");
  }
  return candidates[0];
}

async function loadModule(file) {
  return import(pathToFileURL(file).href);
}

function pickExport(mod, names) {
  for (const name of names) {
    if (typeof mod?.[name] === "function") return mod[name];
  }
  return null;
}

async function createProvider(mod, deps) {
  const factory = pickExport(mod, [
    "createImageProviderAdapter",
    "createProviderFactory",
    "createProvider",
  ]);

  if (factory) {
    try {
      const provider = await factory(deps);
      if (provider && typeof provider.generateImage === "function") return provider;
    } catch (_) { /* ignore and try next */ }
  }

  const Adapter = pickExport(mod, ["GeminiProviderAdapter"]);
  if (Adapter) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const client = new GoogleGenAI({ apiKey: deps.config.apiKey });
      const provider = new Adapter(deps.config, client, deps.logger);
      if (provider && typeof provider.generateImage === "function") return provider;
    } catch (_) { /* ignore and try next */ }
  }

  throw new Error("無法透過現有 provider factory / adapter 建立 Gemini provider。");
}

async function main() {
  const correlationId = `real-provider-${Date.now()}`;
  const apiKey = requiredEnv("GEMINI_API_KEY");
  const model = requiredEnv("GEMINI_MODEL");
  const timeoutMs = toNumber(requiredEnv("GEMINI_TIMEOUT"), "GEMINI_TIMEOUT");
  const maxRetry = toNumber(requiredEnv("GEMINI_MAX_RETRY"), "GEMINI_MAX_RETRY");
  const imageSize = requiredEnv("IMAGE_SIZE");
  const safetyLevel = requiredEnv("SAFETY_LEVEL");

  const renderedPrompt = `Create a vertical 9:16 mobile wallpaper. Main character: A warm, cute lucky bear mascot. Accessory: A small lucky table-tennis guardian charm. Style: Refined retro Japanese collectible-card illustration, warm sunlight, soft texture, premium composition, clean background, no logos, no copyrighted characters. Include a small tasteful date watermark: 2026-07-16. Do not include additional text.`;

  const moduleFile = await findModuleFile();
  const mod = await loadModule(moduleFile);

  const provider = await createProvider(mod, {
    logger: { info: () => {}, error: () => {} }, // Suppress logs for this script
    config: {
      provider: "gemini",
      apiKey,
      model,
      timeoutMs,
      maxRetry,
      imageSize,
      safetyLevel,
      debugRawResponse: false,
    },
  });

  const response = await provider.generateImage({
    renderedPrompt,
    correlationId,
  });

  if (!response || typeof response !== "object") throw new Error("normalized response 無效");
  if (!response.provider) throw new Error("normalized response 缺少 provider");
  if (!response.model) throw new Error("normalized response 缺少 model");
  if (typeof response.durationMs !== "number") throw new Error("normalized response 缺少 durationMs");
  if (!response.image) throw new Error("normalized response 缺少 image");

  const outputPath = writeImageIfNeeded(response);
  printSafeSummary(response, correlationId, outputPath);
}

main().catch((err) => {
  const correlationId = `real-provider-error-${Date.now()}`;
  console.error(JSON.stringify(normalizeError(err, correlationId), null, 2));
  process.exitCode = 1;
});