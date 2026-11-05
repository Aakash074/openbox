"use client";
import { use, useState } from "react";
import { Top } from "../../components/Top";
import { HashscanLink, Pill, TxLink } from "../../components/ui";
import { api, useEvents, usePoll } from "../../lib/api";

export default function Buyer({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const tick = useEvents(ref);
  const [o, reload, err] = usePoll(() => api("GET", `/v1/orders/${ref}`), [ref, tick]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const accept = async () => {
    setBusy(true);
    try { await api("POST", `/v1/orders/${ref}/accept-partial-refund`); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); reload(); }
  };
  const steps = ["paid", "packed", "dispatched", "handed_over", "settled"];
  const idx = o ? Math.max(steps.indexOf(o.status === "returning" || o.status === "returned_to_seller" || o.status === "returned" ? "settled" : o.status), 0) : 0;
  return (
    <>
      <Top title={`Your order ${ref}`} />
      <div className="wrap" style={{ maxWidth: 860 }}>
        {err && <div className="banner bad">{err}</div>}
        {msg && <div className="banner bad">{msg}</div>}
        {o && (
          <>
            <div className="steps">{["Paid & held", "Packed", "Out with courier", "At your door", "Settled"].map((l, i) => <div key={l} className={i === idx ? "on" : i < idx ? "done" : ""}>{l}</div>)}</div>
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div><h1>{o.product}</h1><div className="muted">{o.amount} USDT (courier fee {o.courierFee}) · checkout with verified release</div></div>
                <div><Pill s={o.status} /> {o.outcome && <Pill s={o.outcome} />}</div>
              </div>
              {o.status === "dispatched" && <div className="banner info">{o.courier} is on the way. Open the box at your doorbell when it arrives: you pay the seller only if it's what you ordered.</div>}
              {o.awaitingBuyer && (
                <div className="banner warn">The inspector found damage. <button className="primary" disabled={busy} onClick={accept}>Accept {o.inspection.refundBps / 100}% partial refund</button></div>
              )}
              {o.outcome === "mismatch" && <div className="banner bad">Not what you ordered. You were refunded {o.buyerRefunded} USDT. The parcel goes back with the courier.</div>}
              {o.outcome === "match" && <div className="banner ok">Verified. The seller has been paid.</div>}
              {o.status === "returned" && <div className="banner ok">Return verified (serial matched). Refunded {o.buyerRefunded} USDT.</div>}
              <div className="grid3" style={{ marginTop: 10 }}>
                <div className="kpi"><b>{o.buyerRefunded}</b><span>refunded to you</span></div>
                <div className="kpi"><b>{o.sellerPaid}</b><span>paid to seller</span></div>
                <div className="kpi"><b>{o.courierPaid}</b><span>paid to courier</span></div>
              </div>
            </div>
            <div className="grid2" style={{ marginTop: 14 }}>
              <div className="card">
                <h2>Receipts you can check</h2>
                <table><tbody>{o.receipts.map((r: any) => (
                  <tr key={r.txHash + r.event}><td>{r.event}</td><td className="small">{r.data.amount ? `${(Number(r.data.amount) / 1e6).toFixed(2)} USDT` : ""}</td><td><TxLink url={r.explorerUrl} hash={r.txHash} /></td></tr>
                ))}</tbody></table>
              </div>
              <div className="card">
                <h2>Inspection</h2>
                {o.inspection ? (
                  <div className="small">
                    <div><Pill s={o.inspection.outcome} /> serial read <code>{o.inspection.serialRead || "none"}</code>, damage {o.inspection.damage}</div>
                    <div>Neutral inspector: {o.inspection.inspectorName} (paid by your doorbell agent, {o.inspection.payment?.amountUsd} USDC) <HashscanLink txId={o.inspection.payment?.hederaTx} url={o.inspection.payment?.hashscan} /></div>
                    <div>Public verdict log: HCS #{o.inspection.hcs?.sequence} on {o.inspection.hcs?.topicId}</div>
                  </div>
                ) : <span className="muted small">Happens at your door when you open the box.</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
