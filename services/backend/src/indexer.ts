import { parseEventLogs, type Hex } from "viem";
import { deliveryCheckoutAbi, Outcome, outcomeLabel, receivableNoteAbi, type WebhookEvent } from "@openbox/shared";
import { checkout, deployment, note, noteTokenUrl, publicClient, txUrl } from "./chain";
import { db, getOrderById, kvGet, kvSet, updateOrder } from "./db";
import { publish } from "./bus";
import { enqueueWebhook } from "./webhooks";

/**
 * Polls DeliveryCheckout logs, persists them (receipts + CSV source of truth), updates order state and fans out
 * to SSE + merchant webhooks. Polling (not filters) so it works on any RPC.
 */
const KEY = `indexer:${deployment.deliveryCheckout.toLowerCase()}`;
const NOTE_KEY = note ? `indexer:${note.address.toLowerCase()}` : undefined;
const NOTE_EVENTS = new Set(["NoteFunded", "NoteClosed"]);
const MAX_RANGE = 2000n;
const blockTs = new Map<bigint, number>();

async function tsOf(block: bigint) {
  if (!blockTs.has(block)) blockTs.set(block, Number((await publicClient.getBlock({ blockNumber: block })).timestamp));
  return blockTs.get(block)!;
}

const add = (a: string | null | undefined, b: bigint) => (BigInt(a ?? "0") + b).toString();
const ser = (o: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function tick() {
  const head = await publicClient.getBlockNumber();
  let from = BigInt(kvGet(KEY) ?? deployment.deployBlock ?? 0);
  if (from > head) return;
  while (from <= head) {
    const to = from + MAX_RANGE - 1n < head ? from + MAX_RANGE - 1n : head;
    const raw = await publicClient.getLogs({ address: checkout.address, fromBlock: from, toBlock: to });
    const logs = parseEventLogs({ abi: deliveryCheckoutAbi, logs: raw });
    for (const log of logs) await handle(log as unknown as Decoded);
    kvSet(KEY, (to + 1n).toString());
    from = to + 1n;
  }
  await tickNote(head);
}

/** ReceivableNote (invoice advances): NoteFunded / NoteClosed → financing row, order timeline, SSE, webhooks. */
async function tickNote(head: bigint) {
  if (!note || !NOTE_KEY) return;
  let from = BigInt(kvGet(NOTE_KEY) ?? deployment.receivableNoteBlock ?? deployment.deployBlock ?? 0);
  while (from <= head) {
    const to = from + MAX_RANGE - 1n < head ? from + MAX_RANGE - 1n : head;
    const raw = await publicClient.getLogs({ address: note.address, fromBlock: from, toBlock: to });
    const logs = parseEventLogs({ abi: receivableNoteAbi, logs: raw }).filter((l) => NOTE_EVENTS.has(l.eventName));
    for (const log of logs) await handle(log as unknown as Decoded);
    kvSet(NOTE_KEY, (to + 1n).toString());
    from = to + 1n;
  }
}

const NOTE_STATUS = ["none", "active", "repaid", "shortfall"] as const;

type Decoded = {
  eventName: string; args: Record<string, unknown>; transactionHash: Hex; logIndex: number; blockNumber: bigint;
};

async function handle(log: Decoded) {
  const ts = await tsOf(log.blockNumber);
  const orderId = (log.args.orderId as string | undefined)?.toLowerCase();
  const inserted = db
    .prepare("INSERT OR IGNORE INTO chain_events (tx_hash, log_index, block, ts, name, order_id, data_json) VALUES (?,?,?,?,?,?,?)")
    .run(log.transactionHash, log.logIndex, Number(log.blockNumber), ts, log.eventName, orderId ?? null, JSON.stringify(ser(log.args)));
  if (!inserted.changes) return; // already processed
  if (!orderId) return;
  const o = getOrderById(orderId);
  if (!o) return;
  const a = log.args;
  const tx = log.transactionHash;
  const base = { ref: o.ref, orderId, txHash: tx, explorerUrl: txUrl(tx) };
  let hook: WebhookEvent | undefined;
  let data: Record<string, unknown> = {};

  switch (log.eventName) {
    case "OrderCreated":
      updateOrder(o.ref, { status: "paid", buyer: (a.buyer as Hex).toLowerCase() as Hex, pay_tx: tx });
      hook = "order.paid"; data = { buyer: a.buyer, amount: String(a.amount), courierFee: String(a.courierFee), method: Number(a.method) };
      break;
    case "Dispatched":
      updateOrder(o.ref, { status: "dispatched", dispatch_tx: tx });
      hook = "order.dispatched"; data = { courier: a.courier, courierHash: a.courierHash };
      break;
    case "ReturnToSender":
      updateOrder(o.ref, { status: "returning" });
      hook = "order.return_to_sender"; data = { courier: a.courier, note: "Mismatch: parcel goes back with the courier as a tracked return" };
      break;
    case "HandedOver":
      updateOrder(o.ref, { status: "handed_over", handover_tx: tx, courier_hash: a.courierHash as Hex });
      hook = "order.handed_over"; data = { courier: a.courier, serialHash: a.serialHash };
      break;
    case "CourierPaid":
      updateOrder(o.ref, { courier_paid: add(o.courier_paid, a.amount as bigint) });
      hook = "courier.paid"; data = { courier: a.courier, amount: String(a.amount) };
      break;
    case "Settled": {
      const outcome = outcomeLabel[Number(a.outcome) as Outcome];
      updateOrder(o.ref, { status: "settled", outcome, settle_tx: tx, pending_verdict_json: null });
      hook = "order.settled"; data = { outcome, sellerAmount: String(a.sellerAmount), buyerRefund: String(a.buyerRefund), refundBps: Number(a.refundBps), hcsSeq: String(a.hcsSeq) };
      break;
    }
    case "SellerPaid":
      updateOrder(o.ref, { seller_paid: add(o.seller_paid, a.amount as bigint) });
      hook = "seller.paid"; data = { seller: a.seller, amount: String(a.amount) };
      break;
    case "BuyerRefunded":
      updateOrder(o.ref, { buyer_refunded: add(o.buyer_refunded, a.amount as bigint) });
      hook = "buyer.refunded"; data = { buyer: a.buyer, amount: String(a.amount), reason: outcomeLabel[Number(a.reason) as Outcome] };
      break;
    case "TimeoutReleased":
      hook = "order.timeout_released"; data = { sellerAmount: String(a.sellerAmount) };
      break;
    case "ReturnRefunded":
      updateOrder(o.ref, { status: "returned", return_tx: tx, buyer_refunded: add(o.buyer_refunded, a.amount as bigint) });
      hook = "order.return_refunded"; data = { buyer: a.buyer, amount: String(a.amount), hcsSeq: String(a.hcsSeq) };
      break;
    case "NoteFunded": {
      db.prepare(
        `UPDATE finance_offers SET status = 'funded', lender = ?, holder = COALESCE(holder, ?), fund_tx = ?, funded_at = COALESCE(funded_at, ?), updated_at = ?
         WHERE id = (SELECT id FROM finance_offers WHERE order_id = ? ORDER BY (status = 'offered') DESC, id DESC LIMIT 1) AND status IN ('offered','expired','funded')`,
      ).run(String(a.lender).toLowerCase(), String(a.lender).toLowerCase(), tx, ts, ts, orderId);
      const sellerToday = (a.advance as bigint) - (a.holdback as bigint);
      hook = "invoice.funded";
      data = {
        noteId: String(a.noteId), lender: a.lender, face: String(a.face), advance: String(a.advance), holdback: String(a.holdback),
        sellerReceived: String(sellerToday), noteUrl: noteTokenUrl(orderId),
      };
      break;
    }
    case "NoteClosed": {
      const status = NOTE_STATUS[Number(a.status)] ?? "repaid";
      db.prepare(
        `UPDATE finance_offers SET status = ?, holder = ?, close_tx = ?, to_holder = ?, to_seller = ?, outcome = ?, closed_at = ?, updated_at = ?
         WHERE id = (SELECT id FROM finance_offers WHERE order_id = ? AND status IN ('funded','repaid','shortfall') ORDER BY id DESC LIMIT 1)`,
      ).run(status, String(a.holder).toLowerCase(), tx, String(a.toHolder), String(a.toSeller), Number(a.outcome), ts, ts, orderId);
      hook = "invoice.closed";
      data = {
        noteId: String(a.noteId), holder: a.holder, result: status, outcome: outcomeLabel[Number(a.outcome) as Outcome],
        toHolder: String(a.toHolder), toSeller: String(a.toSeller),
      };
      break;
    }
    case "DeliveryCancelled":
      updateOrder(o.ref, { status: "cancelled", buyer_refunded: add(o.buyer_refunded, a.amount as bigint) });
      hook = "order.cancelled"; data = { amount: String(a.amount) };
      break;
  }
  publish(`chain.${log.eventName}`, { ref: o.ref, orderId, data: { ...base, ...data } });
  if (hook) enqueueWebhook(o.merchant_id, hook, { ...base, ...data, blockTime: ts });
}

// One tick at a time: interval ticks and on-demand indexNow() share a promise chain.
let chainP: Promise<void> = Promise.resolve();
export function indexNow(): Promise<void> {
  chainP = chainP.then(tick).catch((e) => console.error("[indexer]", (e as Error).message));
  return chainP;
}

export function startIndexer(intervalMs = 1500) {
  setInterval(() => void indexNow(), intervalMs);
}
