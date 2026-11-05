"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { Top } from "../components/Top";
import { BalanceStrip, HashscanLink, Pill, TxLink } from "../components/ui";
import { api, useEvents, type ObEvent } from "../lib/api";

type Step = "scan" | "courier" | "open" | "verdict";
const STEPS: [Step, string][] = [["scan", "1 · Show parcel QR"], ["courier", "2 · Courier World check"], ["open", "3 · Open the box"], ["verdict", "4 · Verdict & payout"]];

export default function Kiosk() {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState<Step>("scan");
  const [cam, setCam] = useState<string>();
  const [banner, setBanner] = useState<{ kind: "ok" | "bad" | "warn" | "info"; text: string }>();
  const [scan, setScan] = useState<any>();
  const [req, setReq] = useState<any>();
  const [reqQr, setReqQr] = useState<string>();
  const [verdict, setVerdict] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [paste, setPaste] = useState("");
  const lastQr = useRef<string>("");
  const scanning = useRef(true);

  const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${s}`, ...l].slice(0, 14));

  // camera
  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => { if (video.current) { video.current.srcObject = s; video.current.play(); } })
      .catch((e) => setCam(`Camera unavailable (${e.name}). Paste the QR payload below instead.`));
  }, []);

  const reset = useCallback(() => {
    setStep("scan"); setScan(undefined); setReq(undefined); setReqQr(undefined); setVerdict(undefined); setCandidates([]);
    lastQr.current = ""; scanning.current = true;
  }, []);

  const onQr = useCallback(async (text: string) => {
    if (!scanning.current || text === lastQr.current) return;
    lastQr.current = text; scanning.current = false;
    setBanner({ kind: "info", text: "Checking the seller's signature and the order…" });
    try {
      const r = await api("POST", "/v1/doorbell/handover", { qr: text });
      if (!r.ok) {
        setBanner({ kind: "bad", text: `✗ ${r.reason}. No payment.` });
        note(`DENIED ${r.ref ?? ""}: ${r.reason}`);
        setTimeout(() => { scanning.current = true; lastQr.current = ""; }, 3500);
        return;
      }
      setScan(r.scan); setReq(r.request); setStep("courier");
      setReqQr(await QRCode.toDataURL(r.request.verificationUri, { margin: 1, width: 220 }));
      setBanner({ kind: "info", text: `Parcel ${r.scan.ref} (${r.scan.product}) for ${r.scan.assignedCourier}. Courier: verify on your phone.` });
      note(`QR ok · ${r.scan.ref} · World check requested`);
    } catch (e) {
      setBanner({ kind: "bad", text: (e as Error).message });
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
    if (e.type === "world.request" && e.data?.id === req?.id) {
      const s = e.data.status;
      if (e.data.note) note(e.data.note);
      if (s === "handed_over") { setStep("open"); setBanner({ kind: "ok", text: "🔔 Ding! Courier verified. Same person as at dispatch. Buyer: open the box on camera now." }); }
      if (["wrong_courier", "denied", "expired", "cancelled", "failed"].includes(s)) {
        setBanner({ kind: "bad", text: `✗ ${e.data.note ?? s}${e.data.reason ? ` (${e.data.reason})` : ""}` });
        setTimeout(reset, 4000);
      }
    }
    if (e.type === "agent.action") note(`agent: ${e.data?.note}`);
    if (e.type === "agent.candidates") setCandidates(e.data?.candidates ?? []);
    if (e.type === "agent.refused") note(`agent refused: ${e.data?.reason}`);
  });

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
    setBanner({ kind: "info", text: "Household agent is hiring an inspector over x402…" });
    try {
      const r = await api("POST", "/v1/doorbell/inspect", { ref: scan.ref, frame, useLastFrame, mode: "delivery" });
      setVerdict(r); setStep("verdict");
      const o = r.result.outcome;
      setBanner(
        o === "match" ? { kind: "ok", text: "✓ Matches the order. Courier and seller paid in one settlement." }
        : o === "mismatch" ? { kind: "bad", text: "✗ Not what was ordered. Buyer refunded instantly; parcel returns with the courier. Courier still paid for an honest delivery." }
        : { kind: "warn", text: `⚠ Damaged. Buyer can accept a ${r.result.refundBps / 100}% partial refund with one tap.` },
      );
    } catch (e) {
      setBanner({ kind: "bad", text: (e as Error).message });
    } finally { setBusy(false); }
  };

  /** Mock-vision helper (VISION_PROVIDER=mock): encodes the scenario in the frame. Real providers read the photo. */
  const simulate = async (kind: "soap" | "match" | "cracked") => {
    const o = await api("GET", `/v1/orders/${scan.ref}`);
    const payload = kind === "soap" ? { item: "bar of soap" } : { serial: o.serial, item: o.product, damage: kind === "cracked" ? "minor" : "none" };
    inspect(btoa(`MOCK:${JSON.stringify(payload)}`));
  };

  const accept = async () => {
    setBusy(true);
    try {
      const r = await api("POST", `/v1/orders/${scan.ref}/accept-partial-refund`);
      setVerdict((v: any) => ({ ...v, action: "settled", txHash: r.txHash, explorerUrl: r.explorerUrl }));
      setBanner({ kind: "ok", text: "✓ Partial refund sent to the buyer; rest to the seller; courier paid." });
    } catch (e) { setBanner({ kind: "bad", text: (e as Error).message }); } finally { setBusy(false); }
  };

  const hint = step === "scan" ? "Courier: show the parcel QR" : step === "courier" ? "Courier: verify with World ID on your phone" : step === "open" ? "Buyer: open the box and hold the item's label up" : "Done";
  const idx = STEPS.findIndex(([s]) => s === step);
  return (
    <>
      <Top title="Doorbell" sub="· camera + household agent" />
      <BalanceStrip refId={scan?.ref} />
      <div className="wrap">
        <div className="steps">{STEPS.map(([s, l], i) => <div key={s} className={i === idx ? "on" : i < idx ? "done" : ""}>{l}</div>)}</div>
        {banner && <div className={`banner ${banner.kind}`}>{banner.text}</div>}
        <div className="grid2">
          <div>
            <div className="cam">
              <video ref={video} muted playsInline />
              <div className="frame" />
              <div className="hint">{hint}</div>
            </div>
            <canvas ref={canvas} style={{ display: "none" }} />
            {cam && <div className="small muted" style={{ marginTop: 6 }}>{cam}</div>}
            {step === "scan" && (
              <div className="row" style={{ marginTop: 8 }}>
                <input style={{ flex: 1 }} placeholder="…or paste the parcel QR payload (openbox:…)" value={paste} onChange={(e) => setPaste(e.target.value)} />
                <button onClick={() => { scanning.current = true; lastQr.current = ""; onQr(paste.trim()); }}>Use</button>
              </div>
            )}
            {step === "open" && (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="row">
                  <button className="primary" disabled={busy} onClick={() => inspect(capture())}>📸 Capture still & inspect</button>
                  <button disabled={busy} onClick={() => inspect(undefined, true)}>Retry with last good frame</button>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="small muted">Mock vision:</span>
                  <button disabled={busy} onClick={() => simulate("soap")}>🧼 soap</button>
                  <button disabled={busy} onClick={() => simulate("match")}>✅ matching serial</button>
                  <button disabled={busy} onClick={() => simulate("cracked")}>💥 cracked</button>
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {step === "courier" && req && (
              <div className="card">
                <h2>Courier World ID check</h2>
                <div className="row">
                  {reqQr && <img src={reqQr} width={180} height={180} alt="World check QR" />}
                  <div className="small">
                    Scan with the courier's phone.<br />
                    {req.userCode && <>Code <b className="mono" style={{ fontSize: 18 }}>{req.userCode}</b><br /></>}
                    <a href={req.verificationUri} target="_blank" rel="noreferrer">open courier page ↗</a><br />
                    <span className="muted">mode: {req.mode}</span>
                  </div>
                </div>
                <button className="danger" style={{ marginTop: 8 }} onClick={async () => { await api("POST", `/v1/world/requests/${req.id}/cancel`); }}>Cancel</button>
              </div>
            )}
            {candidates.length > 0 && (
              <div className="card">
                <h2>Inspectors found on HCS directory</h2>
                {candidates.map((c) => (
                  <div key={c.address} className={`cand ${c.allowed ? "yes" : "no"}`}><span>{c.name} · ${c.priceUsd}</span><span>{c.allowed ? "✓ within budget" : `✗ ${c.reason}`}</span></div>
                ))}
              </div>
            )}
            {verdict && (
              <div className="card">
                <h2>Verdict</h2>
                <div className="row"><Pill s={verdict.result.outcome} /><span className="small">read <code>{verdict.result.serialRead || "(no serial)"}</code> · damage {verdict.result.damage} · {verdict.result.provider}</span></div>
                <div className="small" style={{ marginTop: 6 }}>Inspector paid: {verdict.result.inspectorName} · {verdict.result.payment?.amountUsd} USDC <HashscanLink txId={verdict.result.payment?.hederaTx} url={verdict.result.payment?.hashscan} /></div>
                <div className="small">HCS log #{verdict.result.hcs?.sequence} ({verdict.result.hcs?.topicId})</div>
                {verdict.txHash && <div className="small">Whitechain settlement: <TxLink url={verdict.explorerUrl} hash={verdict.txHash} /></div>}
                {verdict.action === "awaiting_buyer" && (
                  <button className="primary" style={{ marginTop: 10 }} disabled={busy} onClick={accept}>Buyer: accept {verdict.result.refundBps / 100}% partial refund</button>
                )}
                <div><button style={{ marginTop: 10 }} onClick={reset}>Next parcel</button></div>
              </div>
            )}
            <div className="card">
              <h2>Doorbell log</h2>
              <div className="mono small" style={{ maxHeight: 260, overflow: "auto" }}>{log.map((l, i) => <div key={i}>{l}</div>)}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
