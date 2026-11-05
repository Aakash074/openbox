/** Hand-written JSON Schema mirroring VisionReading (for providers that take raw JSON Schema). */
export function zodToJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["serialRead", "labelText", "itemDescription", "itemVisible", "damage", "damageNotes", "confidence"],
    properties: {
      serialRead: { type: "string" },
      labelText: { type: "string" },
      itemDescription: { type: "string" },
      itemVisible: { type: "boolean" },
      damage: { type: "string", enum: ["none", "minor", "major"] },
      damageNotes: { type: "string" },
      confidence: { type: "number" },
    },
  };
}
