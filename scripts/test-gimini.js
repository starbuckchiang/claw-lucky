import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  const result = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: "Say hello",
  });

  console.log(result.text);
}

main();