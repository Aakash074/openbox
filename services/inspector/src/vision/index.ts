import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { mockProvider } from "./mock";
import { openaiProvider } from "./openai";
import type { VisionProvider } from "./types";

/** Provider is chosen per request from env, so it can be switched at any time without code changes. */
export function visionProvider(name = process.env.VISION_PROVIDER ?? "mock"): VisionProvider {
  switch (name) {
    case "anthropic": case "claude": return anthropicProvider();
    case "openai": return openaiProvider();
    case "gemini": case "google": return geminiProvider();
    case "mock": return mockProvider;
    default: throw new Error(`unknown VISION_PROVIDER ${name}`);
  }
}
export * from "./types";
