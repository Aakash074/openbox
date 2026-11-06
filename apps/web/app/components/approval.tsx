"use client";
import { useCallback, useEffect, useState } from "react";
import { api, useEvents, usePoll } from "../lib/api";
import { Badge, Callout, ExtLink, Hash, Icon, QR, Skeleton, Timestamp } from "./ui";

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
function useNow() {
  const [t, setT] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const i = setInterval(() => setT(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(i); }, []);
  return t;
}
const hhmm = (ts: number) => { const d = new Date(ts * 1000); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
/** "in 4 min" / "in 2 h" / "in 3 days". */
export const inText = (s: number) => s < 60 ? "in under a minute" : s < 3600 ? `in ${Math.round(s / 60)} min` : s < 86400 * 2 ? `in ${Math.round(s / 3600)} h` : `in ${Math.round(s / 86400)} days`;
const daysText = (s?: number | null) => { const d = Math.round(Number(s ?? 7 * 86400) / 86400); return d >= 1 ? `${d} day${d === 1 ? "" : "s"}` : `${Math.max(1, Math.round(Number(s) / 60))} min`; };

const explorerTx = (cfg: any, h?: string | null) =>
  h && cfg?.chainId === 1874 ? `${(cfg.explorer ?? "https://explorer.testnet.whitechain.io").replace(/\/$/, "")}/tx/${h}` : undefined;

/**
 * The full flow: "Accept N% refund" → approval panel (QR, code, World App link, countdown, cancel, demo picker)
 * → refunded / nothing refunded. `variant="kiosk"` is the compact dark doorbell version.
 */
export function RefundApproval({ orderRef, refundPct, deadline, returnWindowS, variant = "page", onSettled }: {
  orderRef: string; refundPct?: number; deadline?: number | null; returnWindowS?: number | null; variant?: "page" | "kiosk"; onSettled?: () => void;
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
  useEffect(() => { if (r?.status === "refunded") onSettled?.(); }, [r?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true); setMsg(undefined);
    try { const j = await api("POST", `/v1/orders/${orderRef}/accept-partial-refund`); setId(j.approval?.id); if (j.approval?.id === id) reload(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!r) return;
    setBusy(true);
    try { await api("POST", `/v1/world/requests/${r.id}/cancel`); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); reload(); }
  };

  const pct = refundPct != null ? `${refundPct}% ` : "";
  const badge = <Badge tone="brand" dot={false}><Icon name="shield" /> World ID Agent Pass</Badge>;
  const left = deadline ? deadline - now : undefined;
  const past = left != null && left <= 0;
  const keep = `the seller is paid in full and you keep the item. You can still return it within ${daysText(returnWindowS)} for a refund.`;
  /** What happens if the buyer doesn't accept, with the time left. */
  const consequence = deadline
    ? <>Accept by <b className="tnum">{hhmm(deadline)}</b> ({inText(left!)}). If you don&apos;t, {keep}</>
    : <>If you don&apos;t accept, {keep}</>;
  const timedOut = (
    <Callout tone="neutral" icon="clock" title="Time to accept has passed">
      Nothing was refunded: {keep.replace("the seller is paid", "the seller is being paid")}
    </Callout>
  );
  const acceptBtn = (label = `Accept ${pct}refund`) => (
    <button type="button" className={`btn primary ${kiosk ? "lg" : ""}`} disabled={busy} onClick={start}>
      {busy ? <Icon name="loader" className="spin" /> : <Icon name="shield" />} {label}
    </button>
  );

  // 1 · not started
  if (!id) {
    if (past) return timedOut;
    return (
      <div className="stack-12">
        <div className={kiosk ? "text-2" : "small text-2"}>Your OpenBox agent handles refunds for you, but only after you confirm it&apos;s you with World ID.</div>
        <div>{acceptBtn()}</div>
        <div className={kiosk ? "small text-2" : "small text-2"}>{consequence}</div>
        {msg && <Callout tone="danger" title="That didn't go through.">{msg}</Callout>}
      </div>
    );
  }
  if (!r) {
    return err
      ? <Callout tone="danger" title="Can't load the approval." action={<button type="button" className="btn sm" onClick={reload}>Try again</button>}>Check your connection and try again.</Callout>
      : <div className="stack-8" aria-busy="true"><Skeleton w="60%" h={20} /><Skeleton h={kiosk ? 140 : 160} w={kiosk ? 140 : 160} /></div>;
  }

  const txUrl = explorerTx(cfg, r.txHash);
  // 3 · done
  if (r.status === "refunded") {
    return (
      <Callout tone="success" title="Partial refund approved and settled">
        Your OpenBox agent settled the {pct}refund after your World ID approval. You keep the item.
        {r.txHash && <div className="mt-8">{txUrl ? <ExtLink href={txUrl}>View settlement</ExtLink> : <Hash value={r.txHash} />}</div>}
      </Callout>
    );
  }
  if (r.status === "verified") {
    return <Callout tone="success" icon="shield" title="Approved with World ID">Your OpenBox agent is settling the refund now…</Callout>;
  }
  if (BAD.includes(r.status)) {
    const title = r.status === "wrong_person" ? "That wasn't the household owner"
      : r.status === "denied" ? "Approval declined" : r.status === "expired" ? "The approval expired"
      : r.status === "cancelled" ? "Approval cancelled" : "The refund couldn't be settled";
    if (past) return timedOut;
    return (
      <Callout tone={approvalTone(r.status) as "danger" | "neutral"} title={title}
        action={<div className="row">{acceptBtn("Try again")}</div>}>
        Nothing was refunded{r.status === "failed" && r.reason ? <span title={r.reason}> because the agent couldn&apos;t complete the settlement</span> : null}. {consequence}
      </Callout>
    );
  }

  // 2 · waiting for the owner
  const qrSize = kiosk ? 150 : 168;
  return (
    <div className={kiosk ? "stack-12" : "card card-b stack-16"} aria-live="polite">
      <div>
        {badge}
        <div className={`${kiosk ? "" : "small "}text-2 mt-8`}>Your OpenBox agent handles refunds for you, but only after a fresh World ID check, so nobody else can act on your behalf.</div>
        <div className="strong mt-8" style={{ fontSize: kiosk ? 17 : 16 }}>Your OpenBox agent is waiting for your approval</div>
      </div>
      <div className="row" style={{ gap: 20, alignItems: "center" }}>
        <div style={{ background: "#fff", padding: 6, borderRadius: 8, border: "1px solid var(--border)", lineHeight: 0 }}>
          <QR text={r.verificationUri} size={qrSize} alt="QR code to approve with World ID" />
        </div>
        <div className="stack-8 grow" style={{ minWidth: 170 }}>
          <div className="small text-2" title="World ID Orb or Selfie Check">Scan with your phone and confirm it&apos;s you with World ID.</div>
          {r.userCode && <div><div className="xs muted">Your code</div><div className="mono strong" style={{ fontSize: kiosk ? 26 : 30, letterSpacing: ".08em" }}>{r.userCode}</div></div>}
          <a className={`btn ${kiosk ? "" : "primary"}`} href={r.verificationUri} target="_blank" rel="noreferrer"><Icon name="shield" /> {r.mode === "mock" ? "Open approval page" : "Open World App"}</a>
          <div className="xs muted row"><Icon name="clock" /> <span>{r.status === "validating" ? "Checking your approval…" : <>This check expires in <Countdown until={r.expiresAt} /></>}</span></div>
        </div>
      </div>
      {r.mode === "mock" && <DemoApprover requestId={r.id} onDone={reload} dark={kiosk} />}
      <div className="row between">
        <span className="xs muted">{deadline && !past ? <>Nothing is refunded until you approve. Decide by {hhmm(deadline)} ({inText(left!)}); after that the seller is paid in full.</> : "Nothing is refunded until you approve."}</span>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={cancel}>Cancel</button>
      </div>
      {msg && <Callout tone="danger" title="That didn't go through.">{msg}</Callout>}
    </div>
  );
}

/** Timeline of an approval request (used on the approval phone page). */
export function ApprovalTimeline({ r }: { r: any }) {
  if (!r?.timeline?.length) return null;
  return (
    <ul className="timeline">
      {r.timeline.map((t: any, i: number) => (
        <li key={i} className={BAD.includes(t.status) ? "bad" : ""}>
          <div className="row between"><span className="t-title">{APPROVAL_LABEL[t.status] ?? t.status}</span><span className="t-meta"><Timestamp ts={t.at} mode="time" /></span></div>
        </li>
      ))}
    </ul>
  );
}
