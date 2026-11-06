"use client";
import { use, type ReactNode } from "react";
import { MiniTop } from "../../components/Top";
import {
  Badge, Callout, Card, outcomeKey, EmptyState, Icon, InspectionList, Money, ReceiptList, Skeleton, StatusBadge, Stepper, fmtAmount, fmtRelDay,
  formatSerialLike, sameSerial, type StepState,
} from "../../components/ui";
import { api, useEvents, usePoll } from "../../lib/api";
import { RefundApproval, useNow } from "../../components/approval";
import { Inspection, Parcel, ProductArt, SearchParcel, VerdictCheck } from "../../components/art";
import { useFlash } from "../../components/motion";
import "../../styles/buyer.css";

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
  if (o.outcome === "timeout" && o.inspection?.outcome === "damaged")
    return [...base, { label: "Damage found", state: "warn", time: at("HandedOver") }, { label: "Settled · not accepted", state: "done", time: at("Settled") }];
  if (o.outcome === "damaged") return [...base, { label: "Damage found", state: "warn", time: at("HandedOver") }, { label: "Settled · partial refund", state: "done", time: at("Settled") }];
  return [...base,
    { label: "At your door", state: o.outcome ? "done" : st(3), time: at("HandedOver") },
    { label: "Verified & settled", state: o.status === "settled" ? "done" : st(4), time: at("Settled") }];
}

/** One plain sentence under the product name: where the order is and what happens next. */
function statusSentence(o: any, nowS: number, store: string): ReactNode {
  const courier = o.courier ?? "your courier";
  if (o.awaitingBuyer) return o.decisionDeadline && o.decisionDeadline <= nowS
    ? <>The time to accept a partial refund has passed. The seller is being paid and you keep the item.</>
    : <><b>Damage found at your door.</b> Decide whether to accept a partial refund.</>;
  if (o.outcome === "match") return <><b>Delivered and verified.</b> Enjoy your {String(o.product).split(" ").slice(0, 2).join(" ")}!</>;
  if (o.outcome === "mismatch") return o.status === "returning"
    ? <><b>Refunded <Money v={o.buyerRefunded} />.</b> It wasn&apos;t what you ordered; the courier is taking it back.</>
    : <><b>Refunded <Money v={o.buyerRefunded} />.</b> The wrong item went back to the seller.</>;
  if (o.outcome === "damaged") return <><b>Partial refund of <Money v={o.buyerRefunded} /> settled.</b> You keep the item.</>;
  if (o.outcome === "timeout" && o.inspection?.outcome === "damaged") return <>Partial refund not accepted in time. The seller was paid and you kept the item.</>;
  if (o.status === "returned") return <><b>Return received.</b> You&apos;ve been refunded <Money v={o.buyerRefunded} />.</>;
  switch (o.status) {
    case "paid": return <><b>Payment held safely.</b> {store === "Your order" ? "The store" : store} is preparing your order.</>;
    case "packed": return <><b>Packed</b> and waiting for the courier. Your payment is still held.</>;
    case "dispatched": return <><b>Arriving with {courier}.</b> The seller is paid only if it&apos;s what you ordered.</>;
    case "handed_over": return <><b>{o.courier ?? "The courier"} is at your door.</b> Open the box in front of the doorbell camera.</>;
    case "settled": return <><b>Settled.</b> Every payment is on the receipts below.</>;
    default: return null;
  }
}

/** Inspection: illustration with the serial read overlaid, then the detail list. */
function InspectionVisual({ i, expected, product }: { i: any; expected?: string; product?: string }) {
  const read = i.serialRead ? formatSerialLike(i.serialRead, expected) : null;
  const match = sameSerial(i.serialRead, expected);
  const chip = i.outcome === "mismatch" || (!match && expected)
    ? <span className="insp-chip bad"><Icon name="x-circle" /> {read ? <>Serial doesn&apos;t match</> : <>Serial not on the label</>}</span>
    : i.outcome === "damaged"
      ? <span className="insp-chip warn"><Icon name="alert" /> Serial matches · {String(i.damage ?? "minor")} damage</span>
      : <span className="insp-chip ok"><Icon name="check-circle" /> Serial matches the order</span>;
  return (
    <div className="insp-vis">
      {i.outcome === "mismatch" ? <Parcel variant="wrong" size={150} title="The parcel held a different item" /> : <Inspection serial={read ?? expected} product={product} size={260} title={`Doorbell camera reading serial ${read ?? ""}`} />}
      {chip}
    </div>
  );
}

