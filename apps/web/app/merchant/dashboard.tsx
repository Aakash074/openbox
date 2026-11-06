"use client";
import { useId, useState, type ReactNode } from "react";
import { Top } from "../components/Top";
import {
  Badge, Callout, Card, CodeBlock, hasAmount, CopyButton, EmptyState, ExtLink, Field, Hash, Icon, Money, PageHeader, Stepper, Tabs,
  InspectionList, ReceiptList, Skeleton, hashscan, sameSerial, formatSerialLike, inspectorName, fmtGas, SkeletonRows, StatusBadge, Timestamp, fmtAmount, Dialog, Drawer, QR, outcomeKey,
  type IconName, type StepState,
} from "../components/ui";
import { CountUp, useFlash } from "../components/motion";
import { AuditLog, EmptyBox, MoneySplit, Offline, Parcel, ProductArt, ReceivableFlow, SearchParcel, Webhook as WebhookArt } from "../components/art";
import { api, merchant, useEvents, usePoll } from "../lib/api";
import { CHECKOUT_SNIPPET_HTML } from "../lib/snippets";
import { AdvanceBadge, AdvanceCard } from "../components/finance";
import { APPROVAL_LABEL, APPROVAL_OPEN, approvalTone } from "../components/approval";
import "../styles/merchant.css";

const STICKERS = ["SN-AX1-7731-0042", "SN-PBP-5520-0007", "SN-LT11-3304-0019", "SN-AX1-7731-1001"];
const DEMO_COURIER = process.env.NEXT_PUBLIC_DEMO_COURIER ?? "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955";
const SNIPPETS: Record<string, string> = {
  HTML: CHECKOUT_SNIPPET_HTML,
  React: `import { OpenBox } from "openbox-checkout";
import { useEffect, useRef } from "react";

export function Checkout({ sku }: { sku: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    OpenBox.mount(el.current!, {
      publishableKey: "pk_demo_openbox",
      sku,
      onPaid: ({ ref }) => markPaid(ref),
    });
  }, [sku]);
  return <div ref={el} />;
}`,
  Webhooks: `// POST /webhooks/openbox  (signed: X-OpenBox-Signature: t=…,v1=HMAC-SHA256)
//   order.paid · order.dispatched · order.handed_over
//   courier.paid · order.settled · seller.paid
//   buyer.refunded · order.return_to_sender · order.return_refunded
const [t, v1] = parse(req.headers["x-openbox-signature"]);
const ok = hmacSha256(secret, \`\${t}.\${rawBody}\`) === v1;`,
};
/** Webhook event → what it means for the merchant. The raw event name stays visible underneath. */
const HOOK_LABEL: Record<string, string> = {
  "order.paid": "Payment received", "order.dispatched": "Out for delivery", "order.handed_over": "Delivered to buyer",
  "courier.paid": "Courier paid", "order.settled": "Order settled", "seller.paid": "Payout sent to you",
  "buyer.refunded": "Buyer refunded", "order.return_to_sender": "Return started", "order.return_refunded": "Return refunded",
  "order.returned": "Return received", "order.cancelled": "Order cancelled",
};
const hookLabel = (e: string) => HOOK_LABEL[e] ?? e.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type Section = "orders" | "advances" | "inspections" | "developers";
type Filter = "all" | "needs" | "transit" | "settled" | "refunds";
const NEEDS = ["paid", "packed", "returning"];
const FILTERS: Record<Filter, (o: any) => boolean> = {
  all: () => true,
  needs: (o) => NEEDS.includes(o.status),
  transit: (o) => ["dispatched", "handed_over"].includes(o.status),
  settled: (o) => o.status === "settled",
  refunds: (o) => Number(o.buyerRefunded) > 0 || ["returning", "returned", "returned_to_seller"].includes(o.status),
};
const SECTION_TITLE: Record<Section, string> = { orders: "Orders", advances: "Get paid early", inspections: "Inspections", developers: "Developers" };
const SECTION_SUB: Record<Section, string> = {
  orders: "Checkout with verified release", advances: "Invoice advances against your delivery payouts",
  inspections: "Verdicts on your orders, logged on Hedera", developers: "Checkout SDK, keys and webhooks",
};
/** Order states an advance can be requested in (paid and not yet delivered). */
const ADVANCEABLE = ["paid", "packed", "dispatched"];
const NEED_VERB: Record<string, string> = { paid: "to pack", packed: "needs a courier", returning: "return to receive" };

/** What reached (or will reach) the merchant for one order. */
const netToSeller = (o: any) => (o.advance && o.advance.status !== "offered" ? Number(o.advance.received ?? 0) : Number(o.sellerPaid ?? 0));

