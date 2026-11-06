"use client";
import { useState, type ReactNode } from "react";
import { merchant, usePoll } from "../lib/api";
import { Badge, Callout, ExtLink, Hash, Icon, Money, Skeleton, Timestamp, fmtAmount } from "./ui";
import { ReceivableFlow } from "./art";
import { LENDER_NAME } from "./roles";

/** Delivery stage of the order behind a receivable, in lender terms. */
const DELIVERY: Record<string, [string, "info" | "warning" | "success" | "neutral" | "danger"]> = {
  paid: ["Preparing", "info"], packed: ["Preparing", "info"], dispatched: ["In transit", "info"],
  handed_over: ["Inspecting at the door", "info"], awaiting_buyer: ["Buyer reviewing", "warning"],
  settled: ["Delivered", "success"], returning: ["Return in progress", "warning"], returned: ["Returned", "neutral"],
  returned_to_seller: ["Returned", "neutral"], cancelled: ["Cancelled", "neutral"],
};
export function DeliveryBadge({ s }: { s?: string | null }) {
  if (!s) return <span className="muted">—</span>;
  const [label, tone] = DELIVERY[s] ?? [s.replace(/_/g, " "), "neutral" as const];
  return <Badge tone={tone}>{label}</Badge>;
}

/** "in 1h 52m" / "in 4m" / "expired". */
export function timeLeft(deadline: number, nowS = Math.floor(Date.now() / 1000)) {
  const s = deadline - nowS;
  if (s <= 0) return "expired";
  const h = Math.floor(s / 3600), m = Math.max(1, Math.floor((s % 3600) / 60));
  return h ? `in ${h}h ${m}m` : `in ${m}m`;
}

