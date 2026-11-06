"use client";
import Link from "next/link";
import { useState } from "react";
import { Top } from "../components/Top";
import { Badge, Callout, EmptyState, Icon, Money, PageHeader, Skeleton, SkeletonRows, StatusBadge, Tabs, Timestamp, fmtAmount, outcomeKey, type Tone } from "../components/ui";
import { CountUp } from "../components/motion";
import { EmptyBox, Offline, ProductArt, SearchParcel } from "../components/art";
import { api, useEvents, usePoll } from "../lib/api";
import { StatusStrip, householdSub, type Owner } from "./shared";

type Delivery = {
  ref: string; product: string | null; merchant: string | null; status: string; outcome: string | null; amount: string; courierFee: string;
  buyerRefunded: string; courier: string | null; awaitingBuyer: boolean; decisionDeadline: number | null; returnDeadline: number | null;
  refundApproval: { simulated: boolean; txHash: string | null } | null;
  inspection: { outcome: string; refundBps: number; inspectorName?: string; amountUsd: number | null } | null;
  createdAt: number; handedOverAt: number | null; settledAt: number | null;
};
type Overview = {
  household: { name: string; door: string }; owner: Owner; deliveries: Delivery[];
  totals: { deliveries: number; onTheWay: number; atDoor: number; refunded: string; refunds: number; inspections: number; inspectionSpendUsd: number; inspectionSpendTodayUsd: number; pendingApprovals: number };
};

/** Delivery state from the household's side of the door. */
const STAGE: Record<string, [string, Tone, boolean?]> = {
  paid: ["Preparing", "info"], packed: ["Preparing", "info"], dispatched: ["On the way", "info", true], handed_over: ["Inspecting", "info", true],
  settled: ["Delivered", "success"], returning: ["Return in progress", "warning", true], returned: ["Returned", "neutral"], returned_to_seller: ["Returned", "neutral"],
  cancelled: ["Cancelled", "neutral"],
};
function Stage({ d }: { d: Delivery }) {
  if (d.awaitingBuyer) return <Badge tone="warning" live>Refund offered</Badge>;
  const [label, tone, live] = STAGE[d.status] ?? [d.status, "neutral" as Tone];
  return <Badge tone={tone} live={live}>{label}</Badge>;
}

type Filter = "all" | "way" | "door" | "done" | "refunds";
const FILTERS: Record<Filter, (d: Delivery) => boolean> = {
  all: () => true,
  way: (d) => ["paid", "packed", "dispatched"].includes(d.status),
  door: (d) => d.status === "handed_over",
  done: (d) => ["settled", "returned", "returned_to_seller", "returning"].includes(d.status),
  refunds: (d) => Number(d.buyerRefunded) > 0,
};

/** Inspection verdict to show: the settled outcome, or the inspector's finding while the household decides. */
const verdictKey = (d: Delivery) => (d.outcome ? outcomeKey(d) : d.inspection?.outcome);

function RefundCell({ d }: { d: Delivery }) {
  if (!(Number(d.buyerRefunded) > 0)) return <span className="muted">—</span>;
  return (
    <div className="h-refund">
      <Money v={d.buyerRefunded} cur={null} strong />
      {d.outcome === "damaged" && d.refundApproval && (d.refundApproval.simulated
        ? <span className="cell-sub">Simulated approval</span>
        : <span className="cell-sub">Approved with World ID</span>)}
      {d.outcome === "mismatch" && <span className="cell-sub">Wrong item, full refund</span>}
    </div>
  );
}

