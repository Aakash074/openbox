import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "./schema";
import { PROMPT, VisionReading, type VisionInput, type VisionProvider } from "./types";

export function geminiProvider(model = process.env.VISION_MODEL ?? "gemini-2.5-flash"): VisionProvider {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return {
    name: `gemini:${model}`,
    async inspect(i: VisionInput) {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: i.mediaType, data: i.imageB64 } }, { text: PROMPT(i) }] }],
        config: { responseMimeType: "application/json", responseJsonSchema: zodToJsonSchema() },
      });
      return VisionReading.parse(JSON.parse(res.text ?? "{}"));
    },
  };
}
