import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-image";

if (!apiKey) {
  throw new Error("找不到 GEMINI_API_KEY，請確認 .env 已設定。");
}

const ai = new GoogleGenAI({ apiKey });

const prompt = `
Create a vertical 9:16 mobile wallpaper.

Main character:
A warm, cute lucky bear mascot.

Accessory:
A small lucky table-tennis guardian charm.

Style:
Refined retro Japanese collectible-card illustration,
warm sunlight, soft texture, premium composition,
clean background, no logos, no copyrighted characters.

Include a small tasteful date watermark: 2026-07-16.
Do not include additional text.
`;

async function main() {
  console.log(`Testing model: ${model}`);

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseFormat: {
        image: {
          aspectRatio: "9:16",
        },
      },
    },
  });

  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part) => part.inlineData?.data);

  if (!imagePart) {
    const returnedText = parts
      .filter((part) => part.text)
      .map((part) => part.text)
      .join("\n");

    throw new Error(
      `Gemini 沒有回傳圖片。文字回應：${returnedText || "(無)"}`
    );
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const extension = mimeType.includes("jpeg") ? "jpg" : "png";

  const outputDir = path.resolve("output");
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(
    outputDir,
    `gemini-lucky-wallpaper.${extension}`
  );

  fs.writeFileSync(
    outputPath,
    Buffer.from(imagePart.inlineData.data, "base64")
  );

  console.log(`Image generated successfully: ${outputPath}`);
}

main().catch((error) => {
  console.error("Gemini image test failed:");
  console.error(error?.message || error);
  process.exitCode = 1;
});