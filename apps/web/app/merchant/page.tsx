"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Top } from "../components/Top";
import { BalanceStrip, HashscanLink, Pill, TxLink } from "../components/ui";
import { api, merchant, short, usd, useEvents, usePoll } from "../lib/api";

const STICKERS = ["SN-AX1-7731-0042", "SN-PBP-5520-0007", "SN-LT11-3304-0019", "SN-AX1-7731-1001"];
const DEMO_COURIER = process.env.NEXT_PUBLIC_DEMO_COURIER ?? "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955";
const SNIPPET = `<script src="https://cdn.openbox.dev/openbox-checkout.js"></script>
<div id="checkout"></div>
<script>
  OpenBox.mount("#checkout", {
    publishableKey: "pk_live_…",   // safe in the browser
    sku: "aurora-x1",              // price from your catalog
    wallet: "passkey",             // embedded key, no popup
    onPaid: ({ ref, explorerUrl }) => markPaid(ref),
  });
</script>
// webhooks → POST /webhooks/openbox (HMAC-signed)
//   order.paid · order.dispatched · order.handed_over
//   courier.paid · order.settled · seller.paid
//   buyer.refunded · order.return_to_sender · order.return_refunded`;

function QR({ text, size = 160 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => { QRCode.toDataURL(text, { margin: 1, width: size }).then(setSrc); }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt="QR" /> : null;
}

export default function Merchant() {
  const tick = useEvents();
  const [stats, reloadStats] = usePoll(() => merchant("GET", "stats"), [tick]);
  const [orders, reloadOrders, err] = usePoll<any[]>(() => merchant("GET", "orders"), [tick]);
  const [agent] = usePoll(() => api("GET", "/v1/agent/status"), [tick]);
  const [hcs] = usePoll(() => api("GET", "/v1/hcs/log"), [tick]);
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [form, setForm] = useState<Record<string, { serial?: string; courier?: string; payout?: string }>>({});
  const [worldReq, setWorldReq] = useState<Record<string, any>>({});
  const [pool, setPool] = useState("100");

  useEvents(undefined, (e) => {
    if (e.type === "world.request" && e.ref) setWorldReq((w) => ({ ...w, [e.ref!]: { ...(w[e.ref!] ?? {}), status: e.data?.status, note: e.data?.note } }));
  });

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setMsg(undefined);
    try { await fn(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(undefined); reloadOrders(); reloadStats(); }
  };
  const f = (ref: string) => form[ref] ?? {};
  const setF = (ref: string, p: object) => setForm((x) => ({ ...x, [ref]: { ...x[ref], ...p } }));

  const t = stats?.totals ?? {};
  const relayer = stats?.relayer;
  return (
    <>
      <Top title="Merchant dashboard" sub={stats ? `· ${stats.merchant.name}` : ""} />
      <BalanceStrip />
      <div className="wrap">
        {msg && <div className="banner bad">{msg}</div>}
        {err && <div className="banner bad">Backend: {err}</div>}

        <div className="grid3" style={{ marginBottom: 16 }}>
          <div className="card">
            <h2>Integration · 20 lines</h2>
            <pre className="code" style={{ maxHeight: 230 }}>{SNIPPET}</pre>
          </div>
          <div className="card">
            <h2>Money</h2>
            <div className="grid3">
              <div className="kpi"><b>{t.orders ?? 0}</b><span>orders</span></div>
              <div className="kpi"><b>{usd((t.sellerPaid ?? 0) / 1e6)}</b><span>paid to you</span></div>
              <div className="kpi"><b>{usd((t.refunded ?? 0) / 1e6)}</b><span>refunded</span></div>
              <div className="kpi"><b>{usd((t.courierPaid ?? 0) / 1e6)}</b><span>courier fees</span></div>
              <div className="kpi"><b>{usd(stats?.refundPool)}</b><span>refund pool</span></div>
              <div className="kpi"><b>{usd(stats?.sellerBalance)}</b><span>wallet USDT</span></div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <a className="btn primary" href="/api/merchant/export.csv">⬇ Accountant CSV</a>
              <input style={{ width: 80 }} value={pool} onChange={(e) => setPool(e.target.value)} />
              <button disabled={busy === "pool"} onClick={() => act("pool", () => merchant("POST", "refund-pool", { amount: Number(pool) }))}>Top up refund pool</button>
            </div>
          </div>
          <div className="card">
            <h2>Gas relayer (buyers never pay gas)</h2>
            {relayer && (
              <>
                <div className="row"><b style={{ fontSize: 20 }}>{Number(relayer.balance).toFixed(4)} WBT</b>{relayer.low && <Pill s="low balance" />}</div>
                <div className="small muted">Spent today {(Number(relayer.spentTodayWei) / 1e18).toFixed(5)} / budget {(Number(relayer.dailyBudgetWei) / 1e18).toFixed(3)} WBT</div>
                <div className="small" style={{ marginTop: 8 }}><b>Top-up:</b> the merchant funds the relayer: claim WBT at faucet.testnet.whitechain.io (testnet) or send WBT to <code>{relayer.address}</code>.</div>
                <div className="small" style={{ marginTop: 8 }}><b>Drain caps:</b></div>
                <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  <li>Function allowlist: checkout flows, account factory, smart-account <code>execute</code> (inner calls: USDT.approve(checkout) + createOrder only)</li>
                  <li>Per-tx gas cap: {Number(relayer.maxGasPerTx).toLocaleString()} gas</li>
                  <li>Rate limits: per IP / minute and per buyer wallet / hour</li>
                  <li>Daily WBT budget, low-balance alert</li>
                </ul>
              </>
            )}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Orders</h2>
          <table>
            <thead><tr><th>Order</th><th>Item</th><th>Status</th><th>Amount</th><th>Buyer</th><th>Courier</th><th>Refunded</th><th>Next step</th></tr></thead>
            <tbody>
              {(orders ?? []).filter((o) => o.status !== "created").map((o) => (
                <>
                  <tr key={o.ref} onClick={() => setOpen(open === o.ref ? undefined : o.ref)} style={{ cursor: "pointer" }}>
                    <td><b>{o.ref}</b><div className="small muted">{new Date(o.createdAt * 1000).toLocaleTimeString()}</div></td>
                    <td>{o.product}<div className="small muted mono">{o.serial ?? ""}</div></td>
                    <td><Pill s={o.status} /> {o.outcome && <Pill s={o.outcome} />}{o.awaitingBuyer && <div className="small muted">awaiting buyer tap</div>}</td>
                    <td>{o.amount}<div className="small muted">fee {o.courierFee}</div></td>
                    <td className="mono">{short(o.buyer)}</td>
                    <td>{o.courier ?? "—"}<div className="small muted mono">{short(o.courierPayout)}</div></td>
                    <td>{Number(o.buyerRefunded) > 0 ? <b style={{ color: "var(--bad)" }}>{o.buyerRefunded}</b> : "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {o.status === "paid" && (
                        <div className="row">
                          <input list="stickers" placeholder="serial on sticker" value={f(o.ref).serial ?? ""} onChange={(e) => setF(o.ref, { serial: e.target.value })} style={{ width: 160 }} />
                          <button className="primary" disabled={!f(o.ref).serial || busy === o.ref} onClick={() => act(o.ref, () => merchant("POST", `orders/${o.ref}/pack`, { serial: f(o.ref).serial }))}>Pack</button>
                        </div>
                      )}
                      {o.status === "packed" && !worldReq[o.ref]?.verificationUri && (
                        <div className="row">
                          <input placeholder="courier name" value={f(o.ref).courier ?? "Alice"} onChange={(e) => setF(o.ref, { courier: e.target.value })} style={{ width: 90 }} />
                          <input placeholder="payout 0x…" value={f(o.ref).payout ?? DEMO_COURIER} onChange={(e) => setF(o.ref, { payout: e.target.value })} style={{ width: 120 }} />
                          <button className="primary" disabled={busy === o.ref} onClick={() => act(o.ref, async () => {
                            const r = await merchant("POST", `orders/${o.ref}/dispatch`, { courierName: f(o.ref).courier ?? "Alice", payout: f(o.ref).payout ?? DEMO_COURIER });
                            setWorldReq((w) => ({ ...w, [o.ref]: r }));
                          })}>Assign courier (World check)</button>
                        </div>
                      )}
                      {o.status === "packed" && worldReq[o.ref]?.verificationUri && (
                        <div className="row">
                          <QR text={worldReq[o.ref].verificationUri} size={96} />
                          <div className="small">Courier scans to verify with World ID<br /><a href={worldReq[o.ref].verificationUri} target="_blank" rel="noreferrer">open courier page ↗</a><br /><Pill s={worldReq[o.ref].status ?? "pending"} /></div>
                        </div>
                      )}
                      {o.status === "dispatched" && o.qr && (
                        <div className="row"><QR text={o.qr} size={110} /><div className="small">One-time parcel label<br />signed by you, names {o.courier}</div></div>
                      )}
                      {o.status === "returning" && (
                        <button disabled={busy === o.ref} onClick={() => act(o.ref, () => merchant("POST", `orders/${o.ref}/return-received`, {}))}>Mark return received</button>
                      )}
                    </td>
                  </tr>
                  {open === o.ref && (
                    <tr key={o.ref + "x"}><td colSpan={8} style={{ background: "#f8fafc" }}>
                      <div className="grid2">
                        <div>
                          <h2>On-chain receipts</h2>
                          <table><tbody>{o.receipts.map((r: any) => (
                            <tr key={r.txHash + r.event}><td>{r.event}</td><td className="small">{r.data.amount ? `${(Number(r.data.amount) / 1e6).toFixed(2)} USDT` : r.data.outcome ?? ""}</td><td><TxLink url={r.explorerUrl} hash={r.txHash} /></td></tr>
                          ))}</tbody></table>
                        </div>
                        <div>
                          <h2>Inspection</h2>
                          {o.inspection ? (
                            <div className="small">
                              <div><Pill s={o.inspection.outcome} /> read <code>{o.inspection.serialRead || "(no serial)"}</code> · damage {o.inspection.damage} · {o.inspection.provider}</div>
                              <div>Paid {o.inspection.inspectorName} {o.inspection.payment?.amountUsd} USDC: <HashscanLink txId={o.inspection.payment?.hederaTx} url={o.inspection.payment?.hashscan} /></div>
                              <div>HCS verdict #{o.inspection.hcs?.sequence} on {o.inspection.hcs?.topicId}</div>
                            </div>
                          ) : <span className="muted small">not inspected yet</span>}
                        </div>
                      </div>
                    </td></tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          <datalist id="stickers">{STICKERS.map((s) => <option key={s} value={s} />)}</datalist>
        </div>

        <div className="grid3">
          <div className="card">
            <h2>Webhook deliveries</h2>
            <div className="small muted">→ {stats?.merchant.webhookUrl}</div>
            <table><tbody>{(stats?.webhooks ?? []).map((w: any, i: number) => (
              <tr key={i}><td className="mono">{w.event}</td><td>{w.delivered_at ? <span style={{ color: "var(--ok)" }}>{w.status} ✓</span> : <span className="muted">retry {w.attempts}</span>}</td></tr>
            ))}</tbody></table>
          </div>
          <div className="card">
            <h2>Household agent (x402 on Hedera)</h2>
            {agent && (
              <div className="small">
                <div>Budget {agent.policy.spentToday.toFixed(2)} / {agent.policy.dailyBudget} USDC today · max {agent.policy.maxPricePerCall}/call · no-human cap {agent.policy.approvalThreshold}</div>
                <div className="muted">Directory {agent.topics.inspectors} · log {agent.topics.log} {agent.topics.live ? "" : "(mock)"}</div>
                {Array.isArray(agent.inspectors) && agent.inspectors.map((c: any) => (
                  <div key={c.evmAddress} className={`cand ${c.allowed ? "yes" : "no"}`}><span>{c.name} · ${c.priceUsd}</span><span>{c.allowed ? "allowed" : c.reason}</span></div>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <h2>HCS audit log</h2>
            <div className="small" style={{ maxHeight: 260, overflow: "auto" }}>
              {(hcs?.messages ?? []).slice(0, 25).map((m: any) => (
                <div key={m.sequence} style={{ padding: "3px 0", borderBottom: "1px dashed var(--line)" }}>
                  <b>#{m.sequence}</b> {m.message.type} {m.message.outcome ?? ""} {m.message.amountUsd ? `${m.message.amountUsd} USDC` : ""} {m.message.reason ? <span className="muted">{m.message.reason}</span> : ""}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
