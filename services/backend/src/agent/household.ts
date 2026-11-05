import type { Hex } from "viem";
import { hashscanTx, InspectionResult } from "@openbox/shared";
import { cfg } from "../config";
import { checkout, publicClient, readOrder, txUrl } from "../chain";
import { db, getOrderByRef, now, today, updateOrder, type OrderRow } from "../db";
import { publish } from "../bus";
import { relay } from "../relayer";
import { indexNow } from "../indexer";
import { paidFetch, PolicyRefusal } from "./x402";
import { checkSpend } from "./policy";
import { openTopics, readDirectory, topicsFromEnv, type InspectorEntry } from "@openbox/hedera";

/**
 * The household AI agent that lives in the doorbell. With no human approving it:
 *  - releases the courier fee once the backend has validated a fresh World check (submits `handover`)
 *  - discovers inspection services from the HCS "inspectors" directory (Mirror Node), compares prices, refuses
 *    any over budget, pays the cheapest allowed one per call over x402 (HTS USDC), logs every payment/refusal to
 *    the HCS "log" topic, and submits the signed verdict to Whitechain (`settle` / `returnRefund`)
 *  - keeps the timeout promise: auto-releases to the seller when no inspection happens in the window
 * All on-chain submissions go through the merchant relayer, so nobody in the household needs WBT.
 */

const agentOperator = cfg.agent.hederaAccountId && cfg.agent.hederaPrivateKey
  ? { accountId: cfg.agent.hederaAccountId, privateKey: cfg.agent.hederaPrivateKey }
  : undefined;
export const topics = openTopics(topicsFromEnv(cfg.root, agentOperator));

async function hcsLog(entry: Record<string, unknown>) {
  try {
    const r = await topics.log.submit({ v: 1, at: new Date().toISOString(), ...entry });
    return r;
  } catch (e) {
    console.error("[agent] HCS log write failed:", (e as Error).message);
  }
}

export type Candidate = InspectorEntry & { sequence: number; allowed: boolean; reason: string };

/**
 * Discover inspectors from the HCS directory (no hard-coded URLs). Each entry is signature-checked, its key must be
 * registered on DeliveryCheckout, it must be on the allowlist (if one is set) and within the spending policy.
 * Returns all candidates with a decision, cheapest allowed first.
 */
export async function discoverInspectors(orderId?: Hex): Promise<Candidate[]> {
  const entries = await readDirectory(topics.inspectors, cfg.chainId);
  const out: Candidate[] = [];
  for (const e of entries) {
    let allowed = true;
    let reason = "ok";
    const onchain = await publicClient.readContract({ ...checkout, functionName: "isInspector", args: [e.evmAddress] }).catch(() => false);
    const allow = cfg.agent.allowlist.map((a) => a.toLowerCase());
    if (!onchain) { allowed = false; reason = "verdict key not registered on DeliveryCheckout"; }
    else if (allow.length && !allow.includes(e.evmAddress.toLowerCase()) && !allow.includes(e.url.toLowerCase())) { allowed = false; reason = "not on the agent's inspector allowlist"; }
    else {
      const d = checkSpend([e.url, e.evmAddress], { network: e.network, asset: e.asset, amount: String(Math.round(e.priceUsd * 1e6)), payTo: e.payTo });
      if (!d.ok) { allowed = false; reason = d.reason; }
    }
    out.push({ ...e, allowed, reason });
  }
  out.sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.priceUsd - b.priceUsd);
  // Refusals are part of the audit trail.
  for (const c of out.filter((c) => !c.allowed && orderId)) {
    void hcsLog({ type: "agent.refusal", orderId, inspector: c.evmAddress, url: c.url, priceUsd: c.priceUsd, reason: c.reason });
  }
  return out;
}

export async function submitDispatch(
  ref: string,
  d: { orderId: Hex; courierHash: Hex; payout: Hex; deadline: bigint },
  sig: Hex,
) {
  const { hash } = await relay({ target: "checkout", functionName: "dispatch", args: [d, sig] });
  updateOrder(ref, { dispatch_tx: hash });
  await indexNow();
  return hash;
}

// ---- handover ----------------------------------------------------------------

