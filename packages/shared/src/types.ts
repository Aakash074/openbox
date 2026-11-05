import { z } from "zod";

export enum OrderStatus {
  None = 0,
  Paid = 1,
  Dispatched = 2,
  HandedOver = 3,
  Settled = 4,
  Returned = 5,
  Cancelled = 6,
}

export enum Outcome {
  None = 0,
  Match = 1,
  Mismatch = 2,
  Damaged = 3,
  Timeout = 4,
}

export enum PayMethod {
  Approve = 0,
  Permit = 1,
  Authorization = 2,
}

export const outcomeLabel: Record<Outcome, string> = {
  [Outcome.None]: "—",
  [Outcome.Match]: "match",
  [Outcome.Mismatch]: "mismatch",
  [Outcome.Damaged]: "damaged",
  [Outcome.Timeout]: "timeout",
};

export type GaslessMode = "permit" | "eip3009" | "account";

/** Webhook event names delivered to merchants (HMAC-SHA256 signed, header X-OpenBox-Signature). */
export const WEBHOOK_EVENTS = [
  "order.paid",
  "order.dispatched",
  "order.return_to_sender",
  "order.handed_over",
  "courier.paid",
  "order.settled",
  "seller.paid",
  "buyer.refunded",
  "order.timeout_released",
  "order.return_refunded",
  "order.cancelled",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const HexBytes = z.string().regex(/^0x[0-9a-fA-F]*$/);

export const InspectionResult = z.object({
  orderId: Hex32,
  mode: z.enum(["delivery", "return"]),
  outcome: z.enum(["match", "mismatch", "damaged"]),
  serialRead: z.string(),
  damage: z.enum(["none", "minor", "major"]),
  refundBps: z.number().int().min(0).max(10_000),
  confidence: z.number().min(0).max(1),
  frameHash: Hex32,
  hcs: z.object({ topicId: z.string(), sequence: z.string(), txId: z.string().optional() }),
  verdict: z.record(z.any()),
  signature: HexBytes,
  inspector: Addr,
  provider: z.string(),
  notes: z.string().optional(),
});
export type InspectionResult = z.infer<typeof InspectionResult>;
