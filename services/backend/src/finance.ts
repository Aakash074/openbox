import {
  BaseError, ContractFunctionRevertedError, decodeErrorResult, erc20Abi, formatUnits, zeroAddress, type Address, type Hex,
} from "viem";
import {
  deliveryCheckoutAbi, explorerAddress, financeOfferTypes, lockPayoutTypes, mockUsdtAbi, OrderStatus, Outcome, outcomeLabel,
  USDT_DECIMALS,
} from "@openbox/shared";
import { cfg } from "./config";
import { accounts, checkout, checkoutDomain, deployment, note, noteDomain, noteTokenUrl, publicClient, readOrder, txUrl, wallet } from "./chain";
import { db, getOrderByRef, now, type OrderRow } from "./db";
import { publish } from "./bus";
import type { Merchant } from "./checkout";

/**
 * Invoice advances. A seller sells an order's payout (a receivable) to an allowlisted lender: the seller signs a
 * FinanceOffer (price) + LockPayout (route the payout to the note), the lender calls ReceivableNote.finance and
 * gets an ERC-721 note; settlement repays the holder, and the seller's bond covers any shortfall.
 */

export type FinanceRow = {
  id: number; order_ref: string; order_id: Hex; merchant_id: string; note: Address;
  face: string; advance: string; holdback: string; deadline: number; offer_sig: Hex; lock_sig: Hex;
  status: "offered" | "funded" | "repaid" | "shortfall" | "expired";
  lender: string | null; holder: string | null; fund_tx: string | null; close_tx: string | null;
  to_holder: string | null; to_seller: string | null; outcome: number | null;
  created_at: number; funded_at: number | null; closed_at: number | null; updated_at: number;
};

const usdt = (v: string | bigint | null | undefined) => formatUnits(BigInt(v ?? 0), USDT_DECIMALS);
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });

export const financeEnabled = () => !!note;
export const lenderAddress = (): Address | undefined =>
  accounts.lender?.address ?? deployment.lender ?? (process.env.LENDER_ADDR as Address | undefined);

/** Advance and holdback for a face value, from FINANCE_ADVANCE_BPS / FINANCE_HOLDBACK_BPS. */
export function quoteFor(face: bigint) {
  const advance = (face * cfg.finance.advanceBps) / 10_000n;
  let holdback = (face * cfg.finance.holdbackBps) / 10_000n;
  if (holdback > advance) holdback = advance;
  return { face, advance, holdback };
}

function amounts(face: bigint, advance: bigint, holdback: bigint) {
  const ret = face - advance;
  return {
    face: usdt(face), advance: usdt(advance), holdback: usdt(holdback), bond: usdt(holdback),
    sellerToday: usdt(advance - holdback), lenderReturn: usdt(ret),
    returnPct: advance > 0n ? Number((ret * 1_000_000n) / advance) / 10_000 : 0, // % on capital
    discountPct: face > 0n ? Number((ret * 1_000_000n) / face) / 10_000 : 0, // % off face
  };
}

/** Offers past their deadline can't be funded any more (finance() and lockPayout() both check it). */
export function expireStale() {
  db.prepare("UPDATE finance_offers SET status = 'expired', updated_at = ? WHERE status = 'offered' AND deadline < ?").run(now(), now());
}

export const latestFinance = (orderId: string) =>
  db.prepare("SELECT * FROM finance_offers WHERE order_id = ? ORDER BY id DESC LIMIT 1").get(orderId.toLowerCase()) as FinanceRow | undefined;

/** Latest financing row per order (for the merchant orders list). */
export function financeByOrder(merchantId: string) {
  expireStale();
  const rows = db.prepare(
    `SELECT f.* FROM finance_offers f JOIN (SELECT order_id, MAX(id) AS id FROM finance_offers WHERE merchant_id = ? GROUP BY order_id) l ON l.id = f.id`,
  ).all(merchantId) as FinanceRow[];
  return new Map(rows.map((r) => [r.order_id.toLowerCase(), r]));
}

/** Compact badge data for list views. */
export function financeSummary(r: FinanceRow | undefined) {
  if (!r || r.status === "expired") return null;
  const today = BigInt(r.advance) - BigInt(r.holdback);
  return {
    status: r.status, advance: usdt(r.advance), sellerToday: usdt(today), bond: usdt(r.holdback),
    bondReturned: r.to_seller != null ? usdt(r.to_seller) : null,
    received: usdt(today + BigInt(r.to_seller ?? 0)), // what the seller has received so far for this order
  };
}