export default function Household() {
  const tick = useEvents();
  const [ov, reload, err] = usePoll<Overview>(() => api("GET", "/v1/household/overview"), [tick]);
  const [agent] = usePoll<any>(() => api("GET", "/v1/agent/status"), [tick]);
  const [filter, setFilter] = useState<Filter>("all");
  const loading = ov === undefined && !err;
  const down = ov === undefined && !!err;
  const list = ov?.deliveries ?? [];
  const shown = list.filter(FILTERS[filter]);
  const deciding = list.filter((d) => d.awaitingBuyer);
  const t = ov?.totals;
  const count = (f: Filter) => (ov ? list.filter(FILTERS[f]).length : null);

  return (
    <>
      <Top role="household" />
      <main className="page">
        <PageHeader title="Deliveries" sub={householdSub(ov?.household.door)}
          actions={<Link className="btn primary" href="/kiosk"><Icon name="doorbell" /> Open the doorbell</Link>} />

        {err && ov && (
          <div style={{ marginBottom: 24 }}>
            <Callout tone="danger" title="Can't refresh your deliveries" action={<button type="button" className="btn sm" onClick={reload}>Retry</button>}>{err}. Figures below may be out of date.</Callout>
          </div>
        )}

        {down ? (
          <div className="card">
            <EmptyState art={<Offline />} title="Deliveries unavailable" action={<button type="button" className="btn primary" onClick={reload}><Icon name="return" /> Try again</button>}>
              We can&apos;t reach OpenBox right now. Your payments stay held until each parcel is checked at your door.
            </EmptyState>
          </div>
        ) : (
          <div className="stack-24">
            <StatusStrip policy={agent?.policy} owner={ov?.owner} pending={t?.pendingApprovals} loading={loading} />

            {deciding.map((d) => (
              <div key={d.ref} className="h-attn" role="status">
                <span className="ic" aria-hidden="true"><Icon name="bell" /></span>
                <div className="grow">
                  <div className="t">Damage found on {d.product ?? d.ref}: a partial refund is waiting</div>
                  <div className="b">
                    {d.inspection?.refundBps ? `${d.inspection.refundBps / 100}% back if you keep the item. ` : ""}
                    Your agent only accepts it after you approve with World ID{d.decisionDeadline ? <> (by <Timestamp ts={d.decisionDeadline} mode="time" />)</> : null}.
                  </div>
                </div>
                <Link className="btn sm primary" href={`/buyer/${d.ref}`}>Review</Link>
              </div>
            ))}

            <div className="card kpi-group grid4">
              <div className="kpi"><div className="kpi-label">Deliveries</div><div className="kpi-value">{t ? <CountUp value={t.deliveries} decimals={0} /> : <Skeleton w={48} h={28} />}</div><div className="kpi-sub">{t ? `${t.onTheWay} on the way · ${t.atDoor} at the door` : " "}</div></div>
              <div className="kpi"><div className="kpi-label">Refunds received</div><div className="kpi-value">{t ? <><CountUp value={t.refunded} /><span className="cur">USDT</span></> : <Skeleton w={90} h={28} />}</div><div className="kpi-sub">{t ? `${t.refunds} order${t.refunds === 1 ? "" : "s"}` : " "}</div></div>
              <div className="kpi"><div className="kpi-label">Inspections paid</div><div className="kpi-value">{t ? <CountUp value={t.inspections} decimals={0} /> : <Skeleton w={48} h={28} />}</div><div className="kpi-sub">{t ? `${fmtAmount(t.inspectionSpendUsd)} USDC by your agent` : " "}</div></div>
              <div className="kpi"><div className="kpi-label">Right item, first time</div><div className="kpi-value">{ov ? <CountUp value={list.filter((d) => d.inspection?.outcome === "match").length} decimals={0} /> : <Skeleton w={48} h={28} />}</div><div className="kpi-sub">Serial matched at your door</div></div>
            </div>

            <section className="card h-orders">
              <div className="m-toolbar">
                <h2>Parcels for this door</h2>
                <Tabs<Filter> className="seg" label="Filter deliveries" value={filter} onChange={setFilter}
                  items={[
                    { id: "all", label: "All", count: count("all") },
                    { id: "way", label: "On the way", count: count("way") },
                    { id: "door", label: "At the door", count: count("door") },
                    { id: "done", label: "Delivered", count: count("done") },
                    { id: "refunds", label: "Refunds", count: count("refunds") },
                  ]} />
              </div>
              <div className="table-wrap lg-only">
                <table className="data">
                  {(loading || shown.length > 0) && (
                    <thead><tr><th>Parcel</th><th>Status</th><th>Inspection</th><th className="num">Paid (USDT)</th><th className="num">Refunded</th><th>Delivered</th><th><span className="sr-only">Order page</span></th></tr></thead>
                  )}
                  <tbody>
                    {loading && <SkeletonRows rows={4} cols={7} />}
                    {ov && shown.length === 0 && <tr><td colSpan={7} style={{ height: "auto" }}><Empty any={list.length > 0} onAll={() => setFilter("all")} /></td></tr>}
                    {shown.map((d) => (
                      <tr key={d.ref}>
                        <td style={{ minWidth: 240 }}>
                          <div className="m-item">
                            <ProductArt product={d.product} variant="thumb" size={32} />
                            <div style={{ minWidth: 0 }}><div className="name">{d.product}</div><div className="cell-sub"><span className="mono">{d.ref}</span> · {d.merchant ?? "Store"}</div></div>
                          </div>
                        </td>
                        <td><Stage d={d} /></td>
                        <td>{d.inspection ? <StatusBadge s={verdictKey(d)} /> : <span className="muted">{["paid", "packed", "dispatched"].includes(d.status) ? "At delivery" : "—"}</span>}</td>
                        <td className="num"><Money v={d.amount} cur={null} /></td>
                        <td className="num"><RefundCell d={d} /></td>
                        <td className="xs muted nowrap">{d.handedOverAt ? <Timestamp ts={d.handedOverAt} /> : "—"}</td>
                        <td className="num"><Link className="btn sm ghost" href={`/buyer/${d.ref}`} aria-label={`Track ${d.ref}`}>Track <Icon name="chevron-right" /></Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="list lt-lg h-list">
                {loading && [0, 1, 2].map((i) => <li key={i}><div className="m-li"><Skeleton w={40} h={40} r={10} /><div className="stack-8"><Skeleton w="60%" /><Skeleton w="40%" /></div></div></li>)}
                {ov && shown.length === 0 && <li><Empty small any={list.length > 0} onAll={() => setFilter("all")} /></li>}
                {shown.map((d) => (
                  <li key={d.ref}>
                    <Link className="h-li" href={`/buyer/${d.ref}`}>
                      <ProductArt product={d.product} variant="thumb" size={40} />
                      <div style={{ minWidth: 0 }} className="grow">
                        <div className="top"><span className="prod truncate">{d.product}</span><Money v={d.amount} strong /></div>
                        <div className="top" style={{ marginTop: 2 }}><span className="xs muted"><span className="mono">{d.ref}</span> · {d.merchant ?? "Store"}</span>{Number(d.buyerRefunded) > 0 && <span className="xs h-back">+{fmtAmount(d.buyerRefunded)} back</span>}</div>
                        <div className="badges mt-8"><Stage d={d} />{d.inspection && <StatusBadge s={verdictKey(d)} />}</div>
                      </div>
                      <Icon name="chevron-right" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            {/* Hosted demo: every parcel handed over at the demo doorbell belongs to this sample household. */}
            <p className="xs muted h-foot"><Icon name="flask" /> Demo account: every parcel delivered to the demo doorbell is shown as this household&apos;s delivery.</p>
          </div>
        )}
      </main>
    </>
  );
}

function Empty({ any, onAll, small }: { any: boolean; onAll: () => void; small?: boolean }) {
  if (any) return <EmptyState small art={<SearchParcel />} title="No parcels in this view" action={<button type="button" className="btn sm" onClick={onAll}>Show all</button>}>Try another filter.</EmptyState>;
  return (
    <EmptyState small={small} art={<EmptyBox />} title="No deliveries yet"
      action={process.env.NEXT_PUBLIC_STORE_URL ? <a className="btn" href={process.env.NEXT_PUBLIC_STORE_URL} target="_blank" rel="noreferrer">Shop the demo store <Icon name="external" /></a> : undefined}>
      Orders paid with OpenBox checkout and delivered to this door show up here.
    </EmptyState>
  );
}
