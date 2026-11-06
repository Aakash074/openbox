"use client";
import { use, useState } from "react";
import { MiniTop } from "../../components/Top";
import {
  Callout, Card, EmptyState, Icon, InspectionList, Money, ReceiptList, Skeleton, StatusBadge, Stepper, fmtAmount, fmtRelDay,
  type StepState,
} from "../../components/ui";
import { api, useEvents, usePoll } from "../../lib/api";

const PK = process.env.NEXT_PUBLIC_PUBLISHABLE_KEY ?? "pk_demo_openbox";
const STORE = process.env.NEXT_PUBLIC_STORE_URL;

type Step = { label: string; state: StepState; time?: number | null };

/** Progress for the buyer, including the refund / return branch. */
function buildSteps(o: any): Step[] {
  const at = (ev: string) => o.receipts?.find((r: any) => r.event === ev)?.at ?? null;
  const doneN = o.outcome ? 3 : ({ paid: 1, packed: 2, dispatched: 2, handed_over: 3, settled: 5 } as Record<string, number>)[o.status] ?? 0;
  const st = (n: number): StepState => (n < doneN ? "done" : n === doneN ? "current" : "upcoming");
  const base: Step[] = [
    { label: "Paid · held", state: st(0), time: at("OrderCreated") },
    { label: "Packed", state: st(1) },
    { label: "Out for delivery", state: st(2), time: at("Dispatched") },
  ];
  if (o.outcome === "mismatch") {
    const returned = ["returned", "returned_to_seller"].includes(o.status);
    return [...base,
      { label: "Wrong item found", state: "failed", time: at("HandedOver") },
      { label: "Refunded", state: "done", time: at("BuyerRefunded") ?? at("Settled") },
      { label: returned ? "Returned to seller" : "Return in progress", state: returned ? "done" : "current", time: at("ReturnToSender") }];
  }
  if (o.awaitingBuyer) return [...base, { label: "Damage found", state: "warn", time: at("HandedOver") }, { label: "Your decision", state: "current" }];
  if (o.outcome === "damaged") return [...base, { label: "Damage found", state: "warn", time: at("HandedOver") }, { label: "Settled · partial refund", state: "done", time: at("Settled") }];
  return [...base,
    { label: "At your door", state: o.outcome ? "done" : st(3), time: at("HandedOver") },
    { label: "Verified & settled", state: o.status === "settled" ? "done" : st(4), time: at("Settled") }];
}