const pctText = (n?: number) => `${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

const OUTCOME: Record<string, string> = { mismatch: "wrong item", damaged: "item damaged", timeout: "not delivered in time" };

/** Small badge for order lists. */
export function AdvanceBadge({ a }: { a?: { status: string } | null }) {
  if (!a) return null;
  const map: Record<string, [string, "info" | "brand" | "success" | "warning"]> = {
    offered: ["Advance requested", "info"], funded: ["Advanced", "brand"], repaid: ["Advance repaid", "success"], shortfall: ["Bond used", "warning"],
  };
  const [label, tone] = map[a.status] ?? [a.status, "info"];
  return <Badge tone={tone} title="Invoice advance">{label}</Badge>;
}

/** Merchant order drawer: "Get paid now" (invoice advance) card. Reads/creates via the merchant proxy. */
export function AdvanceCard({ refId, tick }: { refId: string; tick: number }) {
  const [v, reload, err] = usePoll<any>(() => merchant("GET", `orders/${refId}/financing`), [refId, tick]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  // Older API without invoice advances: treat as feature off rather than an error.
  if (err && /^Route .* not found/i.test(err)) return null;
  if (err) {
    return (
      <section>
        <h3>Invoice advance</h3>
        <Callout tone="neutral" title="Invoice advances are unavailable right now." action={<button type="button" className="btn sm" onClick={reload}>Retry</button>}>
          <span title={err}>We couldn&apos;t load the advance for this order. Try again in a moment.</span>
        </Callout>
      </section>
    );
  }
  if (!v) return <section aria-busy="true"><h3>Invoice advance</h3><div className="card card-b stack-8"><Skeleton w="70%" /><Skeleton /><Skeleton w="50%" /></div></section>;
  if (!v.enabled) return null;

  const o = v.offer;
  const q = o ?? v.quote;
  const request = async () => {
    setBusy(true); setMsg(undefined);
    try { await merchant("POST", `orders/${refId}/financing`, {}); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); reload(); }
  };

  // Not eligible and no advance in flight: nothing to offer, so stay out of the way.
  if (!o && !v.eligible) return null;

  const header = (title: string, badge?: ReactNode) => (
    <div className="row between" style={{ marginBottom: 10 }}><h3 style={{ margin: 0 }}>{title}</h3>{badge}</div>
  );
  const strong = (x: string | number) => <b className="tnum" style={{ color: "var(--text)" }}>{fmtAmount(x)} USDT</b>;
  /** Payout − fee = what the seller receives. Every list sums to its total line. */
  const breakdown = (
    <ul className="lines">
      <li><span>Order payout</span><Money v={q.face} /></li>
      <li><span>Lender&apos;s fee ({pctText(q.discountPct)})</span><Money v={-Number(q.lenderReturn)} /></li>
      <li className="total"><span>You receive in total</span><Money v={q.advance} /></li>
    </ul>
  );
  const split = (when: string) => (
    <div className="small text-2">{strong(q.sellerToday)} {when} · {strong(q.bond)} bond, returned after delivery</div>
  );

  if (!o) {
    return (
      <section>
        {header("Get paid now", <Badge tone="brand" dot={false}>Invoice advance</Badge>)}
        <div className="card card-b stack-16">
          <div className="adv-art" tabIndex={0} role="region" aria-label="How an invoice advance works (diagram)"><ReceivableFlow /></div>
          <p className="text-2" style={{ margin: 0 }}>
            Get {strong(q.sellerToday)} today instead of waiting for delivery. A lender pays you now; when the delivery is verified, the payout repays them.
            {Number(q.bond) > 0 && <> {fmtAmount(q.bond)} USDT is held as a bond and returned to you if the delivery checks out.</>}
          </p>
          {breakdown}
          {split("today")}
          {v.expired && <div className="xs muted">Your last request expired without a lender. You can ask again.</div>}
          {msg && <Callout tone="danger" title="Request didn't go through.">{msg}</Callout>}
          <div className="row between">
            <span className="xs muted">No cost if you don&apos;t take it.</span>
            <button type="button" className="btn primary" disabled={busy} onClick={request}>{busy ? <Icon name="loader" className="spin" /> : <Icon name="wallet" />} Request advance</button>
          </div>
        </div>
      </section>
    );
  }

  if (o.status === "offered") {
    return (
      <section>
        {header("Invoice advance", <Badge tone="info">Waiting for a lender</Badge>)}
        <div className="card card-b stack-12">
          <p className="text-2" style={{ margin: 0 }}>Your request is listed for approved lenders. When one accepts, {strong(o.sellerToday)} arrives in your wallet straight away.</p>
          {breakdown}
          {split("when a lender accepts")}
          <div className="xs muted row"><Icon name="clock" /> Open until <Timestamp ts={o.deadline} mode="time" /> ({timeLeft(o.deadline)}).</div>
        </div>
      </section>
    );
  }

  const note = (
    <dl className="dl">
      <dt>Lender</dt><dd>{o.lenderUrl ? <ExtLink href={o.lenderUrl}><span title={o.lender ?? undefined}>{LENDER_NAME}</span></ExtLink> : <span title={o.lender ?? undefined}>{LENDER_NAME}</span>}</dd>
      <dt>Receivable note</dt><dd><ExtLink href={o.tokenUrl}>Note for {o.ref}</ExtLink></dd>
      <dt>Advance paid</dt><dd>{o.fundTx ? <Hash value={o.fundTx} href={o.fundTxUrl} linkLabel="View advance transaction" /> : <span className="muted">—</span>}</dd>
      {o.closeTx && <><dt>Closed</dt><dd><Hash value={o.closeTx} href={o.closeTxUrl} linkLabel="View closing transaction" /></dd></>}
    </dl>
  );

  if (o.status === "funded") {
    return (
      <section>
        {header("Invoice advance", <Badge tone="brand">Advanced</Badge>)}
        <div className="card card-b stack-12">
          <Callout tone="success" title={`${fmtAmount(o.sellerToday)} USDT advanced to you`}>
            When the delivery is verified, the order payout repays the lender and your {fmtAmount(o.bond)} USDT bond comes back to you.
          </Callout>
          <ul className="lines">
            <li><span>Received today</span><Money v={o.sellerToday} /></li>
            <li><span>Bond, returned after delivery</span><Money v={o.bond} /></li>
            <li className="total"><span>You receive in total</span><Money v={o.advance} /></li>
          </ul>
          <div className="xs muted">The order payout of {fmtAmount(o.face)} USDT goes to the lender at delivery · fee {fmtAmount(o.lenderReturn)} USDT ({pctText(o.discountPct)}).</div>
          {note}
        </div>
      </section>
    );
  }

  // closed: repaid in full, or the bond covered a shortfall
  const repaid = o.status === "repaid";
  const total = Number(o.sellerToday) + Number(o.toSeller ?? 0);
  return (
    <section>
      {header("Invoice advance", repaid ? <Badge tone="success">Repaid in full</Badge> : <Badge tone="warning">Bond used</Badge>)}
      <div className="card card-b stack-12">
        {repaid
          ? <p className="text-2" style={{ margin: 0 }}>The delivery checked out. The payout repaid the lender and your bond was returned.</p>
          : <p className="text-2" style={{ margin: 0 }}>The delivery didn&apos;t fully check out{OUTCOME[o.outcome] ? ` (${OUTCOME[o.outcome]})` : ""}, so your bond went to the lender to cover the shortfall.</p>}
        <ul className="lines">
          <li><span>Advance received</span><Money v={o.sellerToday} /></li>
          <li><span>Bond returned</span><Money v={o.toSeller ?? 0} /></li>
          <li className="total"><span>Total received</span><Money v={total} /></li>
        </ul>
        <div className="xs muted">
          {repaid
            ? <>The order payout of {fmtAmount(o.toHolder)} USDT went to the lender · fee {fmtAmount(o.lenderReturn)} USDT ({pctText(o.discountPct)}).</>
            : <>The lender received {fmtAmount(o.toHolder)} USDT from the payout and your bond, against {fmtAmount(o.face)} USDT due.</>}
        </div>
        {note}
      </div>
    </section>
  );
}
