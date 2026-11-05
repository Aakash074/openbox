import type { VisionInput, VisionProvider, VisionReading } from "./types";

/**
 * Offline stand-in. Real frames can't be read without a model, so the kiosk's mock mode (and e2e tests) embed a
 * scenario in the "image": base64 of `MOCK:{"serial":"SN-...","damage":"none","item":"phone"}`.
 * Anything else reads as "no serial visible".
 */
export const mockProvider: VisionProvider = {
  name: "mock",
  async inspect(i: VisionInput): Promise<VisionReading> {
    let s: { serial?: string; damage?: "none" | "minor" | "major"; item?: string } = {};
    try {
      const txt = Buffer.from(i.imageB64, "base64").toString("utf8");
      if (txt.startsWith("MOCK:")) s = JSON.parse(txt.slice(5));
    } catch { /* not a mock frame */ }
    return {
      serialRead: s.serial ?? "",
      labelText: s.serial ? `S/N ${s.serial}` : "",
      itemDescription: s.item ?? (s.serial ? "device box" : "unidentified object"),
      itemVisible: !!s.serial,
      damage: s.damage ?? "none",
      damageNotes: s.damage && s.damage !== "none" ? "simulated damage" : "",
      confidence: s.serial ? 0.99 : 0.9,
    };
  },
};
