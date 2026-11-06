import { randomBytes } from "node:crypto";
import { erc20Abi, formatUnits, hashStruct, parseAbi, verifyTypedData, type Address, type Hex } from "viem";
import {
  decodeParcelQr, deliveryCheckoutAbi, encodeParcelQr, labelTypes, mockUsdtAbi, serialHash,
  USDT_DECIMALS,
} from "@openbox/shared";
import { cfg } from "./config";
import { accounts, checkout, deployment, note, publicClient, readOrder, txUrl, wallet, checkoutDomain } from "./chain";
import { financeByOrder, financeSummary } from "./finance";
import { db, getOrderById, getOrderByRef, now, updateOrder } from "./db";
import { publish } from "./bus";
import type { Merchant } from "./checkout";
import { indexNow } from "./indexer";
import { SIMULATED_SUB } from "./world/service";


/** Seller packs the parcel and records the item's serial. The label is signed after the courier is bound. */
export async function pack(m: Merchant, ref: string, serial: string) {
  const o = getOrderByRef(ref);
  if (!o || o.merchant_id !== m.id) throw new Error("unknown order");
  if (o.status !== "paid" && o.status !== "packed") throw new Error(`order is ${o.status}; only paid orders can be packed`);
  updateOrder(ref, { status: "packed", serial, serial_hash: serialHash(serial) });
  publish("order.packed", { ref, data: { serialHash: serialHash(serial) } });
  return { ref, serialHash: serialHash(serial) };
}

/** After dispatch binds the courier on-chain: sign the one-time label naming that courier and build the QR. */
export async function signLabel(ref: string) {
  const o = getOrderByRef(ref);
  if (!o?.serial_hash || !o.courier_hash) throw new Error("order not packed/dispatched");
  const label = {
    orderId: o.order_id, serialHash: o.serial_hash, courierHash: o.courier_hash,
    labelNonce: BigInt("0x" + randomBytes(6).toString("hex")),
  };
  const sig = await accounts.seller.signTypedData({ domain: checkoutDomain, types: labelTypes, primaryType: "Label", message: label });
  const qr = encodeParcelQr({
    v: 1, ref, orderId: label.orderId, serialHash: label.serialHash, courierHash: label.courierHash,
    labelNonce: label.labelNonce.toString(), sig, api: cfg.publicUrl,
  });
  updateOrder(ref, { label_json: JSON.stringify({ ...label, labelNonce: label.labelNonce.toString() }), label_sig: sig, qr });
  publish("order.labelled", { ref });
  return qr;
}

/** Doorbell's first check, before any World request: is this a genuine, unused label for an order we expect? */
export async function scan(qrText: string) {
  const p = decodeParcelQr(qrText);
  if (!p) return { ok: false as const, reason: "Not an OpenBox parcel QR" };
  const o = getOrderById(p.orderId);
  if (!o) return { ok: false as const, reason: "No order expected for this QR" };
  const label = { orderId: p.orderId, serialHash: p.serialHash, courierHash: p.courierHash, labelNonce: BigInt(p.labelNonce) };
  const sigOk = await verifyTypedData({ address: o.seller, domain: checkoutDomain, types: labelTypes, primaryType: "Label", message: label, signature: p.sig });
  if (!sigOk) return { ok: false as const, reason: "Label signature is not the seller's" };
  const labelHash = hashStruct({ data: label, types: labelTypes, primaryType: "Label" });
  const used = await publicClient.readContract({ ...checkout, functionName: "labelUsed", args: [labelHash] });
  if (used) return { ok: false as const, reason: "QR already used: this parcel was handed over before", ref: o.ref, used: true };
  const on = await readOrder(p.orderId);
  if (Number(on.status) !== 2) return { ok: false as const, reason: `Order is not out for delivery (on-chain status ${on.status})`, ref: o.ref };
  if (on.courierHash.toLowerCase() !== p.courierHash.toLowerCase()) return { ok: false as const, reason: "Label names a different courier than dispatch", ref: o.ref };
  return {
    ok: true as const, ref: o.ref, orderId: o.order_id, labelHash, product: o.product,
    courierFee: o.courier_fee, assignedCourier: o.courier_name ?? "assigned courier",
  };
}

// ---- merchant views ---------------------------------------------------------------

const usdt = (v: string | bigint | null | undefined) => formatUnits(BigInt(v ?? 0), USDT_DECIMALS);

export function merchantOrders(m: Merchant) {
  const rows = db.prepare("SELECT * FROM orders WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 200").all(m.id) as ReturnType<typeof getOrderByRef>[];
  const fin = financeByOrder(m.id);
  return rows.map((o) => ({ ...orderView(o!), advance: financeSummary(fin.get(o!.order_id.toLowerCase())) }));
}