export async function submitHandover(
  ref: string,
  att: { orderId: Hex; courierHash: Hex; labelHash: Hex; deadline: bigint },
  attSig: Hex,
) {
  const o = getOrderByRef(ref);
  if (!o?.label_json || !o.label_sig) throw new Error("order not packed");
  const l = JSON.parse(o.label_json);
  const label = { orderId: l.orderId, serialHash: l.serialHash, courierHash: l.courierHash, labelNonce: BigInt(l.labelNonce) };
  publish("agent.action", { ref, data: { action: "handover", note: "Household agent recording the verified handover" } });
  const { hash } = await relay({ target: "checkout", functionName: "handover", args: [label, o.label_sig, att, attSig] });
  await indexNow();
  return hash;
}

// ---- inspection ----------------------------------------------------------------

const lastFrames = new Map<string, string>();

export function lastFrame(ref: string) {
  return lastFrames.get(ref);
}

type VerdictJson = Record<string, string | number>;

const toVerdict = (v: VerdictJson) => ({
  orderId: v.orderId as Hex,
  outcome: Number(v.outcome),
  refundBps: Number(v.refundBps),
  serialReadHash: v.serialReadHash as Hex,
  frameHash: v.frameHash as Hex,
  hcsSeq: BigInt(v.hcsSeq),
  deadline: BigInt(v.deadline),
});
const toReturnVerdict = (v: VerdictJson) => ({
  orderId: v.orderId as Hex,
  returnedSerialHash: v.returnedSerialHash as Hex,
  frameHash: v.frameHash as Hex,
  hcsSeq: BigInt(v.hcsSeq),
  deadline: BigInt(v.deadline),
});