export default function Buyer({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const tick = useEvents(ref);
  const [o, reload, err] = usePoll(() => api("GET", `/v1/orders/${ref}`), [ref, tick]);
  const [cat] = usePoll(() => api("GET", `/v1/catalog/${PK}`), []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const accept = async () => {
    setBusy(true);
    try { await api("POST", `/v1/orders/${ref}/accept-partial-refund`); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); reload(); }
  };
  const store = cat?.merchant ?? "Your order";
  const notFound = !o && err && /not found|404/i.test(err);
  const placed = o?.createdAt ?? o?.receipts?.[0]?.at;

  return (
    <>
      <MiniTop left={<span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><Icon name="store" /><span className="store truncate">{store}</span></span>} />
      <main className="page narrow">
        {notFound && (
          <div className="card mt-24">
            <EmptyState icon="search" title={<>We couldn&apos;t find order <span className="mono">{ref}</span></>}
              action={STORE ? <a className="btn" href={STORE}>Contact the store</a> : undefined}>
              Check the link in your order confirmation email. Order numbers look like <span className="mono">OB-1A2B3C</span>.
            </EmptyState>
          </div>
        )}
        {err && !notFound && !o && (
          <Callout tone="danger" title="We can't load your order right now" action={<button type="button" className="btn sm" onClick={reload}>Try again</button>}>Please check your connection and try again in a moment.</Callout>
        )}
        {!o && !err && (
          <div className="stack-24" aria-busy="true" aria-label="Loading order">
            <div className="stack-8"><Skeleton w={260} h={28} /><Skeleton w={180} /></div>
            <div className="card card-b"><Skeleton h={48} /></div>
            <div className="grid-main"><div className="card card-b stack-12"><Skeleton /><Skeleton /><Skeleton w="60%" /></div><div className="card card-b stack-12"><Skeleton /><Skeleton w="70%" /></div></div>
          </div>
        )}

        {o && (
          <div className="stack-24">
            <div className="page-header" style={{ marginBottom: 0, alignItems: "center" }}>
              <div>
                <h1>{o.product}</h1>
                <div className="sub">Order <span className="mono">{o.ref}</span>{placed ? <> · placed {fmtRelDay(placed)}</> : null}</div>
              </div>
              <div className="badges"><StatusBadge s={o.awaitingBuyer ? "awaiting_buyer" : o.status} />{o.outcome && <StatusBadge s={o.outcome} />}</div>
            </div>

            <div className="card card-b"><Stepper steps={buildSteps(o)} label="Order progress" /></div>

            {msg && <Callout tone="danger" title="That didn't go through">{msg}</Callout>}
            {["paid", "packed"].includes(o.status) && <Callout tone="info" icon="lock" title="Payment received and held">Your payment is held until the parcel is checked at your door. If it isn't what you ordered, you get your money back.</Callout>}
            {o.status === "dispatched" && <Callout tone="info" icon="truck" title={`${o.courier ?? "Your courier"} is on the way`}>When the parcel arrives, open it in front of your doorbell camera. The seller is paid only if it&apos;s what you ordered.</Callout>}
            {o.status === "handed_over" && !o.awaitingBuyer && !o.outcome && <Callout tone="info" icon="camera" title="Open the box at your door">Hold the item&apos;s label up to the doorbell camera so it can be checked.</Callout>}
            {o.awaitingBuyer && (
              <Callout tone="warning" title="Damage found at delivery"
                action={<button type="button" className="btn primary" disabled={busy} onClick={accept}>{busy && <Icon name="loader" className="spin" />} Accept {o.inspection.refundBps / 100}% partial refund</button>}>
                The inspector found damage. You can keep the item and get part of your payment back.
              </Callout>
            )}
            {o.outcome === "match" && <Callout tone="success" title="Delivered and verified">The parcel matched your order, so the seller has been paid. Enjoy!</Callout>}
            {o.outcome === "mismatch" && (
              <Callout tone="danger" title="This wasn't what you ordered">
                You&apos;ve been refunded <b><Money v={o.buyerRefunded} /></b>. {o.status === "returning" ? "The courier is taking the parcel back to the seller." : "The parcel has been returned to the seller."}
              </Callout>
            )}
            {o.outcome === "damaged" && !o.awaitingBuyer && (
              <Callout tone="warning" title="Damage found at delivery">
                You received a {o.inspection?.refundBps ? `${o.inspection.refundBps / 100}% ` : ""}partial refund (<b><Money v={o.buyerRefunded} /></b>); the rest went to the seller.
              </Callout>
            )}
            {o.status === "returned" && <Callout tone="success" title="Return received">The seller confirmed the returned item. Refunded <Money v={o.buyerRefunded} />.</Callout>}

            <div className="grid-main">
              <div className="stack-24">
                <Card title="Payment summary">
                  <ul className="lines">
                    <li><span>Item price</span><Money v={Number(o.amount) - Number(o.courierFee)} /></li>
                    <li><span>Delivery</span><Money v={o.courierFee} /></li>
                    <li className="total"><span>You paid</span><Money v={o.amount} /></li>
                  </ul>
                  <ul className="lines mt-12" style={{ borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
                    <li className={Number(o.sellerPaid) > 0 && !Number(o.buyerRefunded) ? "hl" : ""}><span>Paid to seller</span>{Number(o.sellerPaid) > 0 ? <Money v={o.sellerPaid} /> : <span className="muted">{o.outcome ? "—" : "Held until verified"}</span>}</li>
                    <li><span>Paid to courier</span>{Number(o.courierPaid) > 0 ? <Money v={o.courierPaid} /> : <span className="muted">—</span>}</li>
                    {Number(o.buyerRefunded) > 0 && <li className="hl"><span>Refunded to you</span><Money v={o.buyerRefunded} /></li>}
                  </ul>
                </Card>
                <Card flush title="Receipts" desc="Each step is recorded publicly so anyone can check it.">
                  <ReceiptList receipts={o.receipts} audience="buyer" />
                </Card>
              </div>
              <Card title="Inspection" desc={o.inspection ? "Checked by an independent inspector your doorbell hired." : undefined}>
                {o.inspection ? <InspectionList i={o.inspection} expected={o.serial} audience="buyer" /> : <EmptyState small icon="camera" title="Not inspected yet">Happens at your door when you open the box in front of the camera.</EmptyState>}
              </Card>
            </div>
            <p className="xs muted" style={{ textAlign: "center" }}>Amounts in USDT ({fmtAmount(1)} USDT ≈ 1 US dollar). Questions about your order? Contact {store === "Your order" ? "the store" : store}.</p>
          </div>
        )}
      </main>
    </>
  );
}