export function orderView(o: NonNullable<ReturnType<typeof getOrderByRef>>) {
  const events = db.prepare("SELECT tx_hash, name, ts, data_json FROM chain_events WHERE order_id = ? ORDER BY block, log_index").all(o.order_id) as
    { tx_hash: string; name: string; ts: number; data_json: string }[];
  // Deadlines from the signed terms (stored on-chain at payment) and indexed block times:
  // decision = handoverAt + inspectionWindow (after it, the keeper's timeoutRelease pays the seller in full);
  // return = settledAt + returnWindow (serial-checked return refunds the seller's share from the refund pool).
  const terms = JSON.parse(o.terms_json) as { inspectionWindow?: string; returnWindow?: string };
  const evTs = (n: string) => events.find((e) => e.name === n)?.ts;
  const handoverAt = evTs("HandedOver"), settledAt = evTs("Settled");
  const inspectionWindowS = Number(terms.inspectionWindow ?? 0), returnWindowS = Number(terms.returnWindow ?? 0);
  return {
    decisionDeadline: o.pending_verdict_json && handoverAt ? handoverAt + inspectionWindowS : null,
    returnDeadline: settledAt && o.status === "settled" && returnWindowS ? settledAt + returnWindowS : null,
    returnWindowS: returnWindowS || null,
    ref: o.ref, orderId: o.order_id, product: o.product, status: o.status, outcome: o.outcome,
    amount: usdt(o.amount), courierFee: usdt(o.courier_fee), buyer: o.buyer, seller: o.seller,
    courier: o.courier_name, courierPayout: o.courier_payout, serial: o.serial, qr: o.qr,
    courierPaid: usdt(o.courier_paid), sellerPaid: usdt(o.seller_paid), buyerRefunded: usdt(o.buyer_refunded),
    awaitingBuyer: !!o.pending_verdict_json,
    inspection: o.last_inspection_json ? JSON.parse(o.last_inspection_json) : null,
    refundApproval: refundApproval(o.ref),
    receipts: events.map((e) => {
      const data = JSON.parse(e.data_json);
      // With an invoice advance, the seller share is paid to the note contract, which repays the lender.
      const event = e.name === "SellerPaid" && isNote(data.seller) ? "PayoutToNote" : e.name;
      return { event, txHash: e.tx_hash, explorerUrl: txUrl(e.tx_hash), at: e.ts, data };
    }),
    createdAt: o.created_at,
  };
}

/**
 * How the partial refund on this order was approved, if one was: a real World ID Agent Pass approval, or the
 * demo-only simulated fallback (no World ID proof). UIs must label the simulated case as such, never as World ID.
 */
function refundApproval(ref: string): { simulated: boolean; txHash: string | null } | null {
  const r = db.prepare("SELECT world_sub, tx_hash FROM world_requests WHERE purpose = 'approve_refund' AND order_ref = ? AND status = 'refunded' ORDER BY started_at DESC LIMIT 1")
    .get(ref) as { world_sub: string | null; tx_hash: string | null } | undefined;
  return r ? { simulated: r.world_sub === SIMULATED_SUB || !!r.world_sub?.startsWith("pairwise-mock-"), txHash: r.tx_hash } : null;
}

const isNote = (a?: string) => !!note && !!a && a.toLowerCase() === note.address.toLowerCase();
/** Events about the seller's financing; not shown to buyers. */
export const FINANCE_EVENTS = new Set(["NoteFunded", "NoteClosed", "PayoutLocked", "PayoutToNote"]);

const CSV_COLS = [
  "timestamp_utc", "order_ref", "order_id", "product", "event", "outcome", "buyer", "seller", "counterparty",
  "gross_usdt", "courier_fee_usdt", "amount_usdt", "direction", "tx_hash", "explorer_url", "hcs_seq",
];

