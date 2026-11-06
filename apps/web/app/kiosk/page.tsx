"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { Badge, Brand, Callout, ExtLink, Hash, Icon, Money, StatusBadge, Stepper, fmtAmount, fmtTime, hashscan, type IconName } from "../components/ui";
import { api, useEvents, usePoll, type ObEvent } from "../lib/api";
import { APPROVAL_LABEL, RefundApproval } from "../components/approval";
import { Inspection, Parcel, ProductArt, VerdictCheck } from "../components/art";
import { prefersReducedMotion } from "../components/motion";
import "../styles/kiosk.css";

type Step = "scan" | "courier" | "open" | "verdict";
const STEPS: [Step, string][] = [["scan", "Scan parcel"], ["courier", "Courier check"], ["open", "Open the box"], ["verdict", "Result"]];
type Banner = { kind: "success" | "danger" | "warning" | "info"; title: string; text?: string };
/** Verdict "money moment": full-bleed over the camera (show), animates out (dock), then lives in the side column (docked). */
type Phase = "none" | "show" | "dock" | "docked";
const HOLD_MS = 4000;
type Line = { label: string; amount?: number; tone: "paid" | "refund"; note?: string };

/** Who got paid what for this verdict. Prefers indexed on-chain amounts, else derives them from the order terms. */
function moneyLines(verdict: any, o: any): Line[] {
  if (!verdict || !o) return [];
  const fee = Number(o.courierFee), share = Number(o.amount) - fee;
  const pick = (indexed: unknown, fallback: number) => (Number(indexed) > 0 ? Number(indexed) : fallback);
  const out = verdict.result?.outcome;
  if (out === "match") return [{ label: "Seller paid", amount: pick(o.sellerPaid, share), tone: "paid" }, { label: "Courier paid", amount: pick(o.courierPaid, fee), tone: "paid" }];
  if (out === "mismatch") return [{ label: "Buyer refunded", amount: pick(o.buyerRefunded, share), tone: "refund" }, { label: "Courier paid", amount: pick(o.courierPaid, fee), tone: "paid", note: "for an honest delivery" }];
  if (out === "damaged") {
    const bps = Number(verdict.result?.refundBps ?? 0);
    return verdict.action === "settled"
      ? [{ label: "Buyer refunded", amount: pick(o.buyerRefunded, (share * bps) / 10000), tone: "refund" }, { label: "Seller paid", amount: pick(o.sellerPaid, share - (share * bps) / 10000), tone: "paid" }]
      : [{ label: `Refund offered · ${bps / 100}%`, amount: (share * bps) / 10000, tone: "refund", note: "after the buyer approves with World ID" }];
  }
  return [];
}
const VERDICT_COPY: Record<string, { title: string; sub: string; tone: "success" | "refund" | "danger" }> = {
  match: { title: "Matches the order", sub: "Seller paid · Courier paid", tone: "success" },
  mismatch: { title: "Not what was ordered", sub: "Buyer refunded · Courier paid", tone: "danger" },
  damaged: { title: "Damage found", sub: "Partial refund offered to the buyer", tone: "refund" },
};

const GUIDE: [IconName, string, string][] = [
  ["scan-line", "Courier shows the parcel QR", "Hold the label up to the camera."],
  ["shield-check", "Courier confirms with World ID", "Same verified person as at pickup. Simulated in the hosted demo."],
  ["camera", "Open the box on camera", "Hold the item's serial label up."],
];

