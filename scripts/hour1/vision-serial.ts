/**
 * Gate 5: does the vision model read a serial sticker from a webcam still under venue lighting?
 * Usage: VISION_PROVIDER=anthropic pnpm tsx scripts/hour1/vision-serial.ts photo.jpg [expected-serial]
 * Runs every provider listed in VISION_PROVIDERS (default: the configured one).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { normalizeSerial } from "@openbox/shared";
import { visionProvider } from "../../services/inspector/src/vision";

const [file, expected] = process.argv.slice(2);
if (!file) throw new Error("usage: vision-serial.ts <image> [expected-serial]");
const imageB64 = readFileSync(file).toString("base64");
const mediaType = file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
for (const name of (process.env.VISION_PROVIDERS ?? process.env.VISION_PROVIDER ?? "mock").split(",")) {
  const p = visionProvider(name.trim());
  const t = Date.now();
  try {
    const r = await p.inspect({ imageB64, mediaType, mode: "delivery", expectedItem: "an electronic device" });
    const hit = expected ? normalizeSerial(r.serialRead) === normalizeSerial(expected) : undefined;
    console.log(`${p.name} (${Date.now() - t}ms): serial="${r.serialRead}" damage=${r.damage} conf=${r.confidence}${hit === undefined ? "" : hit ? "  ✔ MATCH" : "  ✘ no match"}`);
  } catch (e) {
    console.log(`${p.name}: error ${(e as Error).message}`);
  }
}
