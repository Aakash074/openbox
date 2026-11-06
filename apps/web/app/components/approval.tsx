"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, useEvents, usePoll } from "../lib/api";
import { Badge, Callout, ExtLink, Hash, Icon, QR, Skeleton, Timestamp, fmtAmount } from "./ui";
import { Parcel, VerdictCheck } from "./art";
import "../styles/buyer.css";

/**
 * World ID Agent Pass checkpoint for a damaged parcel's partial refund.
 * The buyer asks; the household agent pauses; the household owner approves with a fresh World ID check;
 * only then does the agent settle the refund on-chain.
 */

export const APPROVAL_OPEN = ["creating", "pending", "validating"];
const BAD = ["denied", "expired", "cancelled", "wrong_person", "failed"];

/** Plain-language status for approval requests (buyer, kiosk and merchant timelines). */
export const APPROVAL_LABEL: Record<string, string> = {
  requested: "Approval requested",
  creating: "Agent waiting for household approval (World ID)",
  pending: "Agent waiting for household approval (World ID)",
  validating: "Checking the World ID approval",
  verified: "Approved, settling the refund",
  refunded: "Approved, partial refund settled",
  denied: "Declined, nothing refunded",
  wrong_person: "Not the household owner, nothing refunded",
  expired: "Approval expired, nothing refunded",
  cancelled: "Cancelled, nothing refunded",
  failed: "Couldn't settle, nothing refunded",
};
export const approvalTone = (s?: string) =>
  s === "refunded" || s === "verified" ? "success" : s && BAD.includes(s) ? (s === "expired" || s === "cancelled" ? "neutral" : "danger") : "info";

/** Poll one World request every second while it's open. */
export function useWorldRequest(id?: string) {
  const [r, setR] = useState<any>();
  const [err, setErr] = useState<string>();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!id) { setR(undefined); return; }
    let live = true, t: ReturnType<typeof setTimeout> | undefined;
    const run = () => api("GET", `/v1/world/requests/${encodeURIComponent(id)}`)
      .then((x) => { if (!live) return; setR(x); setErr(undefined); if (APPROVAL_OPEN.includes(x.status) || x.status === "verified") t = setTimeout(run, 1000); })
      .catch((e) => { if (!live) return; setErr((e as Error).message); if (!/not found|404/i.test((e as Error).message)) t = setTimeout(run, 3000); });
    run();
    return () => { live = false; if (t) clearTimeout(t); };
  }, [id, n]);
  return [r, useCallback(() => setN((x) => x + 1), []), err] as const;
}