const NOTE_STATUS = ["none", "active", "repaid", "shortfall"] as const;

export async function readNote(orderId: Hex) {
  if (!note) return null;
  const n = await publicClient.readContract({ ...note, functionName: "getNote", args: [BigInt(orderId)] });
  if (Number(n.status) === 0) return null;
  return {
    status: NOTE_STATUS[Number(n.status)] ?? "none", seller: n.seller, lender: n.lender,
    face: usdt(n.face), advance: usdt(n.advance), holdback: usdt(n.holdback), repaid: usdt(n.repaid),
    fundedAt: Number(n.fundedAt), closedAt: Number(n.closedAt) || null,
    outcome: Number(n.status) >= 2 ? outcomeLabel[Number(n.outcome) as Outcome] ?? null : null,
  };
}

export function offerJson(r: FinanceRow) {
  const face = BigInt(r.face), advance = BigInt(r.advance), holdback = BigInt(r.holdback);
  const lender = r.lender as Address | null;
  return {
    id: r.id, ref: r.order_ref, orderId: r.order_id, status: r.status,
    ...amounts(face, advance, holdback),
    deadline: r.deadline, createdAt: r.created_at, fundedAt: r.funded_at, closedAt: r.closed_at,
    lender, lenderUrl: lender ? explorerAddress(cfg.chainId, lender, cfg.explorer) : undefined,
    holder: r.holder,
    fundTx: r.fund_tx, fundTxUrl: r.fund_tx ? txUrl(r.fund_tx) : undefined,
    closeTx: r.close_tx, closeTxUrl: r.close_tx ? txUrl(r.close_tx) : undefined,
    toHolder: r.to_holder != null ? usdt(r.to_holder) : null, toSeller: r.to_seller != null ? usdt(r.to_seller) : null,
    outcome: r.outcome != null ? outcomeLabel[r.outcome as Outcome] ?? null : null,
    noteAddress: r.note, tokenId: BigInt(r.order_id).toString(), tokenUrl: noteTokenUrl(r.order_id),
  };
}

// ---- eligibility -------------------------------------------------------------------------

const OPEN = new Set<number>([OrderStatus.Paid, OrderStatus.Dispatched, OrderStatus.HandedOver]);
const CLOSED_REASON: Record<number, string> = {
  [OrderStatus.None]: "The buyer hasn't paid yet.",
  [OrderStatus.Settled]: "This order has already settled, so the payout has been made.",
  [OrderStatus.Returned]: "This order was returned.",
  [OrderStatus.Cancelled]: "This delivery was cancelled and the buyer refunded.",
};

async function eligibility(o: OrderRow) {
  if (!note) return { eligible: false, reason: "Invoice advances aren't available on this network yet." };
  if (o.seller.toLowerCase() !== accounts.seller.address.toLowerCase())
    return { eligible: false, reason: "This server can only sign advance requests for the demo seller." };
  const on = await readOrder(o.order_id);
  const st = Number(on.status);
  if (!OPEN.has(st)) return { eligible: false, reason: CLOSED_REASON[st] ?? "This order can't be advanced right now.", chainOrder: on };
  if (on.amount - on.courierFee <= 0n) return { eligible: false, reason: "There's no payout to advance on this order.", chainOrder: on };
  const lockedTo = await publicClient.readContract({ ...checkout, functionName: "payoutLockedTo", args: [o.order_id] });
  if (lockedTo !== zeroAddress) return { eligible: false, reason: "This order's payout has already been advanced.", chainOrder: on, lockedTo };
  return { eligible: true as const, reason: null, chainOrder: on };
}

/** Merchant view: quote, eligibility and the current offer / note for one order. */
export async function financingView(o: OrderRow) {
  expireStale();
  const row = latestFinance(o.order_id);
  const live = row && row.status !== "expired" ? row : undefined;
  const face = BigInt(o.amount) - BigInt(o.courier_fee);
  const q = quoteFor(face);
  // A live offer or note decides the state; only check eligibility when the seller could request a new one.
  const e = live ? { eligible: false, reason: null } : await eligibility(o).catch((err) => ({ eligible: false, reason: `Couldn't check this order on-chain: ${(err as Error).message}` }));
  const chainNote = live && live.status !== "offered" ? await readNote(o.order_id).catch(() => null) : null;
  return {
    enabled: financeEnabled(), noteAddress: note?.address ?? null,
    eligible: e.eligible, reason: e.reason,
    status: live?.status ?? null,
    quote: { ...amounts(q.face, q.advance, q.holdback), advanceBps: Number(cfg.finance.advanceBps), holdbackBps: Number(cfg.finance.holdbackBps) },
    offer: live ? offerJson(live) : null,
    expired: row?.status === "expired" ? offerJson(row) : null,
    note: chainNote,
  };
}