export async function inspect(ref: string, frameB64: string | undefined, mode: "delivery" | "return") {
  const o = getOrderByRef(ref);
  if (!o) throw new Error("unknown order");
  if (mode === "delivery" && o.status !== "handed_over") throw new Error(`order is ${o.status}, not awaiting inspection`);
  if (mode === "return" && o.status !== "settled") throw new Error(`order is ${o.status}, not returnable`);
  const frame = frameB64 ?? lastFrames.get(ref);
  if (!frame) throw new Error("no frame captured");
  lastFrames.set(ref, frame);

  publish("agent.action", { ref, data: { action: "discover", note: "Reading the HCS inspector directory" } });
  const candidates = await discoverInspectors(o.order_id);
  publish("agent.candidates", {
    ref,
    data: { candidates: candidates.map((c) => ({ name: c.name, url: c.url, priceUsd: c.priceUsd, allowed: c.allowed, reason: c.reason, address: c.evmAddress })) },
  });
  const pick = candidates.find((c) => c.allowed);
  if (!pick) throw new Error(`No inspector within policy (${candidates.map((c) => `${c.name}: ${c.reason}`).join("; ") || "directory empty"})`);
  const insp = { base: pick.url.replace(/\/$/, ""), inspector: pick.evmAddress, name: pick.name, priceUsd: pick.priceUsd };
  publish("agent.action", {
    ref,
    data: { action: "pay", note: `Paying ${insp.name} ($${insp.priceUsd}, cheapest within budget) over x402 on Hedera`, inspector: insp.base, priceUsd: insp.priceUsd },
  });

  let paid;
  try {
    paid = await paidFetch(
      `${insp.base}/inspect`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: o.order_id, ref, mode, frame, expectedItem: o.product }),
      },
      { inspectorBase: insp.base, inspectorAddress: insp.inspector },
    );
  } catch (e) {
    if (e instanceof PolicyRefusal) {
      db.prepare("INSERT INTO agent_payments (day, ts, order_ref, inspector, amount_usd, status, detail) VALUES (?,?,?,?,?,?,?)")
        .run(today(), now(), ref, insp.base, e.decision.amountUsd, "refused", e.decision.reason);
      publish("agent.refused", { ref, data: { reason: e.decision.reason } });
      void hcsLog({ type: "agent.refusal", orderId: o.order_id, inspector: insp.inspector, url: insp.base, priceUsd: e.decision.amountUsd, reason: e.decision.reason });
    }
    throw e;
  }
  const body = await paid.res.json().catch(() => ({}));
  if (!paid.res.ok) {
    db.prepare("INSERT INTO agent_payments (day, ts, order_ref, inspector, amount_usd, status, detail) VALUES (?,?,?,?,?,?,?)")
      .run(today(), now(), ref, insp.base, paid.spend.amountUsd, "failed", JSON.stringify(body).slice(0, 500));
    throw new Error(`Inspection failed: HTTP ${paid.res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  const result = InspectionResult.parse(body);
  const hederaTx = paid.settlement?.transaction;
  if (result.inspector.toLowerCase() !== insp.inspector.toLowerCase()) throw new Error("verdict signed by a different key than the directory entry");
  const logged = await hcsLog({ type: "agent.payment", orderId: o.order_id, inspector: insp.inspector, url: insp.base, amountUsd: paid.spend.amountUsd, hederaTx });
  db.prepare("INSERT INTO agent_payments (day, ts, order_ref, inspector, amount_usd, hedera_tx, network, status, detail) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(today(), now(), ref, insp.base, paid.spend.amountUsd, hederaTx ?? null, paid.settlement?.network ?? cfg.agent.hederaNetwork, "settled", result.outcome);

  const record = {
    ...result,
    inspectorName: insp.name,
    candidates: candidates.map((c) => ({ name: c.name, priceUsd: c.priceUsd, allowed: c.allowed, reason: c.reason })),
    paymentLog: logged ? { topicId: topics.log.id, sequence: logged.sequence, txId: logged.txId } : undefined,
    payment: {
      hederaTx,
      hashscan: hederaTx && cfg.agent.hederaMode === "live" ? hashscanTx(hederaTx) : undefined,
      amountUsd: paid.spend.amountUsd,
      mock: cfg.agent.hederaMode !== "live",
    },
    at: now(),
  };
  updateOrder(ref, { last_inspection_json: JSON.stringify(record) });
  publish("inspection.result", { ref, data: record as unknown as Record<string, unknown> });

  if (mode === "return") {
    if (result.outcome !== "match") {
      publish("return.rejected", { ref, data: { reason: "Returned serial does not match the one packed. No refund." } });
      return { result: record, action: "return_rejected" as const };
    }
    const { hash } = await relay({ target: "checkout", functionName: "returnRefund", args: [toReturnVerdict(result.verdict as VerdictJson), result.signature as Hex] });
    await indexNow();
    return { result: record, action: "return_refunded" as const, txHash: hash, explorerUrl: txUrl(hash) };
  }

  if (result.outcome === "damaged") {
    // Partial refund is one tap for the buyer; the signed verdict waits until then (or the window passes).
    updateOrder(ref, { pending_verdict_json: JSON.stringify({ verdict: result.verdict, signature: result.signature }) });
    publish("inspection.awaiting_buyer", { ref, data: { refundBps: result.refundBps } });
    return { result: record, action: "awaiting_buyer" as const };
  }
  const hash = await submitSettle(o, result.verdict as VerdictJson, result.signature as Hex);
  return { result: record, action: "settled" as const, txHash: hash, explorerUrl: txUrl(hash) };
}

async function submitSettle(o: OrderRow, verdict: VerdictJson, sig: Hex) {
  publish("agent.action", { ref: o.ref, data: { action: "settle", note: "Submitting signed verdict to Whitechain" } });
  const { hash } = await relay({ target: "checkout", functionName: "settle", args: [toVerdict(verdict), sig] });
  await indexNow();
  return hash;
}

/** Buyer's one tap on a damaged verdict. */
export async function acceptPartialRefund(ref: string) {
  const o = getOrderByRef(ref);
  if (!o?.pending_verdict_json) throw new Error("no pending damaged verdict");
  const { verdict, signature } = JSON.parse(o.pending_verdict_json);
  const hash = await submitSettle(o, verdict, signature);
  return { txHash: hash, explorerUrl: txUrl(hash) };
}

// ---- timeout keeper ----------------------------------------------------------------

export function startKeeper(intervalMs = 5000) {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const rows = db.prepare("SELECT ref, order_id FROM orders WHERE status = 'handed_over'").all() as { ref: string; order_id: Hex }[];
      const block = await publicClient.getBlock();
      // Local chains only mint blocks on demand, so use whichever clock is ahead.
      const t = BigInt(Math.max(Number(block.timestamp), now()));
      for (const r of rows) {
        const on = await readOrder(r.order_id);
        if (Number(on.status) !== 3) continue; // HandedOver
        if (t <= on.handoverAt + on.inspectionWindow) continue;
        publish("agent.action", { ref: r.ref, data: { action: "timeout", note: "Inspection window passed: releasing to seller" } });
        await relay({ target: "checkout", functionName: "timeoutRelease", args: [r.order_id] }).catch((e) =>
          console.error("[keeper]", r.ref, (e as Error).message),
        );
      }
      if (rows.length) await indexNow();
    } catch (e) {
      console.error("[keeper]", (e as Error).message);
    } finally {
      busy = false;
    }
  }, intervalMs);
}
