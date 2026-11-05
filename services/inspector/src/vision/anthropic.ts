import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PROMPT, VisionReading, type VisionInput, type VisionProvider } from "./types";

export function anthropicProvider(model = process.env.VISION_MODEL ?? "claude-opus-5-5"): VisionProvider {
  const client = new Anthropic();
  const effort = (process.env.VISION_EFFORT ?? "low") as "low" | "medium" | "high";
  return {
    name: `anthropic:${model}`,
    async inspect(i: VisionInput) {
      // Server-side refusal fallback: if the model declines, the API re-runs on a fallback model in the same call.
      const res = await client.beta.messages.parse({
        model,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        max_tokens: 4000,
        output_config: { effort, format: zodOutputFormat(VisionReading) },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: i.mediaType, data: i.imageB64 } },
            { type: "text", text: PROMPT(i) },
          ],
        }],
      });
      if (res.stop_reason === "refusal") throw new Error(`vision refused: ${res.stop_details?.category ?? "unknown"}`);
      if (!res.parsed_output) throw new Error(`vision returned no structured output (stop_reason=${res.stop_reason})`);
      return res.parsed_output;
    },
  };
}