export default function Kiosk() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState<Step>("scan");
  const [cam, setCam] = useState<string>();
  const [banner, setBanner] = useState<Banner>();
  const [scan, setScan] = useState<any>();
  const [req, setReq] = useState<any>();
  const [reqQr, setReqQr] = useState<string>();
  const [verdict, setVerdict] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ at: number; text: string }[]>([]);
  const [camOn, setCamOn] = useState(false);
  const pasteRef = useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [paste, setPaste] = useState("");
  const lastQr = useRef<string>("");
  const [flashN, setFlashN] = useState(0);
  const [phase, setPhase] = useState<Phase>("none");
  const [vOrder, setVOrder] = useState<any>();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);
  /** Skip the hold and dock the result into the side column now. */
  const dock = useCallback(() => {
    clearTimers();
    if (prefersReducedMotion()) { setPhase("docked"); return; }
    setPhase("dock");
    timers.current.push(setTimeout(() => setPhase("docked"), 460));
  }, []);
  const scanning = useRef(true);

  // Order view while the buyer decides on a partial refund (decision deadline, return window).
  const [ord] = usePoll<any>(() => (verdict?.action === "awaiting_buyer" && scan?.ref ? api("GET", `/v1/orders/${scan.ref}`) : Promise.resolve(undefined)), [verdict?.action, scan?.ref]);
  const note = (s: string) => setLog((l) => [{ at: Date.now(), text: s }, ...l].slice(0, 14));

  // camera
  const startCamera = useCallback(() => {
    setCam(undefined);
    if (!navigator.mediaDevices?.getUserMedia) { setCam("unsupported"); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => { if (video.current) { video.current.srcObject = s; video.current.play().catch(() => undefined); setCamOn(true); } })
      .catch((e) => setCam(e.name === "NotAllowedError" ? "blocked" : "unavailable"));
  }, []);
  useEffect(() => { startCamera(); }, [startCamera]);

  const reset = useCallback(() => {
    clearTimers(); setPhase("none"); setVOrder(undefined);
    setStep("scan"); setScan(undefined); setReq(undefined); setReqQr(undefined); setVerdict(undefined); setCandidates([]);
    lastQr.current = ""; scanning.current = true;
  }, []);

  const onQr = useCallback(async (text: string) => {
    if (!scanning.current || text === lastQr.current) return;
    lastQr.current = text; scanning.current = false;
    setFlashN((n) => n + 1);
    setBanner({ kind: "info", title: "Checking the parcel label…" });
    try {
      const r = await api("POST", "/v1/doorbell/handover", { qr: text });
      if (!r.ok) {
        setBanner({ kind: "danger", title: "Parcel not accepted", text: `${String(r.reason).replace(/^./, (c) => c.toUpperCase())}. No payment was made.` });
        note(`Parcel rejected${r.ref ? ` (${r.ref})` : ""}: ${r.reason}`);
        setTimeout(() => { scanning.current = true; lastQr.current = ""; }, 3500);
        return;
      }
      setScan(r.scan); setReq(r.request); setStep("courier");
      setReqQr(await QRCode.toDataURL(r.request.verificationUri, { margin: 1, width: 220 }));
      setBanner({ kind: "info", title: `Parcel ${r.scan.ref} · ${r.scan.product}`, text: `${r.scan.assignedCourier}: confirm your identity with World ID on your phone. (In the hosted demo this courier check is simulated.)` });
      note(`Label OK for ${r.scan.ref}; courier check started`);
    } catch (e) {
      setBanner({ kind: "danger", title: "Couldn't read that parcel", text: (e as Error).message });
      scanning.current = true; lastQr.current = "";
    }
  }, []);

  // QR scan loop
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const v = video.current, c = canvas.current;
      if (v && c && v.readyState >= 2 && scanning.current && step === "scan") {
        const w = 640, h = Math.round((v.videoHeight / v.videoWidth) * 640) || 400;
        c.width = w; c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(v, 0, 0, w, h);
        const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
        if (code?.data?.startsWith("openbox:")) onQr(code.data);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step, onQr]);

  // live events for this parcel
  useEvents(scan?.ref, (e: ObEvent) => {
    if (e.type === "world.request" && e.data?.purpose === "approve_refund") note(APPROVAL_LABEL[e.data.status] ?? `Approval ${e.data.status}`);
    if (e.type === "world.request" && e.data?.id === req?.id) {
      const s = e.data.status;
      if (e.data.note) note(e.data.note);
      if (s === "handed_over") { setStep("open"); setBanner({ kind: "success", title: "Courier verified", text: "Same person as at pickup (in the hosted demo the courier World ID check is simulated). Open the box and hold the item's label up to the camera." }); }
      if (["wrong_courier", "denied", "expired", "cancelled", "failed"].includes(s)) {
        setBanner({ kind: "danger", title: "Courier check failed", text: `${e.data.note ?? s}${e.data.reason ? ` (${e.data.reason})` : ""}` });
        setTimeout(reset, 4000);
      }
    }
    if (e.type === "agent.action") note(`Agent: ${e.data?.note}`);
    if (e.type === "agent.candidates") setCandidates(e.data?.candidates ?? []);
    if (e.type === "agent.refused") note(`Agent declined an inspector: ${e.data?.reason}`);
  });

  // Refresh the settled amounts when the buyer's partial refund lands.
  const refreshOrder = () => { if (scan?.ref) api("GET", `/v1/orders/${scan.ref}`).then(setVOrder).catch(() => undefined); };

  const capture = (): string | undefined => {
    const v = video.current, c = canvas.current;
    if (!v || !c || v.readyState < 2) return undefined;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    return c.toDataURL("image/jpeg", 0.85);
  };

  const inspect = async (frame?: string, useLastFrame = false) => {
    if (!scan) return;
    setBusy(true);
    setBanner({ kind: "info", title: "Inspecting…", text: "Your doorbell is hiring an independent inspector to check the item." });
    try {
      const r = await api("POST", "/v1/doorbell/inspect", { ref: scan.ref, frame, useLastFrame, mode: "delivery" });
      const after = await api("GET", `/v1/orders/${scan.ref}`).catch(() => undefined);
      setVOrder(after); setVerdict(r); setStep("verdict");
      clearTimers(); setPhase("show");
      timers.current.push(setTimeout(dock, HOLD_MS));
      const o = r.result.outcome;
      setBanner(
        o === "match" ? { kind: "success", title: "Matches the order", text: "The courier and the seller have been paid." }
        : o === "mismatch" ? { kind: "danger", title: "Not what was ordered", text: "The buyer has been refunded. The courier takes the parcel back and is still paid for an honest delivery." }
        : { kind: "warning", title: "Damage found", text: `The buyer can accept a ${r.result.refundBps / 100}% partial refund and keep the item.` },
      );
    } catch (e) {
      setBanner({ kind: "danger", title: "Inspection didn't complete", text: (e as Error).message });
    } finally { setBusy(false); }
  };

  /** Mock-vision helper (VISION_PROVIDER=mock): encodes the scenario in the frame. Real providers read the photo. */
  const simulate = async (kind: "soap" | "match" | "cracked") => {
    const o = await api("GET", `/v1/orders/${scan.ref}`);
    const payload = kind === "soap" ? { item: "bar of soap" } : { serial: o.serial, item: o.product, damage: kind === "cracked" ? "minor" : "none" };
    inspect(btoa(`MOCK:${JSON.stringify(payload)}`));
  };


  const hint = step === "scan" ? "Courier: show the parcel QR" : step === "courier" ? "Courier: verify with World ID on your phone (simulated in demo)" : step === "open" ? "Open the box and hold the item's label up" : "Done";
  const idx = STEPS.findIndex(([s]) => s === step);
  const outcome: string | undefined = verdict?.result?.outcome;
  const copy = outcome ? VERDICT_COPY[outcome] : undefined;
  const lines = moneyLines(verdict, vOrder);
  const overlay = verdict && (phase === "show" || phase === "dock");
  const amounts = (big: boolean) => (
    <div className={`vd-amts ${big ? "big" : ""} rise`}>
      {lines.length === 0 && <div className="vd-amt"><span className="vd-label">Settlement</span><span className="vd-val muted">Recorded on-chain</span></div>}
      {lines.map((l) => (
        <div key={l.label} className={`vd-amt ${l.tone}`}>
          <span className="vd-label">{l.label}</span>
          <span className="vd-val"><span className="tnum">{fmtAmount(l.amount)}</span><span className="cur">USDT</span></span>
          {l.note && <span className="vd-note">{l.note}</span>}
        </div>
      ))}
    </div>
  );
  return (
    <div className="kiosk">
      <header className="kiosk-top">
        <div className="row" style={{ gap: 12, flexWrap: "nowrap", minWidth: 0 }}><Brand href="/kiosk" /><span className="muted small truncate">Doorbell · Front door</span></div>
        <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          {camOn && <span className="hide-sm"><Badge tone="success" live>Camera live</Badge></span>}
          <Badge tone="neutral" title="Whitechain testnet · World ID · Hedera testnet">Testnet</Badge>
        </div>
      </header>
      <main className="kiosk-main">
        <div className="card card-b kiosk-steps">
          <Stepper responsive={false} steps={STEPS.map(([s, l], i) => ({ label: l, state: i < idx || step === "verdict" ? "done" : i === idx ? "current" : "upcoming" }))} label="Doorbell progress" />
        </div>
        <div aria-live="polite">{banner && !overlay && <div className="mt-16 fade-in" key={banner.title}><Callout tone={banner.kind} title={banner.title}>{banner.text}</Callout></div>}</div>
        <div className="kiosk-grid">
          <div className="stack-12">
            <div className={`cam ${overlay ? "has-verdict" : ""}`}>
              <video ref={video} muted playsInline aria-label="Doorbell camera" />
              {camOn && !overlay && <div key={flashN} className={`brackets ${flashN ? "flash" : ""}`} aria-hidden="true" />}
              {camOn && step === "scan" && <div className="scan-line" aria-hidden="true" />}
              {camOn && !overlay && step !== "verdict" && <div className="hint">{hint}</div>}
              {!camOn && !cam && <div className="cam-off"><div><Icon name="camera" /><h2>Starting camera…</h2></div></div>}
              {cam && (
                <div className="cam-off">
                  <div>
                    <Icon name="camera-off" />
                    <h2>{cam === "blocked" ? "Camera access is blocked" : "No camera available"}</h2>
                    <p>{cam === "blocked" ? "Allow camera access in your browser to scan parcels." : "Connect a camera, or enter the parcel code by hand."}</p>
                    <div className="row" style={{ justifyContent: "center" }}>
                      <button type="button" className="btn primary" onClick={startCamera}><Icon name="camera" /> Allow camera</button>
                      <button type="button" className="btn" onClick={() => pasteRef.current?.focus()}>Enter code manually</button>
                    </div>
                  </div>
                </div>
              )}
              {overlay && copy && (
                <div className={`vd ${outcome} ${phase === "dock" ? "docking" : ""}`} role="status" aria-label={`${copy.title}. ${copy.sub}`}>
                  <div className="vd-card">
                    <div className="vd-head">
                      {verdict.action === "awaiting_buyer" ? <Parcel variant="damaged" size={64} className="vd-check" /> : <VerdictCheck tone={copy.tone} size={64} className="vd-check" />}
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="vd-eyebrow">Result · <span className="mono">{scan?.ref}</span></div>
                        <div className="vd-title">{copy.title}</div>
                        <div className="vd-sub">{copy.sub}</div>
                      </div>
                      <div className="vd-product"><ProductArt product={scan?.product} size={120} /></div>
                    </div>
                    {amounts(true)}
                    <div className="vd-foot">
                      <span className="muted small truncate">Checked by {String(verdict.result.inspectorName ?? "an independent inspector").replace(/\s*\([^)]*\)\s*$/, "")}{verdict.result.hcs?.sequence ? <> · verdict #{verdict.result.hcs.sequence} on Hedera</> : null}</span>
                      <button type="button" className="btn sm" onClick={dock}>Continue</button>
                    </div>
                    <div className="vd-hold" aria-hidden="true" style={{ animationDuration: `${HOLD_MS}ms` }} />
                  </div>
                </div>
              )}
            </div>
            <canvas ref={canvas} style={{ display: "none" }} />
            {step === "scan" && (
              <form className="row paste-form" style={{ flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); scanning.current = true; lastQr.current = ""; onQr(paste.trim()); }}>
                <label htmlFor="paste" className="sr-only">Parcel code</label>
                <input id="paste" ref={pasteRef} className="input mono" placeholder="Parcel code (openbox:…)" value={paste} onChange={(e) => setPaste(e.target.value)} />
                <button className={`btn ${paste.trim() ? "primary" : ""}`} disabled={!paste.trim()}>Submit code</button>
              </form>
            )}
            {step === "open" && (
              <div className="card card-b stack-16 fade-in">
                <div className="row">
                  <button type="button" className="btn primary lg" disabled={busy} onClick={() => inspect(capture())}>{busy ? <Icon name="loader" className="spin" /> : <Icon name="camera" />} Capture and inspect</button>
                  <button type="button" className="btn lg" disabled={busy} onClick={() => inspect(undefined, true)}>Retry with last frame</button>
                </div>
                <details className="devtools">
                  <summary><Icon name="chevron-right" /><Icon name="flask" /> Test scenarios <Badge tone="neutral">Demo only</Badge></summary>
                  <div className="row mt-12">
                    <button type="button" className="btn sm" disabled={busy} onClick={() => simulate("soap")}>Wrong item</button>
                    <button type="button" className="btn sm" disabled={busy} onClick={() => simulate("match")}>Matching item</button>
                    <button type="button" className="btn sm" disabled={busy} onClick={() => simulate("cracked")}>Damaged item</button>
                  </div>
                </details>
              </div>
            )}
          </div>

          <div className="stack-16">
            {step === "scan" && (
              <section className="card attract fade-in" aria-label="How the doorbell check works">
                <div className="attract-art"><Inspection size={220} /></div>
                <div className="attract-b">
                  <div className="eyebrow">Pay on proof</div>
                  <h2 className="attract-title">Open your parcel on camera</h2>
                  <p className="attract-sub">Your doorbell checks the delivery before anyone is paid. The seller is paid only if it&apos;s what you ordered.</p>
                  <ol className="attract-steps">
                    {GUIDE.map(([icon, t, d], i) => (
                      <li key={t}><span className="as-n"><Icon name={icon} /></span><span><b>{i + 1}. {t}</b><span>{d}</span></span></li>
                    ))}
                  </ol>
                </div>
              </section>
            )}
            {step === "courier" && req && (
              <section className="card fade-in">
                <div className="card-h"><h2>Courier identity check</h2><StatusBadge s="pending" /></div>
                <div className="card-b">
                  <div className="row" style={{ gap: 20, alignItems: "flex-start" }}>
                    {reqQr && <img src={reqQr} width={180} height={180} alt="QR code for the courier's World ID check" className="kiosk-qr" />}
                    <div className="stack-8 grow" style={{ minWidth: 160 }}>
                      <div className="text-2">Courier: scan with your phone and confirm with World ID.</div>
                      <div className="xs muted">In the hosted demo, the courier World ID check is simulated with sample identities.</div>
                      {req.userCode && <div><div className="xs muted">Code</div><div className="mono strong" style={{ fontSize: 24, letterSpacing: ".08em" }}>{req.userCode}</div></div>}
                      <ExtLink href={req.verificationUri}>Open courier page</ExtLink>
                    </div>
                  </div>
                  <button type="button" className="btn danger mt-16" onClick={async () => { await api("POST", `/v1/world/requests/${req.id}/cancel`); }}>Cancel check</button>
                </div>
              </section>
            )}
            {candidates.length > 0 && (
              <section className="card">
                <div className="card-h"><h2>Inspectors available</h2></div>
                <div className="card-b">
                  {candidates.map((c) => (
                    <div key={c.address ?? c.name} className="cand">
                      <div className="who"><Icon name={c.allowed ? "check-circle" : "x-circle"} /><span className="truncate">{c.name}</span><span className="muted"><Money v={c.priceUsd} cur="USDC" /></span></div>
                      {c.allowed ? <Badge tone="success">Within budget</Badge> : <Badge tone="warning" title={c.reason}>Over limit</Badge>}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {verdict && (phase === "docked" || phase === "none") && (
              <section className={`card vd-docked ${outcome ?? ""}`}>
                <div className="card-h"><h2>Result</h2><StatusBadge s={verdict.action === "awaiting_buyer" ? "awaiting_buyer" : verdict.result.outcome} /></div>
                <div className="card-b stack-16">
                  {copy && (
                    <div className="vd-mini">
                      {verdict.action === "awaiting_buyer" ? <Parcel variant="damaged" size={44} /> : <VerdictCheck tone={copy.tone} size={44} />}
                      <div className="grow" style={{ minWidth: 0 }}><div className="vd-mini-title">{copy.title}</div>
                        {verdict.action === "awaiting_buyer" ? <div className="text-2 small">Waiting for the buyer to accept the partial refund with World ID.</div> : amounts(false)}</div>
                    </div>
                  )}
                  {verdict.action === "awaiting_buyer" && (
                    <RefundApproval variant="kiosk" orderRef={scan.ref} refundPct={verdict.result.refundBps / 100}
                      refundAmount={vOrder ? ((Number(vOrder.amount) - Number(vOrder.courierFee)) * verdict.result.refundBps) / 10000 : undefined}
                      deadline={ord?.decisionDeadline} returnWindowS={ord?.returnWindowS}
                      onSettled={(rq) => {
                        setVerdict((v: any) => ({ ...v, action: "settled" })); refreshOrder();
                        setBanner(rq?.simulated
                          ? { kind: "success", title: "Refund settled (simulated approval, no World ID proof)", text: "Demo fallback: approved without World ID. The rest went to the seller and the courier has been paid." }
                          : { kind: "success", title: "Partial refund approved and settled", text: "The household owner approved with World ID. The rest went to the seller and the courier has been paid." });
                      }} />
                  )}
                  <dl className="dl">
                    <dt>Serial read</dt><dd><span className="mono">{verdict.result.serialRead || "Not readable"}</span></dd>
                    <dt>Damage</dt><dd>{verdict.result.damage === "none" ? "None found" : verdict.result.damage}</dd>
                    <dt>Inspected by</dt><dd>{verdict.result.inspectorName}</dd>
                    <dt>Inspection fee</dt><dd><Money v={verdict.result.payment?.amountUsd} cur="USDC" /></dd>
                    <dt>Proof</dt><dd>
                      {verdict.result.payment?.hashscan ? <ExtLink href={verdict.result.payment.hashscan}>Payment</ExtLink> : <span className="muted">Simulated</span>}
                      {verdict.result.hcs?.topicId && !verdict.result.payment?.mock && <ExtLink href={hashscan("hedera:testnet", "topic", verdict.result.hcs.topicId)}>Verdict #{verdict.result.hcs.sequence}</ExtLink>}
                    </dd>
                    {verdict.txHash && <><dt>Settlement</dt><dd><Hash value={verdict.txHash} href={verdict.explorerUrl} /></dd></>}
                  </dl>
                  <div className="row">
                    <button type="button" className="btn lg" onClick={reset}>Next parcel <Icon name="arrow-right" /></button>
                  </div>
                </div>
              </section>
            )}
            {(log.length > 0 || step !== "scan") && (
              <section className="card">
                <div className="card-h"><h2>Activity</h2>{step !== "scan" && step !== "verdict" && <Badge tone="info" live>Live</Badge>}</div>
                <div className="card-b">
                  {log.length === 0
                    ? <div className="muted small">Events appear here as the courier and inspector act.</div>
                    : <div className="log" aria-live="polite">{log.map((l) => <div key={l.at + l.text} className="fade-in"><time>{fmtTime(l.at)}</time><span>{l.text}</span></div>)}</div>}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