/** Accountant export: one row per on-chain money event, straight from indexed logs. */
export function exportCsv(m: Merchant) {
  const rows = db.prepare(
    `SELECT e.*, o.ref, o.product, o.buyer, o.seller, o.amount AS gross, o.courier_fee, o.outcome
     FROM chain_events e JOIN orders o ON o.order_id = e.order_id WHERE o.merchant_id = ? ORDER BY e.block, e.log_index`,
  ).all(m.id) as Record<string, string | number>[];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLS.join(",")];
  for (const r of rows) {
    const d = JSON.parse(String(r.data_json));
    let amount = "", direction = "", counterparty = "";
    switch (r.name) {
      case "OrderCreated": amount = usdt(d.amount); direction = "buyer->hold"; counterparty = d.buyer; break;
      case "CourierPaid": amount = usdt(d.amount); direction = "hold->courier"; counterparty = d.courier; break;
      case "SellerPaid":
        amount = usdt(d.amount); counterparty = d.seller;
        direction = isNote(d.seller) ? "hold->note (repays invoice advance)" : "hold->seller";
        break;
      case "NoteFunded": amount = usdt(BigInt(d.advance) - BigInt(d.holdback)); direction = "lender->seller (invoice advance)"; counterparty = d.lender; break;
      case "NoteClosed":
        if (BigInt(d.toSeller ?? 0) === 0n) continue; // bond fully used: no money to the seller
        amount = usdt(d.toSeller); direction = "note->seller (bond returned)"; counterparty = note?.address ?? ""; break;
      case "BuyerRefunded": amount = usdt(d.amount); direction = "hold->buyer (refund)"; counterparty = d.buyer; break;
      case "ReturnRefunded": amount = usdt(d.amount); direction = "refund_pool->buyer (return)"; counterparty = d.buyer; break;
      case "DeliveryCancelled": amount = usdt(d.amount); direction = "hold->buyer (undelivered)"; counterparty = r.buyer as string; break;
      default: continue; // non-money events (HandedOver, Settled, TimeoutReleased) are in receipts, not the ledger
    }
    lines.push([
      new Date(Number(r.ts) * 1000).toISOString(), r.ref, r.order_id, r.product, r.name, r.outcome ?? "",
      r.buyer, r.seller, counterparty, usdt(String(r.gross)), usdt(String(r.courier_fee)), amount, direction,
      r.tx_hash, txUrl(String(r.tx_hash)), d.hcsSeq ?? "",
    ].map(esc).join(","));
  }
  return lines.join("\n") + "\n";
}

export async function refundPool(m: Merchant) {
  const v = await publicClient.readContract({ ...checkout, functionName: "refundPool", args: [m.seller] });
  return usdt(v);
}

/** Seller tops up its refund pool (seller's own tx; merchants hold WBT). */
export async function depositRefundPool(m: Merchant, amountUsdt: number) {
  if (m.seller.toLowerCase() !== accounts.seller.address.toLowerCase()) throw new Error("demo backend only holds the demo seller key");
  const amt = BigInt(Math.round(amountUsdt * 10 ** USDT_DECIMALS));
  const w = wallet("seller");
  const allowance = await publicClient.readContract({ address: deployment.token, abi: erc20Abi, functionName: "allowance", args: [m.seller, deployment.deliveryCheckout] });
  if (allowance < amt) {
    const h = await w.writeContract({ address: deployment.token, abi: erc20Abi, functionName: "approve", args: [deployment.deliveryCheckout, amt], chain: undefined });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }
  const hash = await w.writeContract({ ...checkout, abi: deliveryCheckoutAbi, functionName: "depositRefundPool", args: [amt], chain: undefined });
  await publicClient.waitForTransactionReceipt({ hash });
  await indexNow();
  return { txHash: hash, explorerUrl: txUrl(hash) };
}

// ---- demo funding -------------------------------------------------------------------

const lastFund = new Map<string, number>();

/** DEMO_MODE only. Local: mint MockUSDT. Whitechain: send official USDT from a demo treasury wallet. */
export async function demoFund(address: Address, amountUsdt = Number(process.env.DEMO_FUND_USDT ?? 200)) {
  if (!cfg.demoMode) throw new Error("demo funding disabled");
  // Official testnet USDT is scarce (it can't be minted): top up just enough for one purchase,
  // whatever the caller asks for. Only the local mock token honours larger amounts.
  if (!deployment.mockToken) amountUsdt = Math.min(amountUsdt, Number(process.env.DEMO_FUND_USDT ?? 7));
  const k = address.toLowerCase();
  if ((lastFund.get(k) ?? 0) > now() - 60) throw new Error("funded recently");
  lastFund.set(k, now());
  const amt = BigInt(Math.round(amountUsdt * 10 ** USDT_DECIMALS));
  let hash: Hex;
  if (deployment.mockToken) {
    hash = await wallet("relayer").writeContract({ address: deployment.token, abi: mockUsdtAbi, functionName: "mint", args: [address, amt], chain: undefined });
  } else {
    if (!accounts.treasury) throw new Error("DEMO_TREASURY_PK not set");
    hash = await wallet("treasury").writeContract({ address: deployment.token, abi: erc20Abi, functionName: "transfer", args: [address, amt], chain: undefined });
  }
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, explorerUrl: txUrl(hash), amount: amountUsdt };
}

export async function usdtBalance(address: Address) {
  const v = await publicClient.readContract({ address: deployment.token, abi: erc20Abi, functionName: "balanceOf", args: [address] });
  return usdt(v);
}

export const tokenInfo = async () => ({
  address: deployment.token,
  symbol: await publicClient.readContract({ address: deployment.token, abi: parseAbi(["function symbol() view returns (string)"]), functionName: "symbol" }).catch(() => "USDT"),
  mock: deployment.mockToken,
});