/** Seller requests an advance: sign the price and the payout lock, store an open offer for lenders. */
export async function createOffer(m: Merchant, ref: string) {
  const o = getOrderByRef(ref);
  if (!o || o.merchant_id !== m.id) throw fail("not found", 404);
  if (!note || !noteDomain) throw fail("Invoice advances aren't available on this network yet.", 422);
  expireStale();
  const prev = latestFinance(o.order_id);
  if (prev?.status === "offered") return financingView(o); // idempotent: one open offer per order
  if (prev && prev.status !== "expired") throw fail("This order's payout has already been advanced.");
  const e = await eligibility(o);
  if (!e.eligible) throw fail(e.reason ?? "Not eligible", 422);
  const on = e.chainOrder!;
  const { face, advance, holdback } = quoteFor(on.amount - on.courierFee);
  if (advance === 0n) throw fail("There's no payout to advance on this order.", 422);
  const deadline = BigInt(now() + cfg.finance.offerTtlS);
  const offerSig = await accounts.seller.signTypedData({
    domain: noteDomain, types: financeOfferTypes, primaryType: "FinanceOffer",
    message: { orderId: o.order_id, advance, holdback, deadline },
  });
  const lockSig = await accounts.seller.signTypedData({
    domain: checkoutDomain, types: lockPayoutTypes, primaryType: "LockPayout",
    message: { orderId: o.order_id, financier: note.address, deadline },
  });
  const t = now();
  db.prepare(
    `INSERT INTO finance_offers (order_ref, order_id, merchant_id, note, face, advance, holdback, deadline, offer_sig, lock_sig, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'offered', ?, ?)`,
  ).run(o.ref, o.order_id.toLowerCase(), m.id, note.address, face.toString(), advance.toString(), holdback.toString(), Number(deadline), offerSig, lockSig, t, t);
  publish("invoice.offered", { ref: o.ref, orderId: o.order_id, data: { advance: usdt(advance), holdback: usdt(holdback), deadline: Number(deadline) } });
  return financingView(o);
}

// ---- lender ------------------------------------------------------------------------------

type MarketRow = FinanceRow & { product: string | null; order_status: string; order_outcome: string | null; awaiting: number; merchant_name: string };

export async function marketplace() {
  expireStale();
  const lender = lenderAddress();
  const rows = db.prepare(
    `SELECT f.*, o.product, o.status AS order_status, o.outcome AS order_outcome,
            (o.pending_verdict_json IS NOT NULL) AS awaiting, m.name AS merchant_name
     FROM finance_offers f JOIN orders o ON o.order_id = f.order_id JOIN merchants m ON m.id = f.merchant_id
     WHERE f.status != 'expired' ORDER BY f.id DESC LIMIT 300`,
  ).all() as MarketRow[];
  const view = (r: MarketRow) => ({
    ...offerJson(r), product: r.product, merchant: r.merchant_name,
    orderStatus: r.awaiting ? "awaiting_buyer" : r.order_status, orderOutcome: r.order_outcome,
  });
  const active = rows.filter((r) => r.status === "funded");
  const closed = rows.filter((r) => r.status === "repaid" || r.status === "shortfall");
  const sum = (xs: FinanceRow[], f: (r: FinanceRow) => bigint) => xs.reduce((s, r) => s + f(r), 0n);
  const losses = sum(closed, (r) => { const d = BigInt(r.advance) - BigInt(r.to_holder ?? 0); return d > 0n ? d : 0n; });
  const earned = sum(closed, (r) => BigInt(r.to_holder ?? 0) - BigInt(r.advance));
  const [balance, gas, allowed] = lender
    ? await Promise.all([
        publicClient.readContract({ address: deployment.token, abi: erc20Abi, functionName: "balanceOf", args: [lender] }),
        publicClient.getBalance({ address: lender }),
        note ? publicClient.readContract({ ...note, functionName: "isLender", args: [lender] }) : Promise.resolve(false),
      ])
    : [null, null, false];
  return {
    enabled: financeEnabled(),
    noteAddress: note?.address ?? null,
    noteUrl: note ? explorerAddress(cfg.chainId, note.address, cfg.explorer) : null,
    lender: lender ?? null, lenderUrl: lender ? explorerAddress(cfg.chainId, lender, cfg.explorer) : null,
    lenderAllowlisted: allowed, canFund: !!accounts.lender && allowed,
    terms: { advanceBps: Number(cfg.finance.advanceBps), holdbackBps: Number(cfg.finance.holdbackBps), offerTtlS: cfg.finance.offerTtlS },
    kpis: {
      available: balance != null ? usdt(balance) : null,
      gas: gas != null ? formatUnits(gas, 18) : null,
      deployed: usdt(sum(active, (r) => BigInt(r.advance))),
      outstanding: usdt(sum(active, (r) => BigInt(r.face))),
      repaid: usdt(sum(closed, (r) => BigInt(r.to_holder ?? 0))),
      earned: usdt(earned > 0n ? earned : 0n),
      losses: usdt(losses),
      openCount: rows.filter((r) => r.status === "offered").length, activeCount: active.length, closedCount: closed.length,
      shortfallCount: closed.filter((r) => r.status === "shortfall").length,
    },
    offers: rows.filter((r) => r.status === "offered").map(view),
    active: active.map(view),
    closed: closed.map(view),
  };
}