/** Where the money went; flashes when a payout lands (mounted only once the order has loaded). */
function Payouts({ o }: { o: any }) {
  const flash = useFlash(`${o.sellerPaid}|${o.courierPaid}|${o.buyerRefunded}`);
  return (
    <ul className={`lines mt-12 ${flash ? "flash" : ""}`} style={{ borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
      <li className={Number(o.sellerPaid) > 0 && !Number(o.buyerRefunded) ? "hl" : ""}><span>Paid to seller</span>{Number(o.sellerPaid) > 0 ? <Money v={o.sellerPaid} /> : <span className="muted row" style={{ gap: 6 }}>{o.outcome ? "—" : <><Icon name="lock" /> Held until verified</>}</span>}</li>
      <li><span>Paid to courier</span>{Number(o.courierPaid) > 0 ? <Money v={o.courierPaid} /> : <span className="muted">—</span>}</li>
      {Number(o.buyerRefunded) > 0 && <li className="hl refund-line"><span>Refunded to you</span><Money v={o.buyerRefunded} /></li>}
    </ul>
  );
}

function Outcome({ tone, art, title, children }: { tone: "success" | "refund" | "neutral"; art: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className={`outcome ${tone} fade-in`} role="status">
      {art}
      <div className="grow" style={{ minWidth: 0 }}><div className="outcome-title">{title}</div>{children && <div className="outcome-body">{children}</div>}</div>
    </div>
  );
}

export default function Buyer({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const tick = useEvents(ref);
  const [o, reload, err] = usePoll(() => api("GET", `/v1/orders/${ref}`), [ref, tick]);
  const [cat] = usePoll(() => api("GET", `/v1/catalog/${PK}`), []);
  const nowS = useNow();
  const store = cat?.merchant ?? "Your order";
  const notFound = !o && err && /not found|404/i.test(err);
  const placed = o?.createdAt ?? o?.receipts?.[0]?.at;
  const storeName = store === "Your order" ? "the store" : store;
  const share = o ? Number(o.amount) - Number(o.courierFee) : 0;
  const bps = Number(o?.inspection?.refundBps ?? 0);
  const handedAt = o?.receipts?.find((r: any) => r.event === "HandedOver")?.at ?? null;

  return (
    <>
      <MiniTop left={<span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><Icon name="store" /><span className="store truncate">{store}</span></span>} />
      <main className="page narrow lg-type buyer">
        {notFound && (
          <div className="card mt-24">
            <EmptyState art={<SearchParcel />} title={<>We couldn&apos;t find order <span className="mono">{ref}</span></>}
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
            <div className="card bh">
              <div className="bh-top"><Skeleton w={96} h={96} r={16} /><div className="grow stack-8"><Skeleton w={120} h={12} /><Skeleton w={240} h={28} /><Skeleton w="70%" h={16} /></div></div>
              <div className="bh-steps"><Skeleton h={44} /></div>
            </div>
            <div className="grid-main"><div className="card card-b stack-12"><Skeleton /><Skeleton /><Skeleton w="60%" /></div><div className="card card-b stack-12"><Skeleton h={120} r={12} /><Skeleton w="70%" /></div></div>
          </div>
        )}

        {o && (
          <div className="stack-24">
            <section className="card bh" aria-label="Order status">
              <div className="bh-top">
                <div className="bh-art"><ProductArt product={o.product} title={o.product} /></div>
                <div className="bh-main">
                  <div className="bh-meta"><span>Order <span className="mono">{o.ref}</span></span>{placed ? <><span className="bh-sep" aria-hidden="true">·</span><span className="bh-placed">placed {fmtRelDay(placed)}</span></> : null}</div>
                  <h1>{o.product}</h1>
                  <div className="bh-sentence" aria-live="polite">{statusSentence(o, nowS, store)}</div>
                </div>
                <div className="bh-badges"><StatusBadge s={o.awaitingBuyer ? "awaiting_buyer" : o.status} />{o.outcome && <StatusBadge s={outcomeKey(o)} />}</div>
              </div>
              <div className="bh-steps"><Stepper steps={buildSteps(o)} label="Order progress" /></div>
            </section>

            {["paid", "packed"].includes(o.status) && <Callout tone="info" icon="lock" title="Payment received and held">Your payment is held until the parcel is checked at your door. If it isn&apos;t what you ordered, you get your money back.</Callout>}
            {o.status === "dispatched" && <Callout tone="info" icon="truck" title={`${o.courier ?? "Your courier"} is on the way`}>When the parcel arrives, open it in front of your doorbell camera. The seller is paid only if it&apos;s what you ordered.</Callout>}
            {o.status === "handed_over" && !o.awaitingBuyer && !o.outcome && <Callout tone="info" icon="camera" title="Open the box at your door">Hold the item&apos;s label up to the doorbell camera so it can be checked.</Callout>}
            {o.awaitingBuyer && (o.decisionDeadline && o.decisionDeadline <= nowS ? (
              <Callout tone="neutral" icon="clock" title="Time to accept the partial refund has passed">
                Nothing was refunded. The seller is being paid in full and you keep the item. You can still return it within {Math.round(Number(o.returnWindowS ?? 604800) / 86400)} days for a refund.
              </Callout>
            ) : (
              <RefundApproval orderRef={o.ref} refundPct={bps ? bps / 100 : undefined} refundAmount={bps ? (share * bps) / 10000 : undefined}
                deadline={o.decisionDeadline} windowStart={handedAt} returnWindowS={o.returnWindowS} onSettled={reload} />
            ))}
            {o.outcome === "match" && <Outcome tone="success" art={<VerdictCheck size={48} />} title="The item matched your order">
                The serial on the item was checked at your door, so the seller was paid <Money v={o.sellerPaid} /> and the courier <Money v={o.courierPaid} />.
              </Outcome>}
            {o.outcome === "mismatch" && (
              <Outcome tone="refund" art={<Parcel variant="wrong" size={56} />} title={<>This wasn&apos;t what you ordered. You&apos;ve been refunded <span className="amt"><Money v={o.buyerRefunded} /></span></>}>
                {o.status === "returning" ? "The courier is taking the parcel back to the seller." : "The parcel has been returned to the seller."}
              </Outcome>
            )}
            {o.outcome === "damaged" && !o.awaitingBuyer && (
              <Outcome tone="refund" art={<VerdictCheck tone="refund" size={48} />} title={<>Partial refund settled: <span className="amt"><Money v={o.buyerRefunded} /></span></>}>
                {o.refundApproval?.simulated ? (
                  <>Damage was found at delivery. The {bps ? `${bps / 100}% ` : ""}refund was approved with a simulated approval (demo, no World ID proof) and you kept the item; the rest went to the seller.
                    <span className="bh-sim-badge"><Badge tone="neutral" dot={false}><Icon name="flask" /> Simulated approval · demo only</Badge></span></>
                ) : o.refundApproval ? (
                  <>Damage was found at delivery. You approved a {bps ? `${bps / 100}% ` : ""}refund with World ID and kept the item; the rest went to the seller.</>
                ) : (
                  <>Damage was found at delivery. You accepted a {bps ? `${bps / 100}% ` : ""}refund and kept the item; the rest went to the seller.</>
                )}
              </Outcome>
            )}
            {o.outcome === "timeout" && o.inspection?.outcome === "damaged" && (
              <Callout tone="neutral" icon="clock" title="Partial refund not accepted in time">
                The seller was paid in full and you kept the item.{" "}
                {o.returnDeadline && o.returnDeadline > Date.now() / 1000
                  ? <>You can still return it for a refund of the item price until <b>{fmtRelDay(o.returnDeadline)}</b>: contact {storeName} to arrange it, and the parcel is checked against its serial when it&apos;s handed back.</>
                  : <>The return window for this order has closed.</>}
              </Callout>
            )}
            {o.status === "returned" && <Outcome tone="success" art={<VerdictCheck size={48} />} title="Return received">The seller confirmed the returned item. Refunded <Money v={o.buyerRefunded} />.</Outcome>}

            <div className="grid-main">
              <div className="stack-24">
                <Card title="Payment summary" footer={<>Amounts in USDT, a digital dollar ({fmtAmount(1)} USDT ≈ 1 US dollar).</>}>
                  <ul className="lines">
                    <li><span>Item price</span><Money v={share} /></li>
                    <li><span>Delivery</span><Money v={o.courierFee} /></li>
                    <li className="total"><span>You paid</span><Money v={o.amount} /></li>
                  </ul>
                  <Payouts o={o} />
                </Card>
                <Card flush title="Receipts" desc="Each step is recorded publicly so anyone can check it.">
                  <ReceiptList receipts={o.receipts} audience="buyer" sellerPaid={o.sellerPaid} />
                </Card>
              </div>
              <Card title="Inspection" desc={o.inspection ? "Checked by an independent inspector your doorbell hired." : undefined}>
                {o.inspection ? (
                  <div className="fade-in"><InspectionVisual i={o.inspection} expected={o.serial} product={o.product} /><InspectionList i={o.inspection} expected={o.serial} audience="buyer" /></div>
                ) : (
                  <div className="insp-empty">
                    <Inspection size={180} serial={o.serial ?? undefined} product={o.product} />
                    <div className="t">Not inspected yet</div>
                    <div className="b">Happens at your door: open the box in front of the doorbell camera and it reads the serial on the item.</div>
                  </div>
                )}
              </Card>
            </div>
            <p className="xs muted" style={{ textAlign: "center" }}>Questions about your order? Contact {storeName}.</p>
          </div>
        )}
      </main>
    </>
  );
}
