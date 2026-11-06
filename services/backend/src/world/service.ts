import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import {
  courierAttestationTypes, courierHash as hashCourier, dispatchAttestationTypes, } from "@openbox/shared";
import { cfg } from "../config";
import { accounts, checkoutDomain } from "../chain";
import { db, getOrderByRef, now, updateOrder } from "../db";
import { publish } from "../bus";
import { agentPassVerifier } from "./agentpass";
import { idkitVerifier } from "./idkit";
import { MOCK_ISS, PERSONAS, mockVerifier } from "./mock";
import type { HumanVerifier } from "./verifier";
import { acceptPartialRefund, submitDispatch, submitHandover } from "../agent/household";
import { signLabel } from "../ops";

/**
 * World ID Agent Pass checks gate two money-relevant moments:
 *  - dispatch: the courier assigned to an order proves who they are; the backend stores the validated World ID
 *    on the order and binds its hash on-chain (`dispatch`).
 *  - handover: at the door, a fresh check must return the SAME ID before the handover is recorded. A different
 *    person (e.g. someone renting the courier's login) gets no attestation, so nothing can be released.
 * All validation happens here; the browser never sees secrets or device codes.
 */
export const verifier: HumanVerifier =
  cfg.world.mode === "idkit" ? idkitVerifier : cfg.world.mode === "agentpass" ? agentPassVerifier : mockVerifier;

/**
 * World ID Agent Pass human checkpoint: before the household agent settles a damaged parcel's partial refund on
 * the buyer's behalf, the household owner approves with a fresh World ID authentication at auth.world.org.
 * The first approval links the owner's (iss, sub) to the buyer wallet; later checkpoints request that subject,
 * so World itself refuses anyone else. Denied, expired or cancelled: the agent does nothing.
 */
export const checkpointVerifier: HumanVerifier = cfg.world.agentPassMode === "agentpass" ? agentPassVerifier : mockVerifier;

export type Purpose = "dispatch" | "handover" | "approve_refund";
export const verifierFor = (purpose: string): HumanVerifier => (purpose === "approve_refund" ? checkpointVerifier : verifier);

db.exec(`CREATE TABLE IF NOT EXISTS household_owners (
  buyer TEXT PRIMARY KEY, iss TEXT NOT NULL, sub TEXT NOT NULL, linked_at INTEGER NOT NULL
)`);
const ownerOf = (buyer?: string | null) =>
  buyer ? (db.prepare("SELECT iss, sub FROM household_owners WHERE buyer = ?").get(buyer.toLowerCase()) as { iss: string; sub: string } | undefined) : undefined;

export type WorldRequestRow = {
  id: string; purpose: Purpose; order_ref: string | null; label_hash: string | null;
  status: string; reason: string | null; device_code: string | null; user_code: string | null;
  verification_uri: string | null; poll_interval: number; started_at: number; expires_at: number;
  courier_hash: string | null; world_sub: string | null; tx_hash: string | null;
  enroll_name: string | null; enroll_payout: string | null; timeline_json: string;
};

const TERMINAL = new Set(["paid", "dispatched", "handed_over", "refunded", "denied", "expired", "cancelled", "failed", "wrong_courier", "wrong_person"]);

export const getRequest = (id: string) =>
  db.prepare("SELECT * FROM world_requests WHERE id = ?").get(id) as WorldRequestRow | undefined;