const REVERT: Record<string, string> = {
  NotLender: "The lender wallet isn't approved on the note contract.",
  Expired: "This offer expired before it could be funded.",
  BadOffer: "The offer terms don't fit this order any more.",
  BadSignature: "The seller's signature on this offer isn't valid.",
  AlreadyLocked: "This order's payout has already been advanced.",
  BadStatus: "This order can no longer be advanced: it has settled or ended.",
  NotFinancier: "The note contract isn't approved as a financier on checkout.",
};

function revertReason(e: unknown) {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r) {
      let name = r.data?.errorName;
      if (!name && r.raw) {
        try { name = decodeErrorResult({ abi: deliveryCheckoutAbi, data: r.raw }).errorName; } catch { /* unknown selector */ }
      }
      if (name && REVERT[name]) return REVERT[name];
      return name ? `Funding reverted: ${name}` : r.shortMessage;
    }
    return e.shortMessage;
  }
  return (e as Error).message;
}

let funding: Promise<unknown> = Promise.resolve();

/** Demo lender funds an open offer: allowance → finance() from the lender wallet (lender pays its own gas). */
export function fundOffer(id: number) {
  const run = funding.then(() => fundOfferNow(id));
  funding = run.catch(() => undefined); // one lender tx sequence at a time (nonces)
  return run;
}

