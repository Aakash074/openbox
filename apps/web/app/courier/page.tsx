"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MiniTop } from "../components/Top";
import { Badge, Callout, EmptyState, Icon, Skeleton, StatusBadge, Stepper, Timestamp, fmtAmount, type StepState } from "../components/ui";
import { api, usePoll } from "../lib/api";
import { APPROVAL_LABEL, APPROVAL_OPEN, ApprovalTimeline, CountdownRing, DemoApprover, approvalTone, hhmm, inText, useNow } from "../components/approval";
import { Courier as CourierArt, RoleTile, SearchParcel, VerdictCheck } from "../components/art";
import "../styles/courier.css";

const PERSONAS: { id: string; name: string; note: string; color: string }[] = [
  { id: "alice", name: "Alice", note: "Assigned courier", color: "#0F766E" },
  { id: "mallory", name: "Mallory", note: "Not the courier", color: "#B42318" },
  { id: "bob", name: "Bob", note: "Another courier", color: "#175CD3" },
];
const OPEN = ["pending", "creating", "validating"];
const WIDTH = 520;
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
  if (r?.purpose === "approve_refund") return <HouseholdApproval r={r} reload={reload} />;
  const isDispatch = r?.purpose === "dispatch";
  const steps: { label: string; state: StepState }[] = [
    { label: isDispatch ? "Assigned" : "At the door", state: "done" },
    { label: "Verify identity", state: !r ? "upcoming" : done ? (good ? "done" : "failed") : "current" },
    { label: isDispatch ? "Carry parcel" : "Handover", state: done && good ? "done" : "upcoming" },
  ];
  // Mock mode: the courier named on the request is the one primary choice; the others demo a wrong-courier attempt.
  const assigned = PERSONAS.find((p) => p.name.toLowerCase() === String(r?.courierName ?? "").toLowerCase()) ?? PERSONAS[0];
  const others = PERSONAS.filter((p) => p.id !== assigned.id);
  const top = (
    <MiniTop width={WIDTH} left={<span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><Icon name="truck" /><span className="store truncate">Courier check{r?.orderRef ? <span className="muted hide-sm" style={{ fontWeight: 400 }}> · <span className="mono">{r.orderRef}</span></span> : null}</span></span>} />
  );

  return (
    <>
      {top}
      <main className="page lg-type courier" style={{ maxWidth: WIDTH }}>
        {!id && (
          <div className="card mt-24 courier-empty">
            <div className="ce-art"><RoleTile role="courier" size={240} /></div>
            <h1 className="t-h2">Scan a QR code to start</h1>
            <p>Couriers confirm who they are with World ID twice: once at pickup and again at the door. The parcel&apos;s money is only released to the same verified person.</p>
            <p className="xs muted">In this hosted demo the courier&apos;s World ID check is simulated with sample identities.</p>
            <ol className="ce-steps">
              <li><Icon name="scan" /><span>Scan the QR on the merchant&apos;s dispatch screen or the doorbell</span></li>
              <li><Icon name="shield-check" /><span>Confirm it&apos;s you with World ID</span></li>
              <li><Icon name="truck" /><span>Deliver, and your fee is paid at the handover</span></li>
            </ol>
          </div>
        )}
        {id && err && !r && (
          /not found|404/i.test(err)
            ? <div className="card mt-24"><EmptyState art={<SearchParcel />} title="This check link isn't valid">It may have expired or already been used. Scan the QR code again to start a new check.</EmptyState></div>
            : <Callout tone="danger" title="Can't load this check" action={<button type="button" className="btn sm" onClick={reload}>Try again</button>}>Check your connection and try again.</Callout>
        )}
        {id && !r && !err && <div className="stack-12 mt-24" aria-busy="true"><Skeleton h={88} w={88} r={44} /><Skeleton h={28} w="70%" /><Skeleton /><Skeleton h={140} /></div>}

        {r && (
          <div className="stack-24">
            <div className="courier-hero">
              <CourierArt size={96} verified={done && good} className="fade-in" />
              <div>
                <h1>{isDispatch ? "Confirm you're the courier" : "Confirm handover"}</h1>
                <p className="text-2">
                  {isDispatch ? <>You&apos;re being assigned order <span className="mono">{r.orderRef}</span>.</> : <>You&apos;re at the door with order <span className="mono">{r.orderRef}</span>.</>}
                  {" "}The same verified person must collect and deliver the parcel.
                </p>
              </div>
            </div>
            <div className="card card-b"><Stepper steps={steps} responsive={false} label="Check progress" /></div>

            {msg && <Callout tone="danger" title="That didn't go through">{msg}</Callout>}

            {!done && (r.mode === "agentpass" || r.mode === "idkit") && (
              <div className="card card-b stack-16 fade-in">
                <div className="row between"><Badge tone="proof" dot={false}><Icon name="shield-check" /> World ID</Badge><StatusBadge s={r.status} /></div>
                <p style={{ margin: 0 }}>Approve this check in World ID. Only approve a verification you started.</p>
                {r.userCode && <div className="ra-code"><span className="ra-label">Your code</span><span className="mono">{r.userCode}</span></div>}
                <a className="btn primary lg block" href={r.verificationUri} target="_blank" rel="noreferrer"><Icon name="shield-check" /> Open World ID</a>
              </div>
            )}

            {!done && r.mode === "mock" && (
              <div className="card verify-card fade-in">
                <div className="card-b stack-16">
                  <div className="row between"><h2 className="t-h3" style={{ margin: 0 }}>Verify with World ID</h2><Badge tone="neutral" title="This hosted demo uses sample identities instead of a real World ID check">Demo identities</Badge></div>
                  <div className="persona primary-persona">
                    <span className="avatar lg" style={{ background: assigned.color }}>{assigned.name[0]}</span>
                    <div className="grow"><div className="strong">{assigned.name}</div><div className="small muted">{assigned.note}</div></div>
                    <StatusBadge s={r.status} />
                  </div>
                  <div className="verify-actions">
                    <button type="button" className="btn primary lg" disabled={!!busy} onClick={() => go(assigned.id, "approve")} aria-label={`Verify as ${assigned.name}`}>
                      {busy === assigned.id + "approve" ? <Icon name="loader" className="spin" /> : <Icon name="shield-check" />} Verify as {assigned.name}
                    </button>
                    <button type="button" className="btn lg" disabled={!!busy} onClick={() => go(assigned.id, "deny")} aria-label={`Decline as ${assigned.name}`}>{busy === assigned.id + "deny" && <Icon name="loader" className="spin" />}Decline</button>
                  </div>
                  <p className="xs muted" style={{ margin: 0 }}>In this hosted demo the courier&apos;s World ID check is simulated with sample identities. The household refund approval uses real World ID Agent Pass when the server is configured for it.</p>
                </div>
                <details className="other-personas">
                  <summary><Icon name="chevron-right" /><span>Try as someone else <span className="muted">· shows a wrong-courier attempt</span></span></summary>
                  <div className="stack-8">
                    {others.map((p) => (
                      <div key={p.id} className="persona sm">
                        <span className="avatar lg" style={{ background: p.color }}>{p.name[0]}</span>
                        <div className="grow"><div className="strong">{p.name}</div><div className="small muted">{p.note}</div></div>
                        <button type="button" className="btn sm" disabled={!!busy} onClick={() => go(p.id, "approve")} aria-label={`Verify as ${p.name}`}>{busy === p.id + "approve" && <Icon name="loader" className="spin" />}Verify as {p.name}</button>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {done && (
              good ? (
                <div className="courier-result success fade-in" role="status">
                  <VerdictCheck size={56} />
                  <div>
                    <div className="cr-title">{r.status === "handed_over" ? "Handover confirmed" : "You're assigned to this order"}</div>
                    <div className="cr-body">{r.status === "handed_over" ? "Same courier as at pickup. The buyer can now open the box at the door." : r.status === "dispatched" ? "Take the parcel to the buyer. Your fee is paid when the handover is confirmed." : "Identity confirmed."}</div>
                  </div>
                </div>
              ) : (
                <div className={`courier-result ${["expired", "cancelled"].includes(r.status) ? "neutral" : "danger"} fade-in`} role="alert">
                  {["expired", "cancelled"].includes(r.status) ? <span className="cr-icon"><Icon name="clock" /></span> : <VerdictCheck tone="danger" size={56} />}
                  <div>
                    <div className="cr-title">{r.status === "wrong_courier" ? "Not the assigned courier" : `Check ${String(r.status).replace(/_/g, " ")}`}</div>
                    <div className="cr-body">{r.reason ? `${r.reason.replace(/^./, (c: string) => c.toUpperCase())}. ` : ""}Nothing was paid.</div>
                  </div>
                </div>
              )
            )}

            {r.timeline?.length > 0 && (
              <div className="card card-b">
                <h3 style={{ marginBottom: 16 }}>Activity</h3>
                <ol className="tl">
                  {r.timeline.map((t: any, i: number) => (
                    <li key={i} className={`${GOOD.includes(t.status) ? "good" : OPEN.includes(t.status) ? "" : "bad"} fade-in`}>
                      <span className="tl-dot" aria-hidden="true" />
                      <div className="tl-body"><span><StatusBadge s={t.status} live={false} /></span>{t.note && <span className="tl-note">{t.note}</span>}</div>
                      <span className="tl-time"><Timestamp ts={t.at} mode="time" /></span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}

/** Phone page for the household owner's World ID Agent Pass approval (mock mode lands here from the QR). */
function HouseholdApproval({ r, reload }: { r: any; reload: () => void }) {
  const open = APPROVAL_OPEN.includes(r.status);
  const nowS = useNow();
  const [order] = usePoll<any>(() => api("GET", `/v1/orders/${encodeURIComponent(r.orderRef)}`), [r.orderRef, r.status]);
  const deadline: number | null | undefined = order?.decisionDeadline;
  const bps = Number(order?.inspection?.refundBps ?? 0);
  const refund = order && bps ? ((Number(order.amount) - Number(order.courierFee)) * bps) / 10000 : undefined;
  const handedAt = order?.receipts?.find((x: any) => x.event === "HandedOver")?.at;
  const tone = approvalTone(r.status) as "success" | "danger" | "neutral" | "info";
  const ok = r.status === "refunded" || r.status === "verified";
  return (
    <>
      <MiniTop width={WIDTH} left={<span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><Icon name="shield" /><span className="store nowrap">Approval <span className="muted hide-sm" style={{ fontWeight: 400 }}>· <span className="mono">{r.orderRef}</span></span></span></span>} />
      <main className="page lg-type courier" style={{ maxWidth: WIDTH }}>
        <div className="stack-24">
          <div>
            <Badge tone="proof" dot={false}><Icon name="shield-check" /> World ID Agent Pass</Badge>
            <h1 className="mt-12">Approve a refund for your agent</h1>
            <p className="text-2" style={{ margin: "8px 0 0" }}>
              Your OpenBox agent wants to accept a partial refund for damaged order <span className="mono">{r.orderRef}</span> and let you keep the item.
              Refunds the agent accepts for you need a fresh World ID check, so nobody else can act on your behalf.
            </p>
          </div>
          {(refund != null || (open && deadline)) && (
            <div className="card card-b ha-offer">
              <div>
                <div className="ra-label">Partial refund</div>
                {refund != null ? <div className="ra-money"><span className="v tnum">{fmtAmount(refund)}</span><span className="cur">USDT</span></div> : <Skeleton w={120} h={40} />}
                <div className="ra-sub">{bps ? `${bps / 100}% of the item price` : "Part of the item price"} · you keep the item</div>
              </div>
              {open && deadline && deadline > nowS && <CountdownRing until={deadline} total={handedAt ? deadline - handedAt : undefined} />}
            </div>
          )}
          {open && deadline && (
            <div className="small text-2 row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><Icon name="clock" />
              <span>{deadline > nowS
                ? <>Decide by <b className="tnum">{hhmm(deadline)}</b> ({inText(deadline - nowS)}). If the refund isn&apos;t accepted by then, the seller is paid in full and the buyer keeps the item.</>
                : <>The time to accept has passed. The seller is being paid in full and the buyer keeps the item.</>}</span>
            </div>
          )}
          {open && (r.mode === "mock"
            ? <div className="card card-b fade-in"><DemoApprover requestId={r.id} onDone={reload} /></div>
            : (
              <div className="card card-b stack-16 fade-in">
                <ol className="ra-steps">
                  <li><span><b>Open World ID</b> with the button below{r.userCode ? <> and check the code shown is <span className="mono strong">{r.userCode}</span></> : null}.</span></li>
                  <li><span><b>Confirm it&apos;s you with World App.</b></span></li>
                  <li><span><b>Tap &ldquo;Allow access&rdquo;</b> on the World ID page. Your agent then settles the refund.</span></li>
                </ol>
                {r.userCode && <div className="ra-code"><span className="ra-label">Your code</span><span className="mono">{r.userCode}</span></div>}
                <a className="btn primary lg block" href={r.verificationUri} target="_blank" rel="noreferrer"><Icon name="shield-check" /> Open World ID</a>
              </div>
            ))}
          {!open && (
            <div className={`courier-result ${ok ? "success" : tone === "neutral" ? "neutral" : "danger"} fade-in`} role="status">
              {ok ? <VerdictCheck tone="refund" size={56} /> : tone === "neutral" ? <span className="cr-icon"><Icon name="clock" /></span> : <VerdictCheck tone="danger" size={56} />}
              <div>
                <div className="cr-title">{r.simulated && r.status === "refunded" ? "Refund settled (simulated approval, no World ID proof)" : r.simulated && r.status === "verified" ? "Simulated approval (no World ID proof)" : APPROVAL_LABEL[r.status] ?? r.status}</div>
                <div className="cr-body">{ok ? "You can close this page." : "Nothing was refunded. If the refund isn't accepted in time, the seller is paid in full and the buyer keeps the item, with the usual return window."}</div>
              </div>
            </div>
          )}
          <div className="card card-b"><h3 style={{ marginBottom: 16 }}>Activity</h3><ApprovalTimeline r={r} /></div>
        </div>
      </main>
    </>
  );
}

export default function Page() {
  return <Suspense><Courier /></Suspense>;
}