/** Merchant app: one client component behind /merchant, /merchant/advances, /merchant/inspections and /merchant/developers. */
export function MerchantDashboard({ section }: { section: Section }) {
  const tick = useEvents();
  const [stats, reloadStats, statsErr] = usePoll(() => merchant("GET", "stats"), [tick]);
  const [orders, reloadOrders, err] = usePoll<any[]>(() => merchant("GET", "orders"), [tick]);
  // The audit log is only read on the Inspections page.
  const [hcs, reloadHcs, hcsErr] = usePoll(() => (section === "inspections" ? api("GET", "/v1/hcs/log") : Promise.resolve(undefined)), [tick, section]);
  const tab = section;
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string>();
  const [poolOpen, setPoolOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [form, setForm] = useState<Record<string, { serial?: string; courier?: string; payout?: string }>>({});
  const [worldReq, setWorldReq] = useState<Record<string, any>>({});
  const [pool, setPool] = useState("");
  const [allHooks, setAllHooks] = useState(false);
  const [snippet, setSnippet] = useState("HTML");
  const [kpiPage, setKpiPage] = useState(0);

  useEvents(undefined, (e) => {
    if (e.type === "world.request" && e.ref) {
      const key = e.data?.purpose === "approve_refund" ? `${e.ref}:approval` : e.ref!; // keep courier checks and refund approvals apart
      setWorldReq((w) => ({ ...w, [key]: { ...(w[key] ?? {}), purpose: e.data?.purpose, status: e.data?.status, note: e.data?.note, simulated: e.data?.simulated ?? w[key]?.simulated, at: e.at } }));
    }
  });

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setMsg(undefined);
    try { await fn(); return true; } catch (e) { setMsg((e as Error).message); return false; } finally { setBusy(undefined); reloadOrders(); reloadStats(); }
  };
  const f = (ref: string) => form[ref] ?? {};
  const setF = (ref: string, p: object) => setForm((x) => ({ ...x, [ref]: { ...x[ref], ...p } }));

  const list = (orders ?? []).filter((o) => o.status !== "created");
  const t = stats?.totals;
  const statsLoading = stats === undefined && !statsErr;
  const ordersLoading = orders === undefined && !err;
  /** Orders never loaded: show one clear "unavailable" state instead of skeletons and empty shells. */
  const ordersDown = orders === undefined && !!err;
  const relayer = stats?.relayer;
  const current = list.find((o) => o.ref === open);
  const refByOrderId = Object.fromEntries(list.map((o) => [o.orderId?.toLowerCase(), o.ref]));
  const merchantName = stats?.merchant?.name;
  // Lender fees on advanced orders: order payout (amount − courier fee) minus the advance.
  const advanceFees = list.filter((o) => o.advance && o.advance.status !== "offered")
    .reduce((s, o) => s + Math.max(0, Number(o.amount) - Number(o.courierFee) - Number(o.advance.advance)), 0);

  // Gross volume, its sub-line and both sparklines all come from the same orders list.
  const byTime = [...list].sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0));
  const gross = orders ? list.reduce((s, o) => s + Number(o.amount || 0), 0) : undefined;
  const settledN = list.filter((o) => o.status === "settled").length;
  const grossSeries = cumulative(byTime.map((o) => Number(o.amount || 0)));
  const paidSeries = cumulative(byTime.map(netToSeller));
  const counts = Object.fromEntries((Object.keys(FILTERS) as Filter[]).map((k) => [k, list.filter(FILTERS[k]).length])) as Record<Filter, number>;
  const shown = list.filter(FILTERS[filter]);
  const needs = list.filter(FILTERS.needs);

  const openPool = () => { const bal = Math.floor(Number(stats?.sellerBalance ?? 0)); setPool(bal >= 1 ? String(Math.min(5, bal)) : ""); setMsg(undefined); setPoolOpen(true); };
  const retryAll = () => { reloadOrders(); reloadStats(); };

  return (
    <>
      <Top role="merchant" account={merchantName ?? undefined} />
      <main className="page">
        <PageHeader
          title={SECTION_TITLE[section]}
          sub={<span className="m-sub">{merchantName ?? (statsErr ? null : <Skeleton w={140} />)}{(merchantName || statsErr) && <>{merchantName && <span className="dot-sep" aria-hidden="true" />}{SECTION_SUB[section]}</>}</span>}
          actions={section === "orders" && <>
            {ordersDown && !!statsErr
              ? <button type="button" className="btn m-export" disabled aria-label="Export CSV" title="Export CSV is unavailable while the service is down"><Icon name="download" /><span className="m-label">Export CSV</span></button>
              : <a className="btn m-export" href="/api/merchant/export.csv" download aria-label="Export CSV" title="Export CSV"><Icon name="download" /><span className="m-label">Export CSV</span></a>}
            <button type="button" className="btn primary" onClick={openPool} disabled={ordersDown && !!statsErr}><Icon name="plus" /> Top up refund pool</button>
          </>}
        />

        {(msg || (!ordersDown && (err || statsErr))) && (
          <div className="stack-16" style={{ marginBottom: 24 }}>
            {msg && <Callout tone="danger" title="That action didn't go through" action={<button type="button" className="btn sm" onClick={() => setMsg(undefined)}>Dismiss</button>}>{msg}</Callout>}
            {!ordersDown && (err || statsErr) && <Callout tone="danger" title="Can't reach the OpenBox API" action={<button type="button" className="btn sm" onClick={retryAll}>Retry</button>}>{err ?? statsErr}. Figures below may be out of date.</Callout>}
          </div>
        )}

        {tab !== "developers" && ordersDown && (
          <div className="card">
            <EmptyState art={<Offline />} title="Orders unavailable"
              action={<button type="button" className="btn primary" onClick={retryAll}><Icon name="return" /> Try again</button>}>
              We can&apos;t reach the OpenBox API right now, so orders, payouts and webhooks can&apos;t load. Nothing is lost: payments stay held until each delivery is verified.
            </EmptyState>
          </div>
        )}

        {tab === "orders" && !ordersDown && (
          <>
            <div className="card kpi-group m-kpis" tabIndex={0} role="region" aria-label="Key figures (swipe for more)" onScroll={(e) => { const el = e.currentTarget; setKpiPage(Math.round(el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth) * 3)); }}>
              <Kpi label="Gross volume" value={gross} loading={ordersLoading}
                sub={orders ? `${plural(list.length, "order")} · ${settledN} settled` : undefined}
                spark={<Sparkline values={grossSeries} label="Gross volume over time" />} />
              <Kpi label="Paid out to you" value={t ? t.sellerPaid / 1e6 : undefined} loading={statsLoading} error={!!statsErr && !stats}
                sub="After verified delivery" spark={<Sparkline values={paidSeries} label="Payouts over time" />} />
              <Kpi label="Refunded to buyers" value={t ? t.refunded / 1e6 : undefined} loading={statsLoading} error={!!statsErr && !stats} sub="Wrong item or damage" />
              <Kpi label="Courier fees" value={t ? t.courierPaid / 1e6 : undefined} loading={statsLoading} error={!!statsErr && !stats} sub="On verified handover" />
            </div>
            <div className="m-strip-hint" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} className={i === kpiPage ? "on" : ""} />)}</div>

            <div className="card m-secondary">
              <div>
                <span className="ic"><Icon name="wallet" /></span>
                <div className="grow">
                  <div className="lbl">Wallet balance</div>
                  <div className="val">{statsLoading ? <Skeleton w={70} /> : hasAmount(stats?.sellerBalance) ? <><CountUp value={stats.sellerBalance} /><span className="cur">USDT</span></> : "—"}</div>
                </div>
              </div>
              <div>
                <span className="ic"><Icon name="return" /></span>
                <div className="grow">
                  <div className="lbl">Refund pool</div>
                  <div className="val">{statsLoading ? <Skeleton w={70} /> : hasAmount(stats?.refundPool) ? <><CountUp value={stats.refundPool} /><span className="cur">USDT</span></> : "—"}</div>
                </div>
                <button type="button" className="btn link act" onClick={openPool} disabled={!stats}>Top up</button>
              </div>
              <div>
                <span className={`ic ${stats?.financing?.enabled ? "brand" : ""}`}><Icon name="coins" /></span>
                <div className="grow">
                  <div className="lbl">Advanced to you</div>
                  {statsLoading ? <Skeleton w={110} />
                    : stats?.financing?.enabled ? (
                      <div className="row" style={{ gap: 8, flexWrap: "nowrap", minWidth: 0 }}>
                        <span className="val"><CountUp value={stats.financing.advanced} /><span className="cur">USDT</span></span>
                        <span className="meta" title={stats.financing.count > 0 ? `Lender fees ${fmtAmount(advanceFees)} USDT` : undefined}>
                          {stats.financing.count > 0
                            ? <>{plural(stats.financing.count, "order")} · {stats.financing.active > 0 ? <>{fmtAmount(stats.financing.bondHeld)} bond held</> : <>bonds returned</>}</>
                            : "Get paid before delivery"}
                        </span>
                      </div>
                    ) : <div className="val" style={{ color: "var(--text-3)", fontWeight: 500, fontSize: 13 }}>Not enabled on this network</div>}
                </div>
              </div>
            </div>

            {needs.length > 0 && (
              <div className="m-needs" role="status">
                <span className="ic"><Icon name="bell" /></span>
                <div className="grow">
                  <div className="t">{needs.length === 1 ? "1 order needs you" : `${needs.length} orders need you`}</div>
                  <div className="refs">
                    {needs.slice(0, 4).map((o) => <span key={o.ref}><button type="button" onClick={() => setOpen(o.ref)}>{o.ref}</button> {NEED_VERB[o.status]}</span>)}
                    {needs.length > 4 && <span>+{needs.length - 4} more</span>}
                  </div>
                </div>
                {filter !== "needs" && <button type="button" className="btn sm" onClick={() => setFilter("needs")}>Show</button>}
              </div>
            )}

            <section className="card m-orders">
              <div className="m-toolbar">
                <h2>Recent orders</h2>
                <Tabs<Filter> className="seg" label="Filter orders" value={filter} onChange={setFilter}
                  items={[
                    { id: "all", label: "All", count: orders ? counts.all : null },
                    { id: "needs", label: <span className={counts.needs ? "attn" : ""}>Needs action</span>, count: orders ? counts.needs : null },
                    { id: "transit", label: "In transit", count: orders ? counts.transit : null },
                    { id: "settled", label: "Settled", count: orders ? counts.settled : null },
                    { id: "refunds", label: "Refunds", count: orders ? counts.refunds : null },
                  ]} />
              </div>
              <div className="table-wrap lg-only">
                <table className="data">
                  {(ordersLoading || shown.length > 0) && (
                    <thead><tr>
                      <th>Order</th><th>Item</th><th>Status</th><th>Outcome</th>
                      <th className="num">Amount (USDT)</th><th className="num">Courier fee</th><th className="num">Refunded</th><th className="num">Net to you</th>
                      <th>Next step</th>
                    </tr></thead>
                  )}
                  <tbody>
                    {ordersLoading && <SkeletonRows rows={4} cols={9} />}
                    {orders && shown.length === 0 && <tr><td colSpan={9} style={{ height: "auto" }}><OrdersEmpty any={list.length > 0} onAll={() => setFilter("all")} /></td></tr>}
                    {shown.map((o) => <OrderRow key={o.ref} o={o} selected={open === o.ref} onOpen={() => setOpen(o.ref)} req={worldReq[o.ref]} approval={worldReq[`${o.ref}:approval`]} />)}
                  </tbody>
                </table>
              </div>
              <ul className="list lt-lg m-list">
                {ordersLoading && [0, 1, 2].map((i) => <li key={i}><div className="m-li"><Skeleton w={40} h={40} r={10} /><div className="stack-8"><Skeleton w="60%" /><Skeleton w="40%" /></div></div></li>)}
                {orders && shown.length === 0 && <li><OrdersEmpty small any={list.length > 0} onAll={() => setFilter("all")} /></li>}
                {shown.map((o) => <OrderItem key={o.ref} o={o} onOpen={() => setOpen(o.ref)} req={worldReq[o.ref]} approval={worldReq[`${o.ref}:approval`]} />)}
              </ul>
            </section>

            <div className="grid-2 mt-24">
              <Card className="m-gas" title="Gas sponsorship" desc="Your gas balance pays the network fee on each checkout, so buyers never need crypto to pay."
                actions={relayer ? <Badge tone={relayer.low ? "warning" : "success"}>{relayer.low ? "Low balance" : "Healthy"}</Badge> : undefined}>
                {!relayer ? (statsErr ? <Callout tone="neutral" title="Gas balance unavailable">It loads when the API responds.</Callout> : <div className="stack-8"><Skeleton w={160} h={28} /><Skeleton /><Skeleton w="70%" /></div>) : (() => {
                  const spent = Number(relayer.spentTodayWei) / 1e18, budget = Number(relayer.dailyBudgetWei) / 1e18;
                  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
                  return (
                    <div className="stack-16">
                      <div>
                        <div className="kpi-label" title="WBT is the Whitechain network token used to pay transaction fees">Gas balance</div>
                        <div className="kpi-value"><CountUp value={relayer.balance} decimals={3} /><span className="cur">WBT</span></div>
                        <div className="kpi-sub">Network credit used to pay transaction fees for your buyers</div>
                      </div>
                      <div>
                        <div className="row between small"><span className="text-2">Spent today</span><span className="tnum">{fmtGas(spent)} of {fmtGas(budget)} WBT</span></div>
                        <div className={`progress mt-8 ${pct > 80 ? "warn" : ""}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Daily sponsorship budget used"><span style={{ width: `${pct}%` }} /></div>
                      </div>
                      <div className="row" style={{ gap: 16 }}>
                        <details className="disclosure">
                          <summary><Icon name="chevron-right" /> How to fund</summary>
                          <div className="small text-2 mt-8 stack-8">
                            <div>Send WBT to your sponsor address, or claim test WBT from the <a href="https://faucet.testnet.whitechain.io" target="_blank" rel="noreferrer">Whitechain faucet</a>.</div>
                            <Hash value={relayer.address} head={10} tail={6} />
                          </div>
                        </details>
                        <details className="disclosure">
                          <summary><Icon name="chevron-right" /> View limits</summary>
                          <ul className="small text-2 mt-8" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                            <li>Only checkout and account-setup calls are sponsored</li>
                            <li>Up to {Number(relayer.maxGasPerTx).toLocaleString()} gas per transaction</li>
                            <li>Rate-limited per visitor and per buyer wallet</li>
                            <li>Daily budget of {fmtGas(budget)} WBT with low-balance alert</li>
                          </ul>
                        </details>
                      </div>
                    </div>
                  );
                })()}
              </Card>

              <Card flush title="Webhooks" desc="Signed events sent to your server."
                footer={stats?.webhooks?.length > 10 ? <div className="row between"><span>Showing {allHooks ? stats.webhooks.length : 10} of {stats.webhooks.length}</span><button type="button" className="btn ghost sm" onClick={() => setAllHooks((x) => !x)}>{allHooks ? "Show fewer" : "View all"}</button></div> : undefined}>
                <dl className="dl" style={{ padding: "4px 24px" }}>
                  <dt>Endpoint</dt>
                  <dd>{stats ? <span className="hash"><span className="v truncate" style={{ maxWidth: 260 }} title={stats.merchant.webhookUrl}>{stats.merchant.webhookUrl}</span><CopyButton value={stats.merchant.webhookUrl} /></span> : statsErr ? <span className="muted">—</span> : <Skeleton w={180} />}</dd>
                  <dt>Signing</dt>
                  <dd style={{ minWidth: 0 }}><span className="small text-2 kv-nowrap" title="HMAC-SHA256 · X-OpenBox-Signature header">HMAC-SHA256 · <code>X-OpenBox-Signature</code></span></dd>
                </dl>
                <div className="table-wrap" style={{ borderTop: "1px solid var(--border)" }}>
                  {stats && !stats.webhooks?.length
                    ? <EmptyState small art={<WebhookArt />} title="No deliveries yet">Events appear here as orders move.</EmptyState>
                    : !stats && statsErr ? <EmptyState small art={<Offline />} title="Deliveries unavailable">They load when the API responds.</EmptyState>
                    : (
                      <table className="data compact">
                        <thead><tr><th>Event</th><th className="hide-sm">Status</th><th className="num">Delivered</th></tr></thead>
                        <tbody>
                          {!stats && <SkeletonRows rows={4} cols={3} />}
                          {(stats?.webhooks ?? []).slice(0, allHooks ? undefined : 10).map((w: any, i: number) => (
                            <tr key={i}>
                              <td><div className="m-hook-ev"><span className="h">{hookLabel(w.event)}</span><span className="raw">{w.event}</span></div></td>
                              <td className="hide-sm">{w.delivered_at ? <Badge tone="success">{w.status}</Badge> : <Badge tone="warning" live>Retrying · {w.attempts}</Badge>}</td>
                              <td className="num xs muted">{w.delivered_at ? <Timestamp ts={w.delivered_at} /> : <span className="only-mobile"><Badge tone="warning">Retrying</Badge></span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                </div>
              </Card>
            </div>
          </>
        )}

        {tab === "advances" && !ordersDown && (() => {
          const fin = stats?.financing;
          const advanced = list.filter((o) => o.advance);
          const eligible = list.filter((o) => !o.advance && ADVANCEABLE.includes(o.status) && !o.awaitingBuyer);
          if (stats && !fin?.enabled) {
            return (
              <div className="card">
                <EmptyState art={<div className="m-adv-off"><ReceivableFlow size="100%" /></div>} title="Invoice advances aren't enabled on this network">
                  When the receivable note contract is deployed, you can sell an order&apos;s payout to a lender and get most of it before delivery.
                </EmptyState>
              </div>
            );
          }
          return (
            <div className="stack-24">
              <div className="card kpi-group grid4">
                <Kpi label="Advanced to you" value={fin?.advanced} loading={statsLoading} error={!!statsErr && !stats} sub={fin ? plural(fin.count ?? 0, "order") : undefined} />
                <Kpi label="Bonds held" value={fin?.bondHeld} loading={statsLoading} error={!!statsErr && !stats} sub="Returned after verified delivery" />
                <Kpi label="Bonds returned" value={fin?.bondReturned ?? 0} loading={statsLoading} error={!!statsErr && !stats} sub="From closed advances" />
                <Kpi label="Lender fees" value={orders ? advanceFees : undefined} loading={ordersLoading} sub="The cost of getting paid early" />
              </div>

              <section className="card m-adv-how" aria-labelledby="adv-how">
                <div className="m-adv-copy">
                  <span className="eyebrow">How it works</span>
                  <h2 id="adv-how">Get paid before the parcel arrives</h2>
                  <p>Each paid order is a receivable: its payout is released when the delivery is verified. Sell it to a lender as a receivable note and most of it lands in your wallet today.</p>
                  <ul>
                    <li><Icon name="coins" /><span>You get the advance now, minus a small bond.</span></li>
                    <li><Icon name="shield-check" /><span>At verified delivery the payout repays the lender and your bond comes back.</span></li>
                    <li><Icon name="return" /><span>If the delivery fails, the bond covers the lender first.</span></li>
                  </ul>
                </div>
                <div className="adv-art" tabIndex={0} role="region" aria-label="How an invoice advance works (diagram)"><ReceivableFlow /></div>
              </section>

              <Card flush title="Ready for an advance" desc="Paid orders still on their way. Open one to see the lender's offer.">
                {ordersLoading ? <div className="card-b"><div className="stack-8"><Skeleton /><Skeleton w="70%" /></div></div>
                  : eligible.length === 0 ? <EmptyState small art={<EmptyBox />} title="No orders to advance right now">Orders become eligible once they&apos;re paid and until they&apos;re delivered.</EmptyState>
                  : (
                    <ul className="list m-adv-list">
                      {eligible.map((o) => (
                        <li key={o.ref}>
                          <div className="m-adv-row">
                            <ProductArt product={o.product} variant="thumb" size={40} />
                            <div className="grow" style={{ minWidth: 0 }}>
                              <div className="m-adv-t"><span className="mono">{o.ref}</span><span className="truncate">{o.product}</span></div>
                              <div className="badges mt-4"><StatusBadge s={o.status} /><span className="xs muted">Payout <Money v={Number(o.amount) - Number(o.courierFee)} /></span></div>
                            </div>
                            <button type="button" className="btn sm" aria-haspopup="dialog" onClick={() => setOpen(o.ref)}><Icon name="wallet" />See offer</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
              </Card>

              <Card flush title="Your advances" desc="Orders you've been paid early on, and how each one closed.">
                {ordersLoading ? <div className="card-b"><div className="stack-8"><Skeleton /><Skeleton w="70%" /></div></div>
                  : advanced.length === 0 ? <EmptyState small art={<EmptyBox />} title="No advances yet">Request one from an order above. It costs nothing if no lender takes it.</EmptyState>
                  : (
                    <div className="table-wrap">
                      <table className="data">
                        <thead><tr><th>Order</th><th>Advance</th><th className="hide-sm">Delivery</th><th className="num">Received</th><th className="num hide-sm">Bond</th></tr></thead>
                        <tbody>
                          {advanced.map((o) => (
                            <tr key={o.ref} className="clickable" onClick={() => setOpen(o.ref)}>
                              <td className="nowrap">
                                <button type="button" className="m-ref" aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setOpen(o.ref); }}>{o.ref}</button>
                                <div className="cell-sub truncate" style={{ maxWidth: 180 }}>{o.product}</div>
                              </td>
                              <td><AdvanceBadge a={o.advance} /></td>
                              <td className="hide-sm"><StatusBadge s={o.awaitingBuyer ? "awaiting_buyer" : o.status} /></td>
                              <td className="num"><Money v={o.advance.status === "offered" ? null : o.advance.received} cur={null} strong /></td>
                              <td className="num hide-sm">{o.advance.status === "funded" ? <span className="m-net-held"><Icon name="lock" /><Money v={o.advance.bond} cur={null} /></span> : o.advance.bondReturned != null ? <Money v={o.advance.bondReturned} cur={null} /> : <span className="muted">—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </Card>
            </div>
          );
        })()}

        {tab === "inspections" && !ordersDown && (() => {
          const inspected = list.filter((o) => o.inspection);
          const count = (k: string) => inspected.filter((o) => o.inspection.outcome === k).length;
          // Only verdicts on this merchant's own orders; the household's inspector payments and refusals stay in the household app.
          const verdicts = (hcs?.messages ?? []).filter((m: any) => m.message?.type === "inspection.verdict" && refByOrderId[m.message.orderId?.toLowerCase()]);
          const network = stats?.agent?.network;
          return (
            <div className="stack-24">
              <div className="m-insp-note">
                <span className="ic" aria-hidden="true"><Icon name="doorbell" /></span>
                <p>Inspections are commissioned and paid by each buyer&apos;s household doorbell agent, never by you. Here you see the verdict on each of your orders, and every verdict is written to a public Hedera log.</p>
              </div>
              <div className="card kpi-group grid4">
                <Stat label="Inspected" value={orders ? inspected.length : undefined} sub="Parcels opened on camera" />
                <Stat label="Verified match" value={orders ? count("match") : undefined} sub="Payout released to you" />
                <Stat label="Wrong item" value={orders ? count("mismatch") : undefined} sub="Buyer refunded, parcel returned" />
                <Stat label="Damaged" value={orders ? count("damaged") : undefined} sub="Partial refund offered" />
              </div>

              <Card flush title="Verdicts" desc="What the independent inspector found when each parcel was opened at the door.">
                {ordersLoading ? <div className="card-b"><div className="stack-8"><Skeleton /><Skeleton w="70%" /><Skeleton w="50%" /></div></div>
                  : inspected.length === 0 ? <EmptyState small art={<SearchParcel />} title="No inspections yet">Verdicts appear here once a buyer opens one of your parcels at their doorbell.</EmptyState>
                  : (
                    <div className="table-wrap">
                      <table className="data">
                        <thead><tr><th>Order</th><th>Verdict</th><th className="hide-sm">Serial on label</th><th className="hide-sm">Inspector</th><th className="num">Logged</th></tr></thead>
                        <tbody>
                          {inspected.map((o) => {
                            const i = o.inspection;
                            const ok = sameSerial(i.serialRead, o.serial);
                            const net = i.payment?.hashscan?.includes("/mainnet/") ? "hedera:mainnet" : "hedera:testnet";
                            return (
                              <tr key={o.ref} className="clickable" onClick={() => setOpen(o.ref)}>
                                <td>
                                  <div className="m-item">
                                    <ProductArt product={o.product} variant="thumb" size={32} />
                                    <div style={{ minWidth: 0 }}>
                                      <button type="button" className="m-ref" aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setOpen(o.ref); }}>{o.ref}</button>
                                      <div className="cell-sub truncate" style={{ maxWidth: 200 }}>{o.product}</div>
                                    </div>
                                  </div>
                                </td>
                                <td><div className="badges"><StatusBadge s={i.outcome} />{i.outcome === "damaged" && i.refundBps ? <span className="xs muted">{i.refundBps / 100}% refund</span> : null}</div></td>
                                <td className="hide-sm">
                                  {i.serialRead
                                    ? <div className="badges"><span className="mono small">{formatSerialLike(i.serialRead, o.serial)}</span>{o.serial && (ok ? <Badge tone="success">Matches</Badge> : <Badge tone="danger">Doesn&apos;t match</Badge>)}</div>
                                    : <span className="muted">Not readable</span>}
                                </td>
                                <td className="hide-sm text-2">{inspectorName(i.inspectorName) || "—"}</td>
                                <td className="num">{i.hcs?.sequence
                                  ? (i.payment?.mock ? <span className="muted mono">#{i.hcs.sequence}</span> : <ExtLink href={hashscan(net, "topic", i.hcs.topicId)}>#{i.hcs.sequence}</ExtLink>)
                                  : <span className="muted">—</span>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
              </Card>

              <Card flush title="Audit log" desc="Verdicts on your orders, as written to the public Hedera log."
                actions={hcs?.topicId ? <ExtLink href={hcs.live ? hashscan(network, "topic", hcs.topicId) : undefined}>View log on HashScan</ExtLink> : undefined}>
                {!hcs && hcsErr ? (
                  <div className="card-b">
                    <Callout tone="danger" title="Audit log unavailable" action={<button type="button" className="btn sm" onClick={reloadHcs}>Retry</button>}>
                      We couldn&apos;t read the Hedera log ({hcsErr}). Entries already written stay on the public log.
                    </Callout>
                  </div>
                ) : hcs && !verdicts.length ? (
                  <EmptyState small art={<AuditLog />} title="Nothing logged for your orders yet">Verdicts are logged as parcels are opened at the door.</EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th className="hide-sm">Time</th><th>Order</th><th>Verdict</th><th className="num">Entry</th></tr></thead>
                      <tbody>
                        {!hcs && <SkeletonRows rows={4} cols={4} />}
                        {verdicts.slice(0, 25).map((m: any) => {
                          const ts = m.consensusTimestamp ? Number(m.consensusTimestamp.split(".")[0]) : m.message.at;
                          return (
                            <tr key={m.sequence}>
                              <td className="xs muted nowrap hide-sm"><Timestamp ts={ts} /></td>
                              <td className="mono nowrap">{refByOrderId[m.message.orderId?.toLowerCase()]}</td>
                              <td>{m.message.outcome ? <StatusBadge s={m.message.outcome} /> : <Badge tone="info">Inspection verdict</Badge>}</td>
                              <td className="num mono xs">#{m.sequence}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          );
        })()}

        {tab === "developers" && (
          <div className="stack-24">
            <div className="grid-main">
              <Card title="Quickstart" desc="Add checkout with verified release to any page."
                actions={<div className="row" role="tablist" aria-label="Snippet">{Object.keys(SNIPPETS).map((k) => <button key={k} type="button" role="tab" aria-selected={snippet === k} className={`btn sm ${snippet === k ? "" : "ghost"}`} onClick={() => setSnippet(k)}>{k}</button>)}</div>}>
                <CodeBlock code={SNIPPETS[snippet]} />
              </Card>
              <Card title="API keys" desc="Testnet keys. Never put the secret key in a browser.">
                <dl className="dl">
                  <dt>Publishable key</dt><dd><Hash value="pk_demo_openbox" full /></dd>
                  <dt>Secret key</dt><dd><span className="muted mono">sk_••••••••</span><Badge tone="neutral" dot={false}>Server only</Badge></dd>
                  <dt>Webhook endpoint</dt><dd>{stats ? <Hash value={stats.merchant.webhookUrl} head={14} tail={10} /> : statsErr ? <span className="muted">—</span> : <Skeleton w={160} />}</dd>
                </dl>
              </Card>
            </div>
            <Card title="Settlement rules" desc="The buyer's payment is held at checkout and released by these rules once the parcel is checked at the door.">
              <div className="m-split" tabIndex={0} role="region" aria-label="Settlement rules diagram"><MoneySplit /></div>
              <div className="m-scroll-hint" aria-hidden="true"><Icon name="arrow-right" /> Scroll to see every outcome</div>
              <div className="m-split-foot">
                <div className="ok"><b>Match</b>The serial on the label matches what you packed: you get the payout, the courier gets their fee.</div>
                <div className="bad"><b>Wrong item</b>The buyer is refunded in full and the parcel comes back to you. The courier is still paid for a verified handover.</div>
                <div className="warn"><b>Damaged</b>The buyer can accept a partial refund, approved with World ID, and you receive the rest. If they don&apos;t accept in time, you&apos;re paid in full.</div>
              </div>
            </Card>
          </div>
        )}
      </main>

      <datalist id="stickers">{STICKERS.map((s) => <option key={s} value={s} />)}</datalist>

      {current && (
        <Drawer onClose={() => setOpen(undefined)}
          title={
            <span className="m-dh">
              <ProductArt product={current.product} variant="thumb" size={56} />
              <span className="m-dh-text">
                <span className="m-dh-name">{current.product}</span>
                <span className="m-dh-ref"><span className="mono">{current.ref}</span><span aria-hidden="true">·</span><span>Placed <Timestamp ts={current.createdAt} /></span></span>
              </span>
            </span>
          }
          sub={
            <div className="m-dh-sub">
              <div className="badges"><StatusBadge s={current.awaitingBuyer ? "awaiting_buyer" : current.status} />{current.outcome && <StatusBadge s={outcomeKey(current)} />}<AdvanceBadge a={current.advance} /></div>
              <div className="m-mini"><Stepper steps={orderSteps(current)} responsive={false} label="Order progress" /></div>
            </div>
          }>
          {["paid", "packed", "dispatched", "returning"].includes(current.status) && (
            <section>
              <h3>Next step</h3>
              {current.status === "paid" && (
                <form className="stack-12" onSubmit={(e) => { e.preventDefault(); act(current.ref, () => merchant("POST", `orders/${current.ref}/pack`, { serial: f(current.ref).serial })); }}>
                  <div className="m-pack-hint"><Parcel size={48} /><div><b>Pack and label the parcel.</b> Enter the serial from the sticker on the item; the doorbell checks it when the buyer opens the box.</div></div>
                  <Field label="Serial on the parcel sticker" htmlFor="serial">
                    <input id="serial" className="input mono" list="stickers" placeholder="SN-…" value={f(current.ref).serial ?? ""} onChange={(e) => setF(current.ref, { serial: e.target.value })} />
                  </Field>
                  <button className="btn primary" disabled={!f(current.ref).serial || busy === current.ref}>{busy === current.ref ? <Icon name="loader" className="spin" /> : <Icon name="package" />} Pack order</button>
                </form>
              )}
              {current.status === "packed" && !worldReq[current.ref]?.verificationUri && (
                <form className="stack-12" onSubmit={(e) => {
                  e.preventDefault();
                  act(current.ref, async () => {
                    const r = await merchant("POST", `orders/${current.ref}/dispatch`, { courierName: f(current.ref).courier ?? "Alice", payout: f(current.ref).payout ?? DEMO_COURIER });
                    setWorldReq((w) => ({ ...w, [current.ref]: r }));
                  });
                }}>
                  <Field label="Courier name" htmlFor="courier"><input id="courier" className="input" value={f(current.ref).courier ?? "Alice"} onChange={(e) => setF(current.ref, { courier: e.target.value })} /></Field>
                  <Field label="Courier payout address" htmlFor="payout" help="The courier fee is paid here when the handover is verified."><input id="payout" className="input mono" value={f(current.ref).payout ?? DEMO_COURIER} onChange={(e) => setF(current.ref, { payout: e.target.value })} /></Field>
                  <button className="btn primary" disabled={busy === current.ref}>{busy === current.ref ? <Icon name="loader" className="spin" /> : <Icon name="truck" />} Assign courier</button>
                  <div className="xs muted">The courier confirms with World ID before the parcel label is issued (simulated in the hosted demo).</div>
                </form>
              )}
              {current.status === "packed" && worldReq[current.ref]?.verificationUri && (
                <div className="qr-panel">
                  <QR text={worldReq[current.ref].verificationUri} size={128} />
                  <div className="stack-8 small">
                    <StatusBadge s={worldReq[current.ref].status ?? "pending"} />
                    <div>Courier scans this to confirm their identity with World ID (simulated in the hosted demo).</div>
                    <ExtLink href={worldReq[current.ref].verificationUri}>Open courier page</ExtLink>
                  </div>
                </div>
              )}
              {current.status === "dispatched" && current.qr && (
                <div className="qr-panel">
                  <QR text={current.qr} size={128} />
                  <div className="stack-8 small"><div className="strong">One-time parcel label</div><div className="text-2">Signed by you. Only {current.courier} can hand it over at the door.</div></div>
                </div>
              )}
              {current.status === "returning" && (
                <div className="stack-12">
                  <Callout tone="info" title="Parcel is on its way back">The buyer has already been refunded. Confirm when the parcel reaches you.</Callout>
                  <button type="button" className="btn primary" disabled={busy === current.ref} onClick={() => act(current.ref, () => merchant("POST", `orders/${current.ref}/return-received`, {}))}><Icon name="return" /> Mark return received</button>
                </div>
              )}
            </section>
          )}

          {(current.awaitingBuyer || worldReq[`${current.ref}:approval`] || (current.outcome === "damaged" && current.refundApproval) || (current.outcome === "timeout" && current.inspection?.outcome === "damaged")) && (() => {
            const a = worldReq[`${current.ref}:approval`];
            const deadline = current.decisionDeadline as number | null;
            // Demo fallback approvals carry no World ID proof: never label them as World ID.
            const sim = !!(a?.simulated || (!a && current.refundApproval?.simulated));
            const head = <div className="m-sec-h"><h3>Buyer&apos;s decision</h3>{sim
              ? <Badge tone="neutral" dot={false}><Icon name="flask" /> Simulated approval · demo only</Badge>
              : <Badge tone="proof" dot={false}>World ID Agent Pass</Badge>}</div>;
            if (!a && current.outcome === "damaged" && current.refundApproval) {
              return (
                <section>
                  {head}
                  <Callout tone={sim ? "neutral" : "success"} title={sim ? "Refund settled (simulated approval, no World ID proof)" : "Approved with World ID, partial refund settled"}>
                    {sim ? "Demo fallback: the partial refund was approved without a World ID proof. You received the rest of the item price." : "The household owner approved with World ID Agent Pass. You received the rest of the item price."}
                  </Callout>
                </section>
              );
            }
            if (current.outcome === "timeout") {
              return (
                <section>
                  {head}
                  <Callout tone="neutral" icon="clock" title="Buyer didn't accept the partial refund; paid in full">
                    The decision window closed, so the payout was released to you. The buyer kept the item and can still return it within the return window.
                  </Callout>
                </section>
              );
            }
            return (
              <section>
                {head}
                {a
                  ? <Callout tone={(a.simulated && approvalTone(a.status) === "success" ? "neutral" : approvalTone(a.status)) as "success" | "danger" | "neutral" | "info"} title={a.simulated && a.status === "refunded" ? "Refund settled (simulated approval, no World ID proof)" : a.simulated && a.status === "verified" ? "Simulated approval (no World ID proof), settling the refund" : APPROVAL_LABEL[a.status] ?? a.status}>
                      {APPROVAL_OPEN.includes(a.status) ? "The buyer's OpenBox agent settles the partial refund only after the household owner approves with World ID." : a.at ? <>Updated <Timestamp ts={a.at} mode="time" />.</> : null}
                    </Callout>
                  : <div className="small text-2">Damage was found at the door. The buyer can accept a {current.inspection?.refundBps ? `${current.inspection.refundBps / 100}% ` : ""}partial refund; their agent settles it after a World ID approval.</div>}
                {current.awaitingBuyer && deadline && (
                  <div className="small text-2 mt-8 row"><Icon name="clock" /><span>Buyer has until <Timestamp ts={deadline} mode="time" /> to accept. If they don&apos;t, you&apos;re paid in full.</span></div>
                )}
              </section>
            );
          })()}

          <section>
            <div className="m-sec-h"><h3>Inspection at the door</h3>{current.inspection?.hcs?.sequence && <Badge tone="proof" dot={false}>Logged on Hedera</Badge>}</div>
            {current.inspection
              ? <InspectionList i={current.inspection} expected={current.serial} />
              : <div className="m-pack-hint"><Icon name="doorbell" /><span>Happens at the buyer&apos;s door when the box is opened. The serial and condition are checked before any money moves.</span></div>}
          </section>

          {(current.advance || ["paid", "packed", "dispatched", "handed_over"].includes(current.status)) && <AdvanceCard refId={current.ref} tick={tick} />}

          <section>
            <h3>Payment</h3>
            <ul className="lines">
              <li><span>Order total</span><Money v={current.amount} /></li>
              <li><span>Courier fee</span><Money v={-Number(current.courierFee)} /></li>
              {Number(current.buyerRefunded) > 0 && <li><span>Refunded to buyer</span><Money v={-Number(current.buyerRefunded)} /></li>}
              {current.advance && current.advance.status !== "offered"
                ? <li className="total"><span>Net to you</span><span className="small text-2" style={{ fontWeight: 400 }}>Paid as an invoice advance, see above</span></li>
                : <li className="total"><span>Net to you</span>{current.outcome || current.status === "settled" ? <Money v={current.sellerPaid} /> : <span className="muted" style={{ fontWeight: 500 }}>Held until delivery is verified</span>}</li>}
            </ul>
          </section>

          <section>
            <h3>Parties</h3>
            <dl className="dl">
              <dt>Buyer wallet</dt><dd><Hash value={current.buyer} /></dd>
              <dt>Courier</dt><dd>{current.courier ?? <span className="muted">Not assigned</span>}</dd>
              <dt>Courier payout</dt><dd><Hash value={current.courierPayout} /></dd>
              <dt>Serial on label</dt><dd>{current.serial ? <span className="mono">{current.serial}</span> : <span className="muted">—</span>}</dd>
            </dl>
          </section>

          <section>
            <h3>Receipts</h3>
            <div className="card"><ReceiptList receipts={current.receipts} audience="merchant" /></div>
          </section>
        </Drawer>
      )}

      {poolOpen && (() => {
        const bal = Number(stats?.sellerBalance ?? 0);
        const amt = Number(pool);
        const err = pool.trim() === "" ? undefined : !(amt > 0) ? "Enter an amount greater than 0." : amt > bal ? `You only have ${fmtAmount(bal)} USDT available.` : undefined;
        const ok = pool.trim() !== "" && !err && !!stats;
        return (
        <Dialog onClose={() => setPoolOpen(false)} title="Top up refund pool">
          <form noValidate onSubmit={async (e) => { e.preventDefault(); if (!ok) return; if (await act("pool", () => merchant("POST", "refund-pool", { amount: amt }))) setPoolOpen(false); }}>
            <div className="dialog-b stack-16">
              <p className="text-2" style={{ margin: 0 }}>The refund pool pays buyers back on returns, so refunds never wait on your wallet.</p>
              <Field label="Amount" htmlFor="pool" help={stats ? (
                <span className="stack-4" style={{ display: "block" }}>
                  <span className="m-help"><span>Available in your wallet: <b className="tnum" style={{ color: "var(--text-2)" }}>{fmtAmount(bal)} USDT</b></span><button type="button" className="btn link" onClick={() => setPool(String(Math.floor(bal * 100) / 100))} disabled={!(bal > 0)}>Use max</button></span>
                  <span style={{ display: "block" }}>{ok ? <>Pool after top-up: <b className="tnum" style={{ color: "var(--text-2)" }}>{fmtAmount(Number(stats.refundPool) + amt)} USDT</b></> : <>Pool balance now: <span className="tnum">{fmtAmount(stats.refundPool)} USDT</span></>}</span>
                </span>) : undefined}>
                <div className="input-group">
                  <input id="pool" className="input tnum" inputMode="decimal" placeholder="0.00" value={pool} aria-invalid={!!err} aria-describedby={err ? "pool-err" : undefined} onChange={(e) => setPool(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <span className="suffix">USDT</span>
                </div>
              </Field>
              {err && <div id="pool-err" className="field-error" role="alert">{err}</div>}
              {msg && <Callout tone="danger">{msg}</Callout>}
            </div>
            <div className="dialog-f">
              <button type="button" className="btn" onClick={() => setPoolOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={!ok || busy === "pool"}>{busy === "pool" && <Icon name="loader" className="spin" />} {ok ? `Move ${fmtAmount(amt)} USDT` : "Move to pool"}</button>
            </div>
          </form>
        </Dialog>
        );
      })()}
    </>
  );
}

/* ─── pieces ──────────────────────────────────────────────────────────────────────────────── */
const cumulative = (xs: number[]) => { let s = 0; return xs.map((x) => (s += x)); };

/** KPI tile body (inside .kpi-group): counts up on change, optional sparkline. */
function Kpi({ label, value, sub, loading, error, spark }: { label: string; value?: number | string | null; sub?: ReactNode; loading?: boolean; error?: boolean; spark?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="m-kpi-main">
        <div className="kpi-value">{loading ? <Skeleton w={110} h={28} /> : error || !hasAmount(value) ? "—" : <><CountUp value={value} /><span className="cur">USDT</span></>}</div>
        {!loading && !error && hasAmount(value) && spark}
      </div>
      <div className="kpi-sub">{loading ? <Skeleton w={90} h={12} /> : sub ?? " "}</div>
    </div>
  );
}

/** Count tile (inside .kpi-group). */
function Stat({ label, value, sub }: { label: string; value?: number; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value === undefined ? <Skeleton w={48} h={28} /> : <CountUp value={value} decimals={0} />}</div>
      <div className="kpi-sub">{sub ?? " "}</div>
    </div>
  );
}

/** Tiny area sparkline of a cumulative series (inline SVG, no deps). */
function Sparkline({ values, label, w = 96, h = 32 }: { values: number[]; label: string; w?: number; h?: number }) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2 || !values.some((x) => x > 0)) return null; // nothing to draw yet
  const v = values.length >= 2 ? values : [0, values[0] ?? 0];
  const max = Math.max(...v), min = Math.min(0, ...v);
  const span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * (w - 4) + 2, h - 3 - ((y - min) / span) * (h - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="m-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <defs><linearGradient id={`sg${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--brand-600)" stopOpacity=".18" /><stop offset="1" stopColor="var(--brand-600)" stopOpacity="0" /></linearGradient></defs>
      <path d={`${d}L${pts[pts.length - 1][0].toFixed(1)} ${h}L${pts[0][0].toFixed(1)} ${h}Z`} fill={`url(#sg${id})`} />
      <path className="line" d={d} />
      <circle className="end" cx={lx} cy={ly} r="2.5" />
    </svg>
  );
}

function OrdersEmpty({ any, onAll, small }: { any: boolean; onAll: () => void; small?: boolean }) {
  if (any) return <EmptyState small art={<SearchParcel />} title="No orders in this view" action={<button type="button" className="btn sm" onClick={onAll}>Show all orders</button>}>Try another filter.</EmptyState>;
  return (
    <EmptyState small={small} art={<EmptyBox />} title="No orders yet"
      action={process.env.NEXT_PUBLIC_STORE_URL ? <a className="btn" href={process.env.NEXT_PUBLIC_STORE_URL} target="_blank" rel="noreferrer">Open the demo store <Icon name="external" /></a> : undefined}>
      Orders paid through OpenBox checkout show up here in real time.
    </EmptyState>
  );
}

const rowKey = (o: any) => `${o.status}|${o.outcome}|${o.awaitingBuyer}|${o.advance?.status}`;

function NetCell({ o }: { o: any }) {
  if (o.advance && o.advance.status !== "offered")
    return <><Money v={o.advance.received} cur={null} strong /><div className="cell-sub">{o.advance.status === "funded" ? "Advanced" : "Incl. advance"}</div></>;
  if (["settled", "returned", "returned_to_seller"].includes(o.status) || o.outcome) return <Money v={o.sellerPaid} cur={null} strong />;
  return <span className="m-net-held" title="Released when delivery is verified"><Icon name="lock" />Held</span>;
}

function OrderRow({ o, selected, onOpen, req, approval }: { o: any; selected: boolean; onOpen: () => void; req?: any; approval?: any }) {
  const flash = useFlash(rowKey(o));
  return (
    <tr className={`clickable ${selected ? "selected" : ""} ${flash ? "flash" : ""}`} onClick={onOpen}>
      <td className="nowrap">
        <button type="button" className="m-ref" aria-haspopup="dialog" aria-expanded={selected} onClick={(e) => { e.stopPropagation(); onOpen(); }}>{o.ref}</button>
        <div className="cell-sub"><Timestamp ts={o.createdAt} /></div>
      </td>
      <td style={{ minWidth: 200 }}>
        <div className="m-item">
          <ProductArt product={o.product} variant="thumb" size={32} />
          <div style={{ minWidth: 0 }}><div className="name">{o.product}</div>{o.serial && <div className="cell-sub mono">{o.serial}</div>}</div>
        </div>
      </td>
      <td><div className="badges"><StatusBadge s={o.awaitingBuyer ? "awaiting_buyer" : o.status} /><AdvanceBadge a={o.advance} /></div></td>
      <td>{o.outcome ? <StatusBadge s={outcomeKey(o)} /> : <span className="muted">—</span>}</td>
      <td className="num"><Money v={o.amount} cur={null} /></td>
      <td className="num"><Money v={o.courierFee} cur={null} /></td>
      <td className="num">{Number(o.buyerRefunded) > 0 ? <Money v={o.buyerRefunded} cur={null} /> : <span className="muted">—</span>}</td>
      <td className="num"><NetCell o={o} /></td>
      <td onClick={(e) => e.stopPropagation()}><div className="m-next"><NextStep o={o} req={req} approval={approval} onOpen={onOpen} /></div></td>
    </tr>
  );
}

function OrderItem({ o, onOpen, req, approval }: { o: any; onOpen: () => void; req?: any; approval?: any }) {
  const flash = useFlash(rowKey(o));
  const actionable = ["paid", "packed", "dispatched", "returning"].includes(o.status);
  return (
    <li className={flash ? "flash" : ""}>
      <button type="button" className="list-btn" onClick={onOpen} aria-haspopup="dialog">
        <div className="m-li">
          <ProductArt product={o.product} variant="thumb" size={40} />
          <div style={{ minWidth: 0 }}>
            <div className="top"><span className="ref">{o.ref}</span><Money v={o.amount} strong /></div>
            <div className="top" style={{ marginTop: 2 }}><span className="prod">{o.product}</span><span className="xs muted nowrap"><Timestamp ts={o.createdAt} /></span></div>
            <div className="badges mt-8"><StatusBadge s={o.awaitingBuyer ? "awaiting_buyer" : o.status} />{o.outcome && <StatusBadge s={outcomeKey(o)} />}<AdvanceBadge a={o.advance} /></div>
          </div>
        </div>
      </button>
      {actionable && <div className="list-actions"><NextStep o={o} req={req} approval={approval} onOpen={onOpen} /></div>}
    </li>
  );
}

/** One clear next action per order: primary only for the money-moving first step (Pack); secondary for the rest;
 *  passive waiting states as a live badge; nothing for finished orders (the row itself opens details). */
function NextStep({ o, req, approval, onOpen }: { o: any; req?: any; approval?: any; onOpen: () => void }) {
  const b = (label: string, icon: IconName, primary = false) => <button type="button" className={`btn sm ${primary ? "primary" : ""}`} onClick={onOpen}><Icon name={icon} />{label}</button>;
  if (o.status === "paid") return b("Pack order", "package", true);
  if (o.status === "packed") return req?.verificationUri ? <Badge tone="proof" live>Courier verifying</Badge> : b("Assign courier", "truck");
  if (o.status === "dispatched") return b("View label", "scan");
  if (o.status === "returning") return b("Mark received", "return");
  if (o.awaitingBuyer) return <Badge tone="neutral" live>{approval && APPROVAL_OPEN.includes(approval.status) ? "Awaiting approval" : "Buyer deciding"}</Badge>;
  if (o.status === "handed_over") return <Badge tone="neutral" live>Inspecting</Badge>;
  return <span className="muted" aria-hidden="true">—</span>;
}

type Step = { label: string; state: StepState };
/** Merchant view of order progress, including the refund / return branch (mirrors the buyer page). */
function orderSteps(o: any): Step[] {
  const doneN = o.outcome ? 3 : ({ paid: 1, packed: 2, dispatched: 2, handed_over: 3, settled: 5 } as Record<string, number>)[o.status] ?? 0;
  const st = (n: number): StepState => (n < doneN ? "done" : n === doneN ? "current" : "upcoming");
  const base: Step[] = [{ label: "Paid", state: st(0) }, { label: "Packed", state: st(1) }, { label: "Out for delivery", state: st(2) }];
  if (o.outcome === "mismatch") {
    const returned = ["returned", "returned_to_seller"].includes(o.status);
    return [...base, { label: "Wrong item", state: "failed" }, { label: "Refunded", state: "done" }, { label: returned ? "Returned" : "Returning", state: returned ? "done" : "current" }];
  }
  if (o.awaitingBuyer) return [...base, { label: "Damage found", state: "warn" }, { label: "Buyer deciding", state: "current" }];
  if (o.outcome === "timeout" && o.inspection?.outcome === "damaged") return [...base, { label: "Damage found", state: "warn" }, { label: "Paid in full", state: "done" }];
  if (o.outcome === "damaged") return [...base, { label: "Damage found", state: "warn" }, { label: "Partial refund", state: "done" }];
  return [...base, { label: "Checked at door", state: o.outcome ? "done" : st(3) }, { label: "Settled", state: o.status === "settled" ? "done" : st(4) }];
}