/** "4:52" until a unix time; re-renders every second. */
function Countdown({ until }: { until: number }) {
  const [t, setT] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const i = setInterval(() => setT(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(i); }, []);
  const s = Math.max(0, until - t);
  return <span className="tnum">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

type DemoChoice = { persona: "owner" | "mallory"; decision: "approve" | "deny"; label: string };
const OWNER_APPROVE: DemoChoice = { persona: "owner", decision: "approve", label: "Owner approves" };
const OWNER_DECLINE: DemoChoice = { persona: "owner", decision: "deny", label: "Owner declines" };
const MALLORY: DemoChoice = { persona: "mallory", decision: "approve", label: "Mallory tries to approve" };

/** Demo-only stand-in for World App in mock mode (same pattern as the courier page). */
export function DemoApprover({ requestId, onDone, dark }: { requestId: string; onDone?: () => void; dark?: boolean }) {
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const go = async (p: DemoChoice) => {
    setBusy(p.label); setMsg(undefined);
    try { await api("POST", "/v1/world/mock/complete", { requestId, persona: p.persona, decision: p.decision }); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(undefined); onDone?.(); }
  };
  const btn = (p: DemoChoice, cls: string, text: string, aria: string) => (
    <button type="button" className={`btn ${cls}`} disabled={!!busy} onClick={() => go(p)} aria-label={aria}>{busy === p.label && <Icon name="loader" className="spin" />}{text}</button>
  );
  if (dark) {
    return (
      <details className="devtools">
        <summary><Icon name="chevron-right" /><Icon name="flask" /> Approve on this screen <Badge tone="neutral">Demo only</Badge></summary>
        <div className="row mt-12">
          {btn(OWNER_APPROVE, "sm", "Owner approves", "Household owner approves")}
          {btn(OWNER_DECLINE, "sm", "Owner declines", "Household owner declines")}
          {btn(MALLORY, "sm", "Mallory tries", "Someone else, Mallory, tries to approve")}
        </div>
        {msg && <div className="small mt-8" role="alert">{msg}</div>}
      </details>
    );
  }
  return (
    <div>
      <div className="row between" style={{ marginBottom: 10 }}><h3 style={{ margin: 0 }}>Who&apos;s confirming?</h3><Badge tone="neutral">Demo only</Badge></div>
      <div className="persona" style={{ flexWrap: "wrap" }}>
        <span className="avatar lg" style={{ background: "#0F766E" }}>H</span>
        <div className="grow" style={{ minWidth: 140 }}><div className="strong">Household owner</div><div className="small muted">Linked to this wallet</div></div>
        <div className="row" style={{ flexWrap: "nowrap", marginLeft: "auto" }}>
          {btn(OWNER_DECLINE, "", "Decline", "Decline as the household owner")}
          {btn(OWNER_APPROVE, "primary", "Approve", "Approve as the household owner")}
        </div>
      </div>
      <div className="persona" style={{ flexWrap: "wrap" }}>
        <span className="avatar lg muted-av">M</span>
        <div className="grow" style={{ minWidth: 140 }}><div className="strong">Someone else (Mallory)</div><div className="small muted">Not the household owner</div></div>
        <div style={{ marginLeft: "auto" }}>{btn(MALLORY, "", "Try to approve", "Try to approve as Mallory, who is not the household owner")}</div>
      </div>
      {msg && <div className="field-error mt-8" role="alert">{msg}</div>}
    </div>
  );
}

/** Current unix time, ticking every second (deadlines). */
export function useNow() {
  const [t, setT] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const i = setInterval(() => setT(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(i); }, []);
  return t;
}
export const hhmm = (ts: number) => { const d = new Date(ts * 1000); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
/** "in 4 min" / "in 2 h" / "in 3 days". */
export const inText = (s: number) => s < 60 ? "in under a minute" : s < 3600 ? `in ${Math.round(s / 60)} min` : s < 86400 * 2 ? `in ${Math.round(s / 3600)} h` : `in ${Math.round(s / 86400)} days`;
const daysText = (s?: number | null) => { const d = Math.round(Number(s ?? 7 * 86400) / 86400); return d >= 1 ? `${d} day${d === 1 ? "" : "s"}` : `${Math.max(1, Math.round(Number(s) / 60))} min`; };

const explorerTx = (cfg: any, h?: string | null) =>
  h && cfg?.chainId === 1874 ? `${(cfg.explorer ?? "https://explorer.testnet.whitechain.io").replace(/\/$/, "")}/tx/${h}` : undefined;

/** Circular countdown (conic ring + mm:ss). `total` is the full window in seconds; the ring empties as time runs out. */
export function CountdownRing({ until, total, size = 64, label = "left to decide" }: { until: number; total?: number; size?: number; label?: string }) {
  const now = useNow();
  const [first] = useState(() => Math.max(1, until - Math.floor(Date.now() / 1000)));
  const left = Math.max(0, until - now);
  const span = Math.max(total ?? first, left, 1);
  const p = left / span;
  const urgent = left <= 60;
  return (
    <div className={`ra-ring${urgent ? " urgent" : ""}`} style={{ ["--p" as string]: p.toFixed(4), width: size, height: size }}
      role="timer" aria-label={`${Math.floor(left / 60)} minutes ${left % 60} seconds ${label}`}>
      <span><b className="tnum">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b><i>{size >= 60 ? "left" : ""}</i></span>
    </div>
  );
}

/**
 * The full flow: "Accept with World ID" → approval panel (QR, code, phone link, countdown, cancel, demo picker)
 * → refunded / nothing refunded. `variant="kiosk"` is the compact dark doorbell version (no card shell).
 * `refundAmount` (USDT) is the partial refund the buyer would get; `windowStart` is when the decision window opened.
 */
export function RefundApproval({ orderRef, refundPct, refundAmount, deadline, windowStart, returnWindowS, variant = "page", onSettled }: {
  orderRef: string; refundPct?: number; refundAmount?: number | string | null; deadline?: number | null; windowStart?: number | null;
  returnWindowS?: number | null; variant?: "page" | "kiosk"; onSettled?: (request?: any) => void;
}) {
  const now = useNow();
  const [id, setId] = useState<string>();
  const [r, reload, err] = useWorldRequest(id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [cfg] = usePoll(() => api("GET", "/v1/config"), []);
  const kiosk = variant === "kiosk";

  // Pick up an approval already in flight for this order (e.g. started on the doorbell, or before a reload).
  useEvents(orderRef, (e) => {
    if (e.type === "world.request" && e.data?.purpose === "approve_refund" && e.data?.id && e.data.id !== id) setId(e.data.id);
  });
  useEffect(() => { if (r?.status === "refunded") onSettled?.(r); }, [r?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true); setMsg(undefined);
    try { const j = await api("POST", `/v1/orders/${orderRef}/accept-partial-refund`); setId(j.approval?.id); if (j.approval?.id === id) reload(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  /** Demo-only fallback (config.simulatedApproval): approve WITHOUT World ID. Always labelled as simulated. */
  const [simBusy, setSimBusy] = useState(false);
  const simulate = async () => {
    if (!r) return;
    setSimBusy(true); setMsg(undefined);
    try { await api("POST", `/v1/world/requests/${encodeURIComponent(r.id)}/simulate-approval`); }
    catch (e) { setMsg((e as Error).message); } finally { setSimBusy(false); reload(); }
  };
  const cancel = async () => {
    if (!r) return;
    setBusy(true);
    try { await api("POST", `/v1/world/requests/${r.id}/cancel`); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); reload(); }
  };

  const pct = refundPct != null ? `${refundPct}% ` : "";
  const amount = refundAmount != null && refundAmount !== "" && !Number.isNaN(Number(refundAmount)) ? Number(refundAmount) : undefined;
  const left = deadline ? deadline - now : undefined;
  const past = left != null && left <= 0;
  const keep = `the seller is paid in full and you keep the item. You can still return it within ${daysText(returnWindowS)} for a refund.`;
  /** What happens if the buyer doesn't accept, with the time left. */
  const consequence = deadline
    ? <>Accept by <b className="tnum">{hhmm(deadline)}</b> ({inText(Math.max(0, left!))}). If you don&apos;t, {keep}</>
    : <>If you don&apos;t accept, {keep}</>;
  const errBox = msg && <Callout tone="danger" title="That didn't go through.">{msg}</Callout>;
  const acceptBtn = (label = "Accept with World ID", cls = "") => (
    <button type="button" className={`btn primary lg ${cls}`} disabled={busy} onClick={start}>
      {busy ? <Icon name="loader" className="spin" /> : <Icon name="shield-check" />} {label}
    </button>
  );
  const money = (cls = "") => amount != null
    ? <div className={`ra-money ${cls}`}><span className="v tnum">{fmtAmount(amount)}</span><span className="cur">USDT</span></div>
    : <div className={`ra-money ${cls}`}><span className="v">{pct || "Partial"}</span><span className="cur">refund</span></div>;

  /** Card shell on the buyer page; plain stack on the doorbell. Header changes with the state. */
  const shell = (key: string, body: ReactNode, head?: ReactNode, done = false) => kiosk
    ? <div className="ra-kiosk stack-16 fade-in" key={key} aria-live="polite">{body}</div>
    : (
      <section className={`card ra fade-in${done ? " done" : ""}`} key={key} aria-live="polite" aria-label="Partial refund decision">
        <div className="ra-head">
          <Parcel variant={done ? "open" : "damaged"} size={64} className="ra-art" />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="eyebrow ra-eyebrow">{done ? (r?.simulated ? "Partial refund · simulated approval" : "Partial refund · World ID approved") : "Damage found at delivery"}</div>
            <h2 className="ra-title">{head ?? "Keep the item and get part of your money back"}</h2>
          </div>
          {deadline && !past && !done && <CountdownRing until={deadline} total={windowStart ? deadline - windowStart : undefined} />}
        </div>
        <div className="ra-body">{body}</div>
      </section>
    );

  const timedOut = (
    <Callout tone="neutral" icon="clock" title="Time to accept has passed">
      Nothing was refunded: {keep.replace("the seller is paid", "the seller is being paid")}
    </Callout>
  );

  // 1 · not started
  if (!id) {
    if (past) return timedOut;
    return shell("start", (
      <div className="stack-16">
        <div className="ra-offer">
          <div>
            <div className="ra-label">Your partial refund</div>
            {money()}
            <div className="ra-sub">{pct ? `${pct}of the item price` : "Part of the item price"} · you keep the item</div>
          </div>
          <div className="ra-cta-wrap">{acceptBtn()}</div>
        </div>
        <p className="ra-fine">
          <Icon name="shield" /> <span>Your OpenBox agent settles the refund only after a fresh World ID check (World ID Agent Pass), so nobody else can accept it for you. {consequence}</span>
        </p>
        {errBox}
      </div>
    ));
  }
  if (!r) {
    return err
      ? <Callout tone="danger" title="Can't load the approval." action={<button type="button" className="btn sm" onClick={reload}>Try again</button>}>Check your connection and try again.</Callout>
      : shell("load", <div className="stack-8" aria-busy="true"><Skeleton w="60%" h={20} /><Skeleton h={kiosk ? 140 : 160} w={kiosk ? 140 : 160} /></div>);
  }

  const txUrl = explorerTx(cfg, r.txHash);
  // 3 · done
  if (r.status === "refunded") {
    const sim = !!r.simulated;
    return shell("done", (
      <div className="ra-result success">
        <VerdictCheck tone="refund" size={kiosk ? 48 : 56} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ra-result-title">{sim ? "Refund settled (simulated approval, no World ID proof)" : <>Partial refund settled{amount != null && <> · <span className="tnum">{fmtAmount(amount)}</span> USDT</>}</>}</div>
          <div className="ra-result-body">
            {sim
              ? <>This demo approval skipped World ID, so nobody&apos;s identity was checked. Your OpenBox agent settled the {pct}refund{amount != null ? <> of <b className="tnum">{fmtAmount(amount)} USDT</b></> : null}; you keep the item.</>
              : <>Your OpenBox agent settled the {pct}refund after your World ID approval. You keep the item.</>}
          </div>
          {sim && <div className="mt-8"><Badge tone="neutral" dot={false}><Icon name="flask" /> Simulated approval · demo only</Badge></div>}
          {r.txHash && <div className="mt-8">{txUrl ? <ExtLink href={txUrl}>View settlement</ExtLink> : <Hash value={r.txHash} />}</div>}
        </div>
      </div>
    ), sim ? "Refund settled (simulated approval)" : "Refund approved", true);
  }
  if (r.status === "verified") {
    return shell("verified", (
      <div className="ra-result success">
        <VerdictCheck tone="success" size={kiosk ? 48 : 56} />
        <div className="grow">
          <div className="ra-result-title">{r.simulated ? "Simulated approval (no World ID proof)" : "Approved with World ID"}</div>
          <div className="ra-result-body row" style={{ gap: 6 }}><Icon name="loader" className="spin" /> Your OpenBox agent is settling the refund now…</div>
        </div>
      </div>
    ), r.simulated ? "Simulated approval, settling the refund" : "Approved, settling your refund", true);
  }
  if (BAD.includes(r.status)) {
    const title = r.status === "wrong_person" ? "That wasn't the household owner"
      : r.status === "denied" ? "Approval declined" : r.status === "expired" ? "The approval expired"
      : r.status === "cancelled" ? "Approval cancelled" : "The refund couldn't be settled";
    if (past) return timedOut;
    const tone = approvalTone(r.status);
    return shell("bad-" + r.status, (
      <div className="stack-16">
        <div className={`ra-result ${tone}`}>
          <span className="ra-result-icon"><Icon name={tone === "danger" ? "x-circle" : "clock"} /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ra-result-title">{title}</div>
            <div className="ra-result-body">
              Nothing was refunded{r.status === "failed" && r.reason ? <span title={r.reason}> because the agent couldn&apos;t complete the settlement</span> : null}
              {r.status === "wrong_person" ? ". Only the World ID linked to this order's wallet can approve it." : "."}
            </div>
          </div>
        </div>
        <div className="ra-offer">
          <div>{money("sm")}<div className="ra-sub">{pct ? `${pct}of the item price` : "Partial refund"} is still available</div></div>
          <div className="ra-cta-wrap">{acceptBtn("Try again with World ID")}</div>
        </div>
        <p className="ra-fine"><Icon name="clock" /> <span>{consequence}</span></p>
        {errBox}
      </div>
    ), "Nothing was refunded");
  }

  // 2 · waiting for the owner
  const mock = r.mode === "mock";
  const qrSize = kiosk ? 150 : 168;
  return shell("wait", (
    <div className="stack-16">
      <div className="ra-waitbar">
        <Badge tone="proof" dot={false}><Icon name="shield-check" /> World ID Agent Pass</Badge>
        <span className="ra-waitline"><Badge tone="info" live>{r.status === "validating" ? "Checking approval" : "Waiting for you"}</Badge>
          {amount != null && <span className="text-2">Refund <b className="tnum">{fmtAmount(amount)} USDT</b></span>}</span>
      </div>
      <div className="ra-wait">
        <div className="ra-qr"><QR text={r.verificationUri} size={qrSize} alt="QR code to approve with World ID on your phone" /></div>
        <div className="grow stack-12" style={{ minWidth: 0 }}>
          <div className="ra-wait-title">{mock ? "Approve on your phone" : "Approve on your phone with World ID"}</div>
          <ol className="ra-steps">
            {mock ? (
              <>
                <li><span><b>Scan this code with your phone</b>, or tap &ldquo;Open approval page&rdquo; below.</span></li>
                <li><span><b>Choose who&apos;s confirming.</b> In this demo, sample identities stand in for World App.</span></li>
              </>
            ) : (
              <>
                <li><span><b>Open the link on your phone.</b> Scan this code with your phone&apos;s camera. Already on your phone? Tap &ldquo;Approve with World ID&rdquo; below.</span></li>
                <li><span><b>Confirm it&apos;s you with World App</b>{r.userCode ? <>, checking the code shown is <span className="mono strong">{r.userCode}</span></> : null}.</span></li>
                <li><span><b>Tap &ldquo;Allow access&rdquo;</b> on the World ID page in your browser. Until then your agent keeps waiting.</span></li>
              </>
            )}
          </ol>
          {r.userCode && (
            <div className="ra-code"><span className="ra-label">Your code</span><span className="mono">{r.userCode}</span></div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <a className="btn primary" href={r.verificationUri} target="_blank" rel="noreferrer"><Icon name="shield-check" /> {mock ? "Open approval page" : "Approve with World ID"}</a>
            <button type="button" className="btn ghost" disabled={busy || simBusy} onClick={cancel}>Cancel</button>
          </div>
          <div className="ra-fine sm"><Icon name="clock" /> <span>{r.status === "validating" ? "Checking your approval…"
            : deadline && deadline < r.expiresAt
              ? <>Decide by {hhmm(deadline)} (<Countdown until={deadline} /> left). After that the seller is paid in full. Nothing is refunded until you approve.</>
              : <>This check expires in <Countdown until={r.expiresAt} />. Nothing is refunded until you approve.</>}</span></div>
        </div>
      </div>
      {mock && <DemoApprover requestId={r.id} onDone={reload} dark={kiosk} />}
      {!mock && cfg?.simulatedApproval && r.status === "pending" && (
        <div className="ra-sim">
          <button type="button" className="btn link" disabled={simBusy || busy} onClick={simulate}>
            {simBusy ? <><Icon name="loader" className="spin" /> Simulating owner approval…</> : <>No World App? Simulate owner approval (demo)</>}
          </button>
          <div className="ra-sim-cap">For judges and reviewers. Settles the refund without a World ID proof; the live World ID run is linked in the README.</div>
        </div>
      )}
      {errBox}
    </div>
  ), "Waiting for your World ID approval");
}

/** Timeline of an approval request (used on the approval phone page). Grid rows: dot · label · time. */
export function ApprovalTimeline({ r }: { r: any }) {
  if (!r?.timeline?.length) return null;
  return (
    <ol className="tl">
      {r.timeline.map((t: any, i: number) => (
        <li key={i} className={`${BAD.includes(t.status) ? "bad" : t.status === "refunded" || t.status === "verified" ? "good" : ""} fade-in`}>
          <span className="tl-dot" aria-hidden="true" />
          <span className="tl-title">{APPROVAL_LABEL[t.status] ?? t.status}</span>
          <span className="tl-time"><Timestamp ts={t.at} mode="time" /></span>
        </li>
      ))}
    </ol>
  );
}
