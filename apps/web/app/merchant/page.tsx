"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { Top } from "../components/Top";
import {
  Badge, Callout, Card, CodeBlock, CopyButton, EmptyState, ExtLink, Field, Hash, Icon, KpiTile, Money, PageHeader,
  InspectionList, ReceiptList, Skeleton, hashscan, fmtGas, SkeletonRows, StatusBadge, Timestamp, fmtAmount,
} from "../components/ui";
import { api, merchant, useEvents, usePoll } from "../lib/api";

const STICKERS = ["SN-AX1-7731-0042", "SN-PBP-5520-0007", "SN-LT11-3304-0019", "SN-AX1-7731-1001"];
const DEMO_COURIER = process.env.NEXT_PUBLIC_DEMO_COURIER ?? "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955";
const SNIPPETS: Record<string, string> = {
  HTML: `<script src="https://cdn.openbox.dev/openbox-checkout.js"></script>
<div id="checkout"></div>
<script>
  OpenBox.mount("#checkout", {
    publishableKey: "pk_demo_openbox", // safe in the browser
    sku: "aurora-x1",              // price from your catalog
    wallet: "passkey",             // embedded key, no popup
    onPaid: ({ ref }) => markPaid(ref),
  });
</script>`,
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
const AUDIT_LABEL: Record<string, [string, "success" | "warning" | "info" | "neutral"]> = {
  "agent.payment": ["Inspector paid", "success"],
  "inspection.verdict": ["Inspection verdict", "info"],
  "agent.refusal": ["Inspector declined: over limit", "warning"],
  "inspector.register": ["Inspector listed", "neutral"],
};
type Tab = "overview" | "inspections" | "developers";

function QR({ text, size = 160 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => { QRCode.toDataURL(text, { margin: 1, width: size }).then(setSrc); }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt="QR code" /> : <Skeleton w={size} h={size} />;
}

export default function Merchant() {
  const tick = useEvents();
  const [stats, reloadStats, statsErr] = usePoll(() => merchant("GET", "stats"), [tick]);
  const [orders, reloadOrders, err] = usePoll<any[]>(() => merchant("GET", "orders"), [tick]);
  const [agent] = usePoll(() => api("GET", "/v1/agent/status"), [tick]);
  const [hcs] = usePoll(() => api("GET", "/v1/hcs/log"), [tick]);
  const [tab, setTab] = useState<Tab>("overview");
  const [open, setOpen] = useState<string>();
  const [poolOpen, setPoolOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [form, setForm] = useState<Record<string, { serial?: string; courier?: string; payout?: string }>>({});
  const [worldReq, setWorldReq] = useState<Record<string, any>>({});
  const [pool, setPool] = useState("");
  const [allHooks, setAllHooks] = useState(false);
  const [snippet, setSnippet] = useState("HTML");

  useEvents(undefined, (e) => {
    if (e.type === "world.request" && e.ref) setWorldReq((w) => ({ ...w, [e.ref!]: { ...(w[e.ref!] ?? {}), status: e.data?.status, note: e.data?.note } }));
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
  const relayer = stats?.relayer;
  const gross = orders ? list.reduce((s, o) => s + Number(o.amount || 0), 0) : undefined;
  const current = list.find((o) => o.ref === open);
  const refByOrderId = Object.fromEntries(list.map((o) => [o.orderId?.toLowerCase(), o.ref]));
  const merchantName = stats?.merchant?.name;

  return (
    <>
      <Top account={merchantName ?? "Northwind Gadgets"} />
      <main className="page">
        <PageHeader
          title="Orders"
          sub={merchantName ? <>{merchantName} · amounts in USDT</> : <Skeleton w={200} />}
          actions={<>
            <a className="btn" href="/api/merchant/export.csv" download><Icon name="download" /> Export CSV</a>
            <button type="button" className="btn primary" onClick={() => { const bal = Math.floor(Number(stats?.sellerBalance ?? 0)); setPool(bal >= 1 ? String(Math.min(5, bal)) : ""); setMsg(undefined); setPoolOpen(true); }}><Icon name="plus" /> Top up refund pool</button>
          </>}
        />

        <div className="tabs" role="tablist" aria-label="Dashboard sections">
          {([["overview", "Overview"], ["inspections", "Inspections & audit"], ["developers", "Developers"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        <div className="stack-16" style={{ marginBottom: msg || err || statsErr ? 24 : 0 }}>
          {msg && <Callout tone="danger" title="That action didn't go through" action={<button type="button" className="btn sm" onClick={() => setMsg(undefined)}>Dismiss</button>}>{msg}</Callout>}
          {(err || statsErr) && <Callout tone="danger" title="Can't reach the OpenBox API" action={<button type="button" className="btn sm" onClick={() => { reloadOrders(); reloadStats(); }}>Retry</button>}>{err ?? statsErr}. Figures below may be out of date.</Callout>}
        </div>

        {tab === "overview" && (
          <>
            <div className="kpis">
              <KpiTile label="Gross volume" value={gross} loading={orders === undefined && !err} error={!!err}
                sub={t ? `${t.orders} order${t.orders === 1 ? "" : "s"} · ${t.settled} settled` : undefined} />
              <KpiTile label="Paid out to you" value={t ? t.sellerPaid / 1e6 : undefined} loading={statsLoading} error={!!statsErr}
                sub={stats ? <>Wallet balance {fmtAmount(stats.sellerBalance)} USDT</> : undefined} />
              <KpiTile label="Refunded to buyers" value={t ? t.refunded / 1e6 : undefined} loading={statsLoading} error={!!statsErr} sub="Wrong item or damage at the door" />
              <KpiTile label="Courier fees" value={t ? t.courierPaid / 1e6 : undefined} loading={statsLoading} error={!!statsErr} sub="Paid on verified handover" />
              <KpiTile label="Refund pool" value={stats?.refundPool} loading={statsLoading} error={!!statsErr} sub="Covers refunds on returns" />
            </div>

            <Card flush title="Recent orders" desc="Click an order for receipts, inspection and next steps.">
              <div className="table-wrap lg-only">
                <table className="data">
                  <thead><tr>
                    <th style={{ width: 40 }}><span className="sr-only">Details</span></th>
                    <th>Order</th><th>Item</th><th>Status</th><th>Outcome</th>
                    <th className="num">Amount</th><th className="num">Courier fee</th><th className="num">Refunded</th><th className="num">Net to you</th>
                    <th>Next step</th>
                  </tr></thead>
                  <tbody>
                    {orders === undefined && !err && <SkeletonRows rows={3} cols={10} />}
                    {orders && list.length === 0 && (
                      <tr><td colSpan={10}><EmptyState icon="package" title="No orders yet" action={<a className="btn" href={process.env.NEXT_PUBLIC_STORE_URL} target="_blank" rel="noreferrer">Open the demo store <Icon name="external" /></a>}>Orders paid through OpenBox checkout show up here in real time.</EmptyState></td></tr>
                    )}
                    {list.map((o) => (
                      <Fragment key={o.ref}>
                        <tr className={`clickable ${open === o.ref ? "selected" : ""}`} onClick={() => setOpen(o.ref)}>
                          <td><button type="button" className="chev" aria-label={`Open details for ${o.ref}`} aria-haspopup="dialog" aria-expanded={open === o.ref} onClick={(e) => { e.stopPropagation(); setOpen(o.ref); }}><Icon name="chevron-right" /></button></td>
                          <td className="nowrap"><span className="strong mono" style={{ fontSize: 13 }}>{o.ref}</span><div className="cell-sub"><Timestamp ts={o.createdAt} /></div></td>
                          <td style={{ minWidth: 160 }}>{o.product}{o.serial && <div className="cell-sub mono">{o.serial}</div>}</td>
                          <td><StatusBadge s={o.awaitingBuyer ? "awaiting_buyer" : o.status} /></td>
                          <td>{o.outcome ? <StatusBadge s={o.outcome} /> : <span className="muted">—</span>}</td>
                          <td className="num"><Money v={o.amount} cur={null} /></td>
                          <td className="num"><Money v={o.courierFee} cur={null} /></td>
                          <td className="num">{Number(o.buyerRefunded) > 0 ? <Money v={o.buyerRefunded} cur={null} /> : <span className="muted">—</span>}</td>
                          <td className="num">{["settled", "returned", "returned_to_seller"].includes(o.status) || o.outcome ? <Money v={o.sellerPaid} cur={null} strong /> : <span className="muted" title="Released when delivery is verified">Held</span>}</td>
                          <td onClick={(e) => e.stopPropagation()}><NextStep o={o} req={worldReq[o.ref]} onOpen={() => setOpen(o.ref)} /></td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="list lt-lg">
                {orders === undefined && !err && [0, 1, 2].map((i) => <li key={i}><Skeleton w="60%" /><div className="mt-8"><Skeleton w="40%" /></div></li>)}
                {orders && list.length === 0 && <li><EmptyState small icon="package" title="No orders yet">Orders paid through OpenBox checkout show up here.</EmptyState></li>}
                {list.map((o) => (
                  <li key={o.ref}>
                    <button type="button" className="list-btn" onClick={() => setOpen(o.ref)} aria-haspopup="dialog">
                      <div className="row between"><span className="strong mono" style={{ fontSize: 13 }}>{o.ref}</span><Money v={o.amount} strong /></div>
                      <div className="row between mt-8"><span className="small text-2 truncate grow">{o.product}</span><span className="xs muted"><Timestamp ts={o.createdAt} /></span></div>
                      <div className="badges mt-8"><StatusBadge s={o.awaitingBuyer ? "awaiting_buyer" : o.status} />{o.outcome && <StatusBadge s={o.outcome} />}</div>
                    </button>
                    {["paid", "packed", "dispatched", "returning"].includes(o.status) && <div className="list-actions"><NextStep o={o} req={worldReq[o.ref]} onOpen={() => setOpen(o.ref)} /></div>}
                  </li>
                ))}
              </ul>
            </Card>

            <div className="grid-2 mt-24">
              <Card title="Gas sponsorship" desc="Your gas balance pays the network fee on each checkout, so buyers never need crypto to pay."
                actions={relayer ? <Badge tone={relayer.low ? "warning" : "success"}>{relayer.low ? "Low balance" : "Healthy"}</Badge> : undefined}>
                {!relayer ? (statsErr ? <span className="muted">—</span> : <div className="stack-8"><Skeleton w={160} h={28} /><Skeleton /><Skeleton w="70%" /></div>) : (() => {
                  const spent = Number(relayer.spentTodayWei) / 1e18, budget = Number(relayer.dailyBudgetWei) / 1e18;
                  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
                  return (
                    <div className="stack-16">
                      <div>
                        <div className="kpi-label" title="WBT is the Whitechain network token used to pay transaction fees">Gas balance</div>
                        <div className="kpi-value">{fmtGas(relayer.balance)}<span className="cur">WBT</span></div>
                        <div className="kpi-sub">Network credit (WBT) used to pay transaction fees for your buyers</div>
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
                  <dd>{stats ? <span className="hash"><span className="v truncate" style={{ maxWidth: 260 }} title={stats.merchant.webhookUrl}>{stats.merchant.webhookUrl}</span><CopyButton value={stats.merchant.webhookUrl} /></span> : <Skeleton w={180} />}</dd>
                  <dt>Signing</dt>
                  <dd style={{ minWidth: 0 }}><span className="small text-2 kv-nowrap" title="HMAC-SHA256 · X-OpenBox-Signature header">HMAC-SHA256 · <code>X-OpenBox-Signature</code></span></dd>
                </dl>
                <div className="table-wrap" style={{ borderTop: "1px solid var(--border)" }}>
                  <table className="data compact">
                    <thead><tr><th>Event</th><th className="hide-sm">Status</th><th className="num">Delivered</th></tr></thead>
                    <tbody>
                      {!stats && !statsErr && <SkeletonRows rows={4} cols={3} />}
                      {stats && !stats.webhooks?.length && <tr><td colSpan={3}><EmptyState small icon="webhook" title="No deliveries yet">Events appear here as orders move.</EmptyState></td></tr>}
                      {(stats?.webhooks ?? []).slice(0, allHooks ? undefined : 10).map((w: any, i: number) => (
                        <tr key={i}>
                          <td className="mono">{w.event}</td>
                          <td className="hide-sm">{w.delivered_at ? <Badge tone="success">{w.status}</Badge> : <Badge tone="warning">Retrying · {w.attempts}</Badge>}</td>
                          <td className="num xs muted">{w.delivered_at ? <Timestamp ts={w.delivered_at} /> : <Badge tone="warning">Retrying</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </>
        )}

        {tab === "inspections" && (
          <div className="grid-main">
            <Card flush title="Audit trail" desc="Every inspection and payment, written to a public Hedera log."
              actions={hcs?.topicId ? <ExtLink href={hcs.live ? hashscan(agent?.policy?.network, "topic", hcs.topicId) : undefined}>View log on HashScan</ExtLink> : undefined}>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Time</th><th>Event</th><th>Order</th><th>Detail</th><th className="num">Entry</th></tr></thead>
                  <tbody>
                    {!hcs && <SkeletonRows rows={5} cols={5} />}
                    {hcs && !hcs.messages?.length && <tr><td colSpan={5}><EmptyState small icon="receipt" title="Nothing logged yet">Inspections are logged as they happen at the door.</EmptyState></td></tr>}
                    {(hcs?.messages ?? []).slice(0, 25).map((m: any) => {
                      const [label, tone] = AUDIT_LABEL[m.message.type] ?? [m.message.type, "neutral"];
                      const ts = m.consensusTimestamp ? Number(m.consensusTimestamp.split(".")[0]) : m.message.at;
                      return (
                        <tr key={m.sequence}>
                          <td className="xs muted nowrap"><Timestamp ts={ts} /></td>
                          <td className="nowrap"><Badge tone={tone}>{label}</Badge></td>
                          <td className="mono nowrap">{refByOrderId[m.message.orderId?.toLowerCase()] ?? <span className="muted">—</span>}</td>
                          <td className="text-2">
                            {m.message.outcome && <StatusBadge s={m.message.outcome} />}
                            {m.message.amountUsd != null && <Money v={m.message.amountUsd} cur="USDC" />}
                            {m.message.priceUsd != null && <>Asked <Money v={m.message.priceUsd} cur="USDC" />, limit {fmtAmount(agent?.policy?.approvalThreshold)} USDC</>}
                            {m.message.name && <>{m.message.name}</>}
                          </td>
                          <td className="num mono xs">#{m.sequence}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Delivery inspections" desc="The buyer's doorbell hires an independent inspector for each parcel.">
              {!agent ? <div className="stack-8"><Skeleton /><Skeleton w="80%" /><Skeleton w="60%" /></div> : (() => {
                const p = agent.policy;
                const pct = p.dailyBudget ? Math.min(100, (p.spentToday / p.dailyBudget) * 100) : 0;
                return (
                  <div className="stack-16">
                    <div>
                      <div className="row between small"><span className="text-2">Inspections today</span><span className="tnum">{fmtAmount(p.spentToday)} of {fmtAmount(p.dailyBudget)} USDC</span></div>
                      <div className="progress mt-8" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Inspection budget used"><span style={{ width: `${pct}%` }} /></div>
                    </div>
                    <dl className="dl">
                      <dt>Auto-approve up to</dt><dd><Money v={p.approvalThreshold} cur="USDC" /> per inspection</dd>
                      <dt>Preferred price</dt><dd>up to <Money v={p.maxPricePerCall} cur="USDC" /></dd>
                      <dt>Proof</dt><dd>{agent.topics?.live
                        ? <><ExtLink href={hashscan(p.network, "topic", agent.topics.inspectors)}>Directory</ExtLink><ExtLink href={hashscan(p.network, "topic", agent.topics.log)}>Log</ExtLink></>
                        : <span className="muted">Simulated network</span>}</dd>
                    </dl>
                    <div>
                      <h3 style={{ marginBottom: 8 }}>Inspectors</h3>
                      {Array.isArray(agent.inspectors) && agent.inspectors.map((c: any) => (
                        <div key={c.evmAddress} className="cand">
                          <div className="who"><span className={`avatar ${c.allowed ? "" : "muted-av"}`} style={c.allowed ? { background: "var(--brand)" } : undefined}>{c.name.slice(0, 2).toUpperCase()}</span><div className="grow"><div className="truncate">{c.name}</div><div className="xs muted"><Money v={c.priceUsd} cur="USDC" /> per inspection</div></div></div>
                          {c.allowed ? <Badge tone="success">Allowed</Badge> : <Badge tone="warning" title={c.reason}>Needs approval</Badge>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </Card>
          </div>
        )}

        {tab === "developers" && (
          <div className="grid-main">
            <Card title="Quickstart" desc="Add checkout with verified release to any page."
              actions={<div className="row" role="tablist" aria-label="Snippet">{Object.keys(SNIPPETS).map((k) => <button key={k} type="button" role="tab" aria-selected={snippet === k} className={`btn sm ${snippet === k ? "" : "ghost"}`} onClick={() => setSnippet(k)}>{k}</button>)}</div>}>
              <CodeBlock code={SNIPPETS[snippet]} />
            </Card>
            <Card title="API keys" desc="Testnet keys. Never put the secret key in a browser.">
              <dl className="dl">
                <dt>Publishable key</dt><dd><Hash value="pk_demo_openbox" full /></dd>
                <dt>Secret key</dt><dd><span className="muted mono">sk_••••••••</span><Badge tone="neutral" dot={false}>Server only</Badge></dd>
                <dt>Webhook endpoint</dt><dd>{stats ? <Hash value={stats.merchant.webhookUrl} head={14} tail={10} /> : <Skeleton w={160} />}</dd>
              </dl>
            </Card>
          </div>
        )}
      </main>

      <datalist id="stickers">{STICKERS.map((s) => <option key={s} value={s} />)}</datalist>

      {current && (
        <Drawer onClose={() => setOpen(undefined)} title={<span className="mono">{current.ref}</span>}
          sub={<div className="badges mt-8"><StatusBadge s={current.awaitingBuyer ? "awaiting_buyer" : current.status} />{current.outcome && <StatusBadge s={current.outcome} />}</div>}>
          <section>
            <div className="strong" style={{ fontSize: 16 }}>{current.product}</div>
            <div className="small muted">Placed <Timestamp ts={current.createdAt} mode="abs" /></div>
          </section>

          {["paid", "packed", "dispatched", "returning"].includes(current.status) && (
            <section>
              <h3>Next step</h3>
              {current.status === "paid" && (
                <form className="stack-12" onSubmit={(e) => { e.preventDefault(); act(current.ref, () => merchant("POST", `orders/${current.ref}/pack`, { serial: f(current.ref).serial })); }}>
                  <Field label="Serial on the parcel sticker" htmlFor="serial" help="The doorbell checks this against the label when the buyer opens the box.">
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
                  <div className="xs muted">The courier confirms with World ID before the parcel label is issued.</div>
                </form>
              )}
              {current.status === "packed" && worldReq[current.ref]?.verificationUri && (
                <div className="qr-panel">
                  <QR text={worldReq[current.ref].verificationUri} size={128} />
                  <div className="stack-8 small">
                    <StatusBadge s={worldReq[current.ref].status ?? "pending"} />
                    <div>Courier scans this to confirm their identity with World ID.</div>
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
                  <Callout tone="warning" title="Parcel is on its way back">The buyer has already been refunded. Confirm when the parcel reaches you.</Callout>
                  <button type="button" className="btn primary" disabled={busy === current.ref} onClick={() => act(current.ref, () => merchant("POST", `orders/${current.ref}/return-received`, {}))}><Icon name="return" /> Mark return received</button>
                </div>
              )}
            </section>
          )}

          <section>
            <h3>Payment</h3>
            <ul className="lines">
              <li><span>Order total</span><Money v={current.amount} /></li>
              <li><span>Courier fee</span><Money v={-Number(current.courierFee)} /></li>
              {Number(current.buyerRefunded) > 0 && <li><span>Refunded to buyer</span><Money v={-Number(current.buyerRefunded)} /></li>}
              <li className="total"><span>Net to you</span>{current.outcome || current.status === "settled" ? <Money v={current.sellerPaid} /> : <span className="muted">Held until delivery is verified</span>}</li>
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
            <h3>Inspection</h3>
            {current.inspection ? <InspectionList i={current.inspection} expected={current.serial} /> : <span className="small muted">Happens at the buyer's door when the box is opened.</span>}
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
              <p className="text-2">The refund pool pays buyers back on returns, so refunds never wait on your wallet.</p>
              <Field label="Amount (USDT)" htmlFor="pool" help={stats ? <>Available in your wallet: {fmtAmount(bal)} USDT · pool now {fmtAmount(stats.refundPool)} USDT</> : undefined}>
                <div className="input-group">
                  <input id="pool" className="input tnum" inputMode="decimal" placeholder="0.00" value={pool} aria-invalid={!!err} aria-describedby={err ? "pool-err" : undefined} onChange={(e) => setPool(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <button type="button" className="btn ghost sm" style={{ height: "auto", borderRadius: 0, borderTop: "1px solid var(--border-strong)", borderBottom: "1px solid var(--border-strong)" }} onClick={() => setPool(String(Math.floor(bal * 100) / 100))} disabled={!(bal > 0)}>Max</button>
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

function NextStep({ o, req, onOpen }: { o: any; req?: any; onOpen: () => void }) {
  const b = (label: string, primary = true) => <button type="button" className={`btn sm ${primary ? "primary" : ""}`} onClick={onOpen}>{label}</button>;
  if (o.status === "paid") return b("Pack order");
  if (o.status === "packed") return req?.verificationUri ? b("Courier check…", false) : b("Assign courier");
  if (o.status === "dispatched") return b("View label", false);
  if (o.status === "returning") return b("Mark received");
  if (o.awaitingBuyer) return <span className="small muted">Buyer deciding</span>;
  if (o.status === "handed_over") return <span className="small muted">Inspecting</span>;
  return <button type="button" className="btn ghost sm" onClick={onOpen}>View</button>;
}

function useModal(onClose: () => void) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = o; prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

function Drawer({ title, sub, children, onClose }: { title: ReactNode; sub?: ReactNode; children: ReactNode; onClose: () => void }) {
  const closeRef = useModal(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="drawer-h">
          <div><h2 id="drawer-title">{title}</h2>{sub}</div>
          <button ref={closeRef} type="button" className="btn ghost sm" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="drawer-b">{children}</div>
      </aside>
    </>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const closeRef = useModal(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="row between" style={{ padding: "20px 24px 0" }}>
          <h2 id="dialog-title">{title}</h2>
          <button ref={closeRef} type="button" className="btn ghost sm" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </>
  );
}