function setStatus(id: string, status: string, extra: Partial<WorldRequestRow> = {}, note?: string) {
  const row = getRequest(id)!;
  const timeline = JSON.parse(row.timeline_json) as { at: number; status: string; note?: string }[];
  timeline.push({ at: now(), status, note });
  const patch = { ...extra, status, timeline_json: JSON.stringify(timeline) } as Record<string, unknown>;
  const keys = Object.keys(patch);
  db.prepare(`UPDATE world_requests SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
    ...keys.map((k) => patch[k] as string), id,
  );
  publish("world.request", { ref: row.order_ref ?? undefined, data: { id, purpose: row.purpose, status, note, ...extra } });
}

export async function createRequest(
  purpose: Purpose,
  opts: { orderRef: string; labelHash?: Hex; courierName?: string; courierPayout?: Address },
) {
  const id = `wr_${randomUUID().slice(0, 12)}`;
  const t = now();
  db.prepare(
    `INSERT INTO world_requests (id, purpose, order_ref, label_hash, status, started_at, expires_at, enroll_name, enroll_payout, timeline_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, purpose, opts.orderRef, opts.labelHash ?? null, "creating", t, t + cfg.world.requestTtlS,
    opts.courierName ?? null, opts.courierPayout ?? null, JSON.stringify([{ at: t, status: "requested" }]));
  try {
    const order = getOrderByRef(opts.orderRef);
    const sessionId = purpose === "handover" ? order?.courier_world_sub ?? undefined : undefined;
    const sub = purpose === "approve_refund" ? ownerOf(order?.buyer)?.sub : undefined;
    const v = verifierFor(purpose);
    const s = await v.start(id, purpose, { sessionId, sub });
    setStatus(id, "pending", {
      device_code: s.deviceCode ?? null, user_code: s.userCode ?? null, verification_uri: s.verificationUri,
      poll_interval: s.interval, expires_at: t + Math.min(s.expiresIn, cfg.world.requestTtlS),
    }, purpose === "approve_refund"
      ? `Agent paused: household owner must approve with World ID (${v.kind})`
      : `World check requested (${v.kind}, ${purpose})`);
  } catch (e) {
    setStatus(id, "failed", { reason: (e as Error).message }, "Could not start World check");
  }
  return publicView(getRequest(id)!);
}

export function cancelRequest(id: string) {
  const r = getRequest(id);
  if (!r || TERMINAL.has(r.status)) return r && publicView(r);
  setStatus(id, "cancelled", { reason: "cancelled" }, "Cancelled: nothing was paid");
  return publicView(getRequest(id)!);
}

/** What the browser may see: never the device_code. */
export function publicView(r: WorldRequestRow) {
  return {
    id: r.id, purpose: r.purpose, orderRef: r.order_ref, status: r.status, reason: r.reason,
    userCode: r.user_code, verificationUri: r.verification_uri, expiresAt: r.expires_at,
    txHash: r.tx_hash, mode: verifierFor(r.purpose).kind, courierName: r.enroll_name,
    timeline: JSON.parse(r.timeline_json),
  };
}


async function onVerified(r: WorldRequestRow, iss: string, sub: string) {
  const ch = hashCourier(iss, sub);
  const order = getOrderByRef(r.order_ref!);
  if (!order) return setStatus(r.id, "failed", { reason: "unknown order" });

  if (r.purpose === "approve_refund") {
    if (!order.pending_verdict_json) return setStatus(r.id, "failed", { reason: "no partial refund is waiting for approval" });
    // Real IdP: the owner is linked on first approval (trust on first use) and requested by `sub` afterwards.
    // Mock mode: every demo buyer is a fresh wallet, so the mock household owner counts as already linked,
    // which keeps the "someone else approves" denial demonstrable.
    const owner = ownerOf(order.buyer) ??
      (checkpointVerifier.kind === "mock" ? { iss: MOCK_ISS, sub: PERSONAS.owner.sub } : undefined);
    if (owner && (owner.iss !== iss || owner.sub !== sub)) {
      return setStatus(r.id, "wrong_person", { world_sub: sub, reason: "Not the household owner linked to this wallet" },
        "Denied: not the household owner. The agent did nothing.");
    }
    if (!ownerOf(order.buyer) && order.buyer) {
      db.prepare("INSERT INTO household_owners (buyer, iss, sub, linked_at) VALUES (?,?,?,?)").run(order.buyer.toLowerCase(), iss, sub, now());
    }
    setStatus(r.id, "verified", { world_sub: sub }, owner ? "Household owner approved with World ID" : "Household owner approved and linked with World ID");
    try {
      const { txHash } = await acceptPartialRefund(order.ref);
      setStatus(r.id, "refunded", { tx_hash: txHash }, "Agent settled the partial refund on Whitechain");
    } catch (e) {
      setStatus(r.id, "failed", { reason: (e as Error).message }, `Settlement rejected: ${(e as Error).message}`);
    }
    return;
  }

  if (r.purpose === "dispatch") {
    if (order.status !== "packed") return setStatus(r.id, "failed", { reason: `order is ${order.status}, not packed` });
    updateOrder(order.ref, {
      courier_hash: ch, courier_world_sub: sub, courier_name: r.enroll_name, courier_payout: r.enroll_payout as Address,
    });
    setStatus(r.id, "verified", { courier_hash: ch, world_sub: sub }, "Courier verified with World ID");
    const d = { orderId: order.order_id, courierHash: ch, payout: r.enroll_payout as Address, deadline: BigInt(now() + 300) };
    try {
      const sig = await accounts.attester.signTypedData({ domain: checkoutDomain, types: dispatchAttestationTypes, primaryType: "DispatchAttestation", message: d });
      const hash = await submitDispatch(order.ref, d, sig);
      await signLabel(order.ref); // the one-time QR names this courier
      setStatus(r.id, "dispatched", { tx_hash: hash }, "Courier bound to the order on-chain; label printed");
    } catch (e) {
      setStatus(r.id, "failed", { reason: (e as Error).message }, `Dispatch rejected: ${(e as Error).message}`);
    }
    return;
  }

  // handover at the door: must be the same person who was bound at dispatch
  if (!order.courier_hash) return setStatus(r.id, "failed", { reason: "order not dispatched" });
  if (ch.toLowerCase() !== order.courier_hash.toLowerCase()) {
    return setStatus(r.id, "wrong_courier", { courier_hash: ch, world_sub: sub, reason: "Not the courier bound at dispatch" },
      "Denied: not the assigned courier. Nothing was paid.");
  }
  setStatus(r.id, "verified", { courier_hash: ch, world_sub: sub }, "Same courier as at dispatch");
  const c = { orderId: order.order_id, courierHash: ch, labelHash: r.label_hash as Hex, deadline: BigInt(now() + 300) };
  try {
    const sig = await accounts.attester.signTypedData({ domain: checkoutDomain, types: courierAttestationTypes, primaryType: "CourierAttestation", message: c });
    const hash = await submitHandover(order.ref, c, sig);
    setStatus(r.id, "handed_over", { tx_hash: hash }, "Handover recorded. Open the box on camera.");
  } catch (e) {
    setStatus(r.id, "failed", { reason: (e as Error).message }, `Handover rejected on-chain: ${(e as Error).message}`);
  }
}

const lastPoll = new Map<string, number>();

async function pollOnce() {
  const rows = db.prepare("SELECT * FROM world_requests WHERE status = 'pending'").all() as WorldRequestRow[];
  for (const r of rows) {
    if (now() > r.expires_at) { setStatus(r.id, "expired", { reason: "request expired" }, "Expired: nothing was paid"); continue; }
    const last = lastPoll.get(r.id) ?? 0;
    if (Date.now() - last < r.poll_interval * 1000) continue;
    lastPoll.set(r.id, Date.now());
    const res = await verifierFor(r.purpose).poll(r).catch((e) => ({ status: "failed" as const, reason: (e as Error).message }));
    if (res.status === "pending") {
      if (res.slowDown) db.prepare("UPDATE world_requests SET poll_interval = poll_interval + 5 WHERE id = ?").run(r.id);
      continue;
    }
    if (res.status === "verified") {
      setStatus(r.id, "validating", {}, "Proof received, validating on server");
      await onVerified(getRequest(r.id)!, res.iss, res.sub);
    } else {
      setStatus(r.id, res.status, { reason: res.reason },
        r.purpose === "approve_refund" ? `${res.status}: the agent did nothing` : `${res.status}: nothing was paid`);
    }
  }
}

export function startWorldPoller() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await pollOnce(); } catch (e) { console.error("[world]", e); } finally { busy = false; }
  }, 700);
}
