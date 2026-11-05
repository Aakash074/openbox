"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, usePoll } from "../lib/api";

const PERSONAS: [string, string][] = [["alice", "Alice (assigned courier)"], ["mallory", "Mallory (not the courier)"], ["bob", "Bob (another courier)"]];

function Courier() {
  const id = useSearchParams().get("req") ?? "";
  const [r, reload] = usePoll(() => api("GET", `/v1/world/requests/${id}`), [id], 1000);
  const [busy, setBusy] = useState(false);
  const done = r && !["pending", "creating", "validating"].includes(r.status);
  const go = async (persona: string, decision: "approve" | "deny") => {
    setBusy(true);
    try { await api("POST", "/v1/world/mock/complete", { requestId: id, persona, decision }); } finally { setBusy(false); reload(); }
  };
  const good = ["dispatched", "handed_over", "verified"].includes(r?.status);
  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: 18 }}>
      <h1 style={{ marginBottom: 4 }}>World ID check</h1>
      <div className="muted small">{r?.purpose === "dispatch" ? `Courier assignment for order ${r?.orderRef}` : `Handover at the door · order ${r?.orderRef ?? ""}`}</div>
      {!r && <p>Loading…</p>}
      {r && !done && (r.mode === "agentpass" || r.mode === "idkit") && (
        <div className="card" style={{ marginTop: 14 }}>
          <p>Approve this check in World ID. Only approve a verification you started.</p>
          {r.userCode && <p>Code: <b className="mono" style={{ fontSize: 22 }}>{r.userCode}</b></p>}
          <a className="btn primary" href={r.verificationUri} target="_blank" rel="noreferrer">Open World ID</a>
        </div>
      )}
      {r && !done && r.mode === "mock" && (
        <div className="card" style={{ marginTop: 14 }}>
          <p className="small muted">Mock World check (fake identities). Each person has a stable ID.</p>
          {PERSONAS.map(([p, label]) => (
            <div key={p} className="row" style={{ justifyContent: "space-between", margin: "8px 0" }}>
              <span>{label}</span>
              <span className="row"><button className="primary" disabled={busy} onClick={() => go(p, "approve")}>Verify</button><button disabled={busy} onClick={() => go(p, "deny")}>Decline</button></span>
            </div>
          ))}
        </div>
      )}
      {r && done && (
        <div className={`banner ${good ? "ok" : "bad"}`} style={{ marginTop: 14 }}>
          {r.status === "dispatched" && "✓ You're bound to this order. Carry the parcel."}
          {r.status === "handed_over" && "✓ Verified: same courier as at dispatch. Handover recorded."}
          {!good && `✗ ${r.status.replace(/_/g, " ")}${r.reason ? `: ${r.reason}` : ""}. Nothing was paid.`}
        </div>
      )}
      {r && <ul className="timeline" style={{ marginTop: 14 }}>{r.timeline.map((t: any, i: number) => <li key={i}><b>{t.status}</b> {t.note && <span className="muted">· {t.note}</span>}</li>)}</ul>}
    </div>
  );
}

export default function Page() {
  return <Suspense><Courier /></Suspense>;
}