async function fundOfferNow(id: number) {
  if (!note) throw fail("Invoice advances aren't available on this network yet.", 422);
  const lender = accounts.lender;
  if (!lender) throw fail("No demo lender wallet is configured (DEMO_LENDER_PK).", 422);
  expireStale();
  const r = db.prepare("SELECT * FROM finance_offers WHERE id = ?").get(id) as FinanceRow | undefined;
  if (!r) throw fail("Offer not found.", 404);
  if (r.status === "expired") throw fail("This offer has expired. The seller can request a new advance.", 410);
  if (r.status !== "offered") throw fail("This invoice has already been funded.");
  if (r.deadline < now() + 60) throw fail("This offer expires in under a minute. Ask the seller for a fresh one.", 410);
  if (r.note.toLowerCase() !== note.address.toLowerCase()) throw fail("This offer was signed for a different note contract.", 422);

  const on = await readOrder(r.order_id);
  if (!OPEN.has(Number(on.status))) throw fail(CLOSED_REASON[Number(on.status)] ?? "This order can no longer be advanced.");
  const lockedTo = await publicClient.readContract({ ...checkout, functionName: "payoutLockedTo", args: [r.order_id] });
  if (lockedTo !== zeroAddress) throw fail("This order's payout has already been advanced.");
  if (!(await publicClient.readContract({ ...note, functionName: "isLender", args: [lender.address] })))
    throw fail("The lender wallet isn't approved on the note contract.", 422);

  const advance = BigInt(r.advance);
  const tokenRead = { address: deployment.token, abi: erc20Abi } as const;
  let bal = await publicClient.readContract({ ...tokenRead, functionName: "balanceOf", args: [lender.address] });
  if (bal < advance && deployment.mockToken) {
    // Local chain: top the demo lender up with mock USDT, like demo buyer funding.
    const h = await wallet("relayer").writeContract({ address: deployment.token, abi: mockUsdtAbi, functionName: "mint", args: [lender.address, advance * 100n], chain: undefined });
    await publicClient.waitForTransactionReceipt({ hash: h });
    bal = await publicClient.readContract({ ...tokenRead, functionName: "balanceOf", args: [lender.address] });
  }
  if (bal < advance) throw fail(`Insufficient lender balance: ${usdt(bal)} USDT available, ${usdt(advance)} USDT needed.`, 422);
  if ((await publicClient.getBalance({ address: lender.address })) === 0n)
    throw fail("The lender wallet has no gas to send the transaction.", 422);

  const w = wallet("lender");
  const allowance = await publicClient.readContract({ ...tokenRead, functionName: "allowance", args: [lender.address, note.address] });
  if (allowance < advance) {
    // USDT-style tokens refuse changing a non-zero allowance; reset first.
    if (allowance > 0n) {
      const z = await w.writeContract({ ...tokenRead, functionName: "approve", args: [note.address, 0n], chain: undefined });
      await publicClient.waitForTransactionReceipt({ hash: z });
    }
    const a = await w.writeContract({ ...tokenRead, functionName: "approve", args: [note.address, advance], chain: undefined });
    const ar = await publicClient.waitForTransactionReceipt({ hash: a });
    if (ar.status !== "success") throw fail("Approving USDT for the note contract failed.", 502);
  }

  const args = [r.order_id, advance, BigInt(r.holdback), BigInt(r.deadline), r.offer_sig, r.lock_sig] as const;
  let hash: Hex;
  try {
    const { request } = await publicClient.simulateContract({ ...note, functionName: "finance", args, account: lender });
    hash = await w.writeContract({ ...request, chain: undefined });
  } catch (e) {
    throw fail(revertReason(e), 422);
  }
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw fail(`Funding transaction reverted (${hash}).`, 502);
  // The indexer records NoteFunded too; mark it now so the UI doesn't wait for the next poll.
  db.prepare("UPDATE finance_offers SET status = 'funded', lender = ?, holder = ?, fund_tx = ?, funded_at = COALESCE(funded_at, ?), updated_at = ? WHERE id = ? AND status = 'offered'")
    .run(lender.address.toLowerCase(), lender.address.toLowerCase(), hash, now(), now(), id);
  const { indexNow } = await import("./indexer");
  await indexNow();
  const row = db.prepare("SELECT * FROM finance_offers WHERE id = ?").get(id) as FinanceRow;
  return { txHash: hash, explorerUrl: txUrl(hash), tokenId: BigInt(r.order_id).toString(), tokenUrl: noteTokenUrl(r.order_id), offer: offerJson(row) };
}

/** Merchant KPIs: advances received, payouts still owed to lenders, bonds held. */
export function merchantFinanceStats(merchantId: string) {
  const rows = db.prepare("SELECT * FROM finance_offers WHERE merchant_id = ? AND status IN ('funded','repaid','shortfall')").all(merchantId) as FinanceRow[];
  let advanced = 0n, outstanding = 0n, bondHeld = 0n, bondReturned = 0n;
  for (const r of rows) {
    advanced += BigInt(r.advance) - BigInt(r.holdback);
    if (r.status === "funded") { outstanding += BigInt(r.face); bondHeld += BigInt(r.holdback); }
    else bondReturned += BigInt(r.to_seller ?? 0);
  }
  // Seller shares the checkout paid to the note (they repaid lenders, not the seller).
  let toNote = 0n;
  if (note) {
    const ev = db.prepare(
      `SELECT e.data_json FROM chain_events e JOIN orders o ON o.order_id = e.order_id
       WHERE o.merchant_id = ? AND e.name = 'SellerPaid' AND lower(json_extract(e.data_json, '$.seller')) = ?`,
    ).all(merchantId, note.address.toLowerCase()) as { data_json: string }[];
    for (const e of ev) toNote += BigInt(JSON.parse(e.data_json).amount ?? 0);
  }
  return {
    toNoteRaw: toNote, receivedRaw: advanced + bondReturned,
    enabled: financeEnabled(), count: rows.length, active: rows.filter((r) => r.status === "funded").length,
    advanced: usdt(advanced), outstanding: usdt(outstanding), bondHeld: usdt(bondHeld), bondReturned: usdt(bondReturned),
  };
}
