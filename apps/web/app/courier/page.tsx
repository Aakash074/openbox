"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MiniTop } from "../components/Top";
import { Badge, Callout, EmptyState, Icon, Skeleton, StatusBadge, Stepper, Timestamp, type StepState } from "../components/ui";
import { api } from "../lib/api";

const PERSONAS: { id: string; name: string; note: string; color: string }[] = [
  { id: "alice", name: "Alice", note: "Assigned courier", color: "#0F766E" },
  { id: "mallory", name: "Mallory", note: "Not the courier", color: "#B42318" },
  { id: "bob", name: "Bob", note: "Another courier", color: "#175CD3" },
];
const OPEN = ["pending", "creating", "validating"];
const GOOD = ["dispatched", "handed_over", "verified"];

/** Poll a World check every second; stop on a terminal status or when the request doesn't exist. */
function useRequest(id: string) {
  const [r, setR] = useState<any>();
  const [err, setErr] = useState<string>();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!id) return;
    let live = true, t: ReturnType<typeof setTimeout> | undefined;
    const run = () => api("GET", `/v1/world/requests/${encodeURIComponent(id)}`)
      .then((x) => { if (!live) return; setR(x); setErr(undefined); if (OPEN.includes(x.status)) t = setTimeout(run, 1000); })
      .catch((e) => { if (!live) return; setErr((e as Error).message); if (!/not found|404/i.test((e as Error).message)) t = setTimeout(run, 3000); });
    run();
    return () => { live = false; if (t) clearTimeout(t); };
  }, [id, n]);
  return [r, useCallback(() => setN((x) => x + 1), []), err] as const;
}

function Courier() {
  const id = useSearchParams().get("req") ?? "";
  const [r, reload, err] = useRequest(id);
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const done = r && !OPEN.includes(r.status);
  const good = GOOD.includes(r?.status);
  const go = async (persona: string, decision: "approve" | "deny") => {
    setBusy(persona + decision); setMsg(undefined);
    try { await api("POST", "/v1/world/mock/complete", { requestId: id, persona, decision }); } catch (e) { setMsg((e as Error).message); } finally { setBusy(undefined); reload(); }
  };
  const isDispatch = r?.purpose === "dispatch";
  const steps: { label: string; state: StepState }[] = [
    { label: isDispatch ? "Assigned" : "At the door", state: "done" },
    { label: "Verify identity", state: !r ? "upcoming" : done ? (good ? "done" : "failed") : "current" },
    { label: isDispatch ? "Carry parcel" : "Handover", state: done && good ? "done" : "upcoming" },
  ];

  return (
    <>
      <MiniTop left={<span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><Icon name="truck" /><span className="store truncate">Courier check{r?.orderRef ? <span className="muted" style={{ fontWeight: 400 }}> · <span className="mono">{r.orderRef}</span></span> : null}</span></span>} />
      <main className="page" style={{ maxWidth: 480, fontSize: 16 }}>
        {!id && (
          <div className="card mt-24">
            <EmptyState icon="scan" title="Scan a QR code to start">
              Scan the QR on the doorbell screen or on the merchant&apos;s dispatch screen to start an identity check.
            </EmptyState>
          </div>
        )}
        {id && err && !r && (
          /not found|404/i.test(err)
            ? <div className="card mt-24"><EmptyState icon="x-circle" title="This check link isn't valid">It may have expired or already been used. Scan the QR code again to start a new check.</EmptyState></div>
            : <Callout tone="danger" title="Can't load this check" action={<button type="button" className="btn sm" onClick={reload}>Try again</button>}>Check your connection and try again.</Callout>
        )}
        {id && !r && !err && <div className="stack-12 mt-24" aria-busy="true"><Skeleton h={28} w="70%" /><Skeleton /><Skeleton h={140} /></div>}

        {r && (
          <div className="stack-24">
            <div>
              <h1>{isDispatch ? "Confirm you're the courier" : "Confirm handover"}</h1>
              <div className="text-2 small mt-8">
                {isDispatch ? <>You&apos;re being assigned order <span className="mono">{r.orderRef}</span>.</> : <>You&apos;re at the door with order <span className="mono">{r.orderRef}</span>.</>}
                {" "}The same verified person must collect and deliver the parcel.
              </div>
            </div>
            <div className="card card-b"><Stepper steps={steps} responsive={false} label="Check progress" /></div>

            {msg && <Callout tone="danger" title="That didn't go through">{msg}</Callout>}

            {!done && (r.mode === "agentpass" || r.mode === "idkit") && (
              <div className="card card-b stack-16">
                <p>Approve this check in World ID. Only approve a verification you started.</p>
                {r.userCode && <div><div className="xs muted">Your code</div><div className="mono strong" style={{ fontSize: 28, letterSpacing: ".08em" }}>{r.userCode}</div></div>}
                <a className="btn primary lg block" href={r.verificationUri} target="_blank" rel="noreferrer"><Icon name="shield" /> Open World ID</a>
              </div>
            )}

            {!done && r.mode === "mock" && (
              <div>
                <div className="row between" style={{ marginBottom: 10 }}><h2>Who&apos;s verifying?</h2><Badge tone="neutral">Demo identities</Badge></div>
                {PERSONAS.map((p) => (
                  <div key={p.id} className="persona">
                    <span className="avatar lg" style={{ background: p.color }}>{p.name[0]}</span>
                    <div className="grow"><div className="strong">{p.name}</div><div className="small muted">{p.note}</div></div>
                    <div className="row" style={{ flexWrap: "nowrap" }}>
                      <button type="button" className="btn" disabled={!!busy} onClick={() => go(p.id, "deny")} aria-label={`Decline as ${p.name}`}>Decline</button>
                      <button type="button" className="btn primary" disabled={!!busy} onClick={() => go(p.id, "approve")} aria-label={`Verify as ${p.name}`}>{busy === p.id + "approve" && <Icon name="loader" className="spin" />}Verify</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {done && (
              good ? (
                <Callout tone="success" title={r.status === "handed_over" ? "Handover confirmed" : "You're assigned to this order"}>
                  {r.status === "handed_over" ? "Same courier as at pickup. The buyer can now open the box at the door." : r.status === "dispatched" ? "Take the parcel to the buyer. Your fee is paid when the handover is confirmed." : "Identity confirmed."}
                </Callout>
              ) : (
                <Callout tone={["expired", "cancelled"].includes(r.status) ? "neutral" : "danger"} title={r.status === "wrong_courier" ? "Not the assigned courier" : `Check ${String(r.status).replace(/_/g, " ")}`}>
                  {r.reason ? `${r.reason.replace(/^./, (c: string) => c.toUpperCase())}. ` : ""}Nothing was paid.
                </Callout>
              )
            )}

            {r.timeline?.length > 0 && (
              <div className="card card-b">
                <h3 style={{ marginBottom: 12 }}>Activity</h3>
                <ul className="timeline">
                  {r.timeline.map((t: any, i: number) => (
                    <li key={i} className={GOOD.includes(t.status) || OPEN.includes(t.status) ? "" : "bad"}>
                      <div className="row between"><StatusBadge s={t.status} /><span className="t-meta"><Timestamp ts={t.at} mode="time" /></span></div>
                      {t.note && <div className="t-meta" style={{ marginTop: 4 }}>{t.note}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}

export default function Page() {
  return <Suspense><Courier /></Suspense>;
}
