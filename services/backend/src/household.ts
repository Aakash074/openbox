import { cfg } from "./config";
import { db, getOrderByRef, today, type OrderRow } from "./db";
import { orderView } from "./ops";
import { checkpointVerifier, publicView, SIMULATED_SUB, type WorldRequestRow } from "./world/service";

/**
 * Read-only views for the household app (/home): the buyer's side of OpenBox, i.e. the home whose doorbell agent
 * receives parcels, pays inspectors over x402 and asks the owner (World ID Agent Pass) before accepting a refund.
 *
 * Demo simplification: every checkout in the hosted demo uses a fresh random buyer wallet, but all parcels are
 * handed over at the one demo doorbell. So the sample household ("Mehta household · Front door") treats ALL orders
 * on this backend as its deliveries. A multi-household deployment would key these views on the household's wallets.
 *
 * Never returned: World request device codes, World ID subjects/issuers, parcel QR labels.
 */
export const HOUSEHOLD = {
  name: process.env.HOUSEHOLD_NAME ?? "Mehta household",
  door: process.env.HOUSEHOLD_DOOR ?? "Front door",
  owner: process.env.HOUSEHOLD_OWNER ?? "Priya Mehta",
};

/** Is the household owner linked to World ID Agent Pass? (Identifiers stay server-side.) */
export function ownerStatus() {
  const row = db.prepare("SELECT linked_at FROM household_owners ORDER BY linked_at DESC LIMIT 1").get() as { linked_at: number } | undefined;
  const mode = checkpointVerifier.kind;
  return {
    name: HOUSEHOLD.owner,
    // Real Agent Pass: linked on the owner's first approval (trust on first use). Mock checkpoint mode: the demo owner
    // persona counts as linked, so "someone else tries to approve" stays demonstrable.
    linked: !!row || mode === "mock",
    linkedAt: row?.linked_at ?? null,
    via: row ? ("world_id" as const) : mode === "mock" ? ("simulated" as const) : null,
    mode,
    simulatedFallback: cfg.demoMode,
  };
}

/** How an approval was given: real World ID, the demo-only simulated fallback, or the mock (simulated) World ID. */
function approvedVia(r: WorldRequestRow): "world_id" | "simulated_fallback" | "simulated_world_id" | null {
  if (!r.world_sub) return null;
  if (r.world_sub === SIMULATED_SUB) return "simulated_fallback";
  if (r.world_sub.startsWith("pairwise-mock-")) return "simulated_world_id";
  return "world_id";
}

function delivery(o: OrderRow) {
  const { qr: _qr, receipts, ...v } = orderView(o);
  const at = (n: string) => receipts.find((r) => r.event === n)?.at ?? null;
  const i = v.inspection as Record<string, any> | null;
  return {
    ref: v.ref, orderId: v.orderId, product: v.product, status: v.status, outcome: v.outcome, amount: v.amount, courierFee: v.courierFee,
    buyerRefunded: v.buyerRefunded, courier: v.courier, serial: v.serial, awaitingBuyer: v.awaitingBuyer,
    decisionDeadline: v.decisionDeadline, returnDeadline: v.returnDeadline, refundApproval: v.refundApproval,
    merchant: (db.prepare("SELECT name FROM merchants WHERE id = ?").get(o.merchant_id) as { name: string } | undefined)?.name ?? null,
    inspection: i ? {
      outcome: i.outcome, refundBps: i.refundBps ?? 0, damage: i.damage, inspectorName: i.inspectorName,
      amountUsd: i.payment?.amountUsd ?? null, hashscan: i.payment?.hashscan ?? null, mock: !!i.payment?.mock, hcsSequence: i.hcs?.sequence ?? null,
    } : null,
    createdAt: v.createdAt, handedOverAt: at("HandedOver"), settledAt: at("Settled"),
  };
}

export function householdOverview() {
  const rows = db.prepare("SELECT * FROM orders WHERE buyer IS NOT NULL AND status != 'created' ORDER BY created_at DESC LIMIT 100").all() as OrderRow[];
  const deliveries = rows.map(delivery);
  const pay = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount_usd),0) AS usd, COALESCE(SUM(CASE WHEN day = ? THEN amount_usd ELSE 0 END),0) AS todayUsd
     FROM agent_payments WHERE status = 'settled'`,
  ).get(today()) as { n: number; usd: number; todayUsd: number };
  const pending = db.prepare("SELECT COUNT(*) AS n FROM world_requests WHERE purpose = 'approve_refund' AND status IN ('creating','pending','validating')").get() as { n: number };
  return {
    household: { name: HOUSEHOLD.name, door: HOUSEHOLD.door },
    owner: ownerStatus(),
    deliveries,
    totals: {
      deliveries: deliveries.length,
      onTheWay: deliveries.filter((d) => ["paid", "packed", "dispatched"].includes(d.status)).length,
      atDoor: deliveries.filter((d) => d.status === "handed_over").length,
      refunded: deliveries.reduce((s, d) => s + Number(d.buyerRefunded || 0), 0).toFixed(2),
      refunds: deliveries.filter((d) => Number(d.buyerRefunded) > 0).length,
      inspections: pay.n, inspectionSpendUsd: pay.usd, inspectionSpendTodayUsd: pay.todayUsd,
      pendingApprovals: pending.n,
    },
  };
}

/** Partial-refund approvals the household agent asked the owner for (World ID Agent Pass checkpoints). */
export function householdApprovals() {
  const rows = db.prepare("SELECT * FROM world_requests WHERE purpose = 'approve_refund' ORDER BY started_at DESC LIMIT 50").all() as WorldRequestRow[];
  return {
    household: { name: HOUSEHOLD.name, door: HOUSEHOLD.door },
    owner: ownerStatus(),
    approvals: rows.map((r) => {
      const o = r.order_ref ? getOrderByRef(r.order_ref) : undefined;
      const v = o ? orderView(o) : undefined;
      const bps = Number((v?.inspection as { refundBps?: number } | null)?.refundBps ?? 0);
      const share = v ? Number(v.amount) - Number(v.courierFee) : 0;
      const { timeline, ...pv } = publicView(r);
      return {
        ...pv, timeline, approvedVia: approvedVia(r), startedAt: r.started_at,
        order: v ? { ref: v.ref, product: v.product, amount: v.amount, status: v.status, refundBps: bps, refund: bps ? ((share * bps) / 10000).toFixed(2) : null, decisionDeadline: v.decisionDeadline } : null,
      };
    }),
  };
}
