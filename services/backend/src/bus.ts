import { EventEmitter } from "node:events";

/** In-process event bus feeding the SSE stream (UIs) and webhook dispatcher. */
export type BusEvent = { type: string; ref?: string; orderId?: string; at: number; data?: Record<string, unknown> };
export const bus = new EventEmitter();
bus.setMaxListeners(200);
export function publish(type: string, payload: Omit<BusEvent, "type" | "at"> = {}) {
  const e: BusEvent = { type, at: Date.now(), ...payload };
  bus.emit("event", e);
  return e;
}
