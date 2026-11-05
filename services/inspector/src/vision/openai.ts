import OpenAI from "openai";
import { zodToJsonSchema } from "./schema";
import { PROMPT, VisionReading, type VisionInput, type VisionProvider } from "./types";

export function openaiProvider(model = process.env.VISION_MODEL ?? "gpt-4.1-mini"): VisionProvider {
  const client = new OpenAI();
  return {
    name: `openai:${model}`,
    async inspect(i: VisionInput) {
      const res = await client.chat.completions.create({
        model,
        response_format: { type: "json_schema", json_schema: { name: "vision_reading", strict: true, schema: zodToJsonSchema() } },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: PROMPT(i) },
            { type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.imageB64}` } },
          ],
        }],
      });
      return VisionReading.parse(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
    },
  };
}
