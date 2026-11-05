import { z } from "zod/v4";

/** What every vision provider must return. Kept small and checkable. */
export const VisionReading = z.object({
  serialRead: z.string().describe("Serial number exactly as printed on the item's label/sticker; empty string if none is visible"),
  labelText: z.string().describe("Other legible text on the label or packaging"),
  itemDescription: z.string().describe("Short description of the object shown"),
  itemVisible: z.boolean().describe("True if the ordered kind of item is actually present in the frame"),
  damage: z.enum(["none", "minor", "major"]).describe("Visible physical damage: cracks, dents, crushed packaging"),
  damageNotes: z.string(),
  confidence: z.number().describe("0..1 confidence in the serial reading"),
});
export type VisionReading = z.infer<typeof VisionReading>;

export type VisionInput = { imageB64: string; mediaType: "image/jpeg" | "image/png"; expectedItem?: string; mode: "delivery" | "return" };

export interface VisionProvider {
  readonly name: string;
  inspect(input: VisionInput): Promise<VisionReading>;
}

/**
 * The model is deliberately NOT told the expected serial: it reports what it sees, and the inspector compares
 * hashes against the serial the seller committed on-chain. That keeps the verdict neutral.
 */
export const PROMPT = (i: VisionInput) => `You are a neutral parcel inspector at a customer's door. A buyer just opened a delivery on camera${
  i.mode === "return" ? " (this is a RETURN being received back by the seller)" : ""
}.
The order says the parcel should contain: ${i.expectedItem ?? "an electronic device"}.
Look at the photo and report:
- serialRead: the serial number printed on the item's serial sticker or label (often prefixed "SN" or "S/N"). Copy it exactly. If no serial is visible, return an empty string. Never guess or invent one.
- itemVisible: whether the ordered kind of item is actually in the frame (a bar of soap, a brick or an empty box is NOT the item).
- damage: "none", "minor" (scuffs, small dents, crushed corner) or "major" (cracked screen, broken casing, item unusable).
Be literal and conservative.`;
