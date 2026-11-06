"use client";
import { useEffect, useRef, useState } from "react";
import "../styles/demo.css";
import { api, useEvents } from "../lib/api";
import { Icon, Logo, type IconName } from "../components/ui";
import { CountUp } from "../components/motion";
import { EMBED_CSS } from "./embed-css";

type Party = { role: string; address?: string | null; usdt?: string | number | null };
type Balances = { ref: string | null; parties: Party[]; relayer?: { address?: string; balance?: string | number | null } };

/** Fixed slot order so nothing shifts when a party appears mid-demo. Missing balances render "—". */
const SLOTS: { key: string; label: string; icon: IconName; unit: string; decimals: number }[] = [
  { key: "buyer", label: "Buyer", icon: "wallet", unit: "USDT", decimals: 2 },
  { key: "seller", label: "Seller", icon: "store", unit: "USDT", decimals: 2 },
  { key: "courier", label: "Courier", icon: "truck", unit: "USDT", decimals: 2 },
  { key: "lender", label: "Lender", icon: "coins", unit: "USDT", decimals: 2 },
  { key: "gas", label: "Gas", icon: "fuel", unit: "WBT", decimals: 3 },
];

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

function Slot({ label, icon, unit, decimals, value, title }: { label: string; icon: IconName; unit: string; decimals: number; value: number | null; title?: string }) {
  // Glow + "±x.xx" chip only when a known balance changes (not when it first arrives).
  const prev = useRef<number | null>(value);
  const [delta, setDelta] = useState<{ v: number; k: number } | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p == null || value == null || p === value) return;
    const v = value - p;
    if (Math.abs(v) < 10 ** -decimals / 2) return;
    setDelta({ v, k: Date.now() });
    setFlash(true);
    const t1 = setTimeout(() => setFlash(false), 1200);
    const t2 = setTimeout(() => setDelta(null), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [value, decimals]);
  return (
    <div className={`dm-bal ${flash ? "is-flash" : ""} ${value == null ? "is-empty" : ""}`} title={title ?? undefined}>
      <span className="dm-bal-icon" aria-hidden="true"><Icon name={icon} /></span>
      <span className="dm-bal-role">{label}</span>
      <b className="dm-bal-val"><CountUp value={value} decimals={decimals} /></b>
      <small className="dm-bal-unit">{unit}</small>
      {delta && (
        <span key={delta.k} className={`dm-delta ${delta.v > 0 ? "up" : "down"}`} aria-hidden="true">
          {delta.v > 0 ? "+" : "−"}{Math.abs(delta.v).toFixed(decimals)}
        </span>
      )}
    </div>
  );
}

function Balances() {
  const tick = useEvents(undefined, undefined);
  const [b, setB] = useState<Balances>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<Balances>("GET", "/v1/demo/balances").then((nb) => { if (live) { setB(nb); setFailed(false); } }).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [tick]);
  const by = Object.fromEntries((b?.parties ?? []).map((p) => [p.role, p]));
  return (
    <>
      <div className="dm-bals" role="group" aria-label="Live balances">
        {SLOTS.map((s) => {
          const p = s.key === "gas" ? { address: b?.relayer?.address, usdt: b?.relayer?.balance } : by[s.key];
          return <Slot key={s.key} label={s.label} icon={s.icon} unit={s.unit} decimals={s.decimals} value={num(p?.usdt)} title={p?.address ?? undefined} />;
        })}
      </div>
      <div className="dm-order" aria-live="polite">
        {failed && !b ? <span className="dm-order-off">API offline</span>
          : b?.ref ? <><span className="dm-live" aria-hidden="true" /><span className="dm-order-l">Order</span><b>{b.ref}</b></>
          : <span className="dm-order-off">Waiting for an order</span>}
      </div>
    </>
  );
}

/** Frames get their src after mount so the load listener is always attached first.
 *  Same-origin panes get the presenter tweaks (horizontal stepper, 16:10 camera, compact KPIs) injected into
 *  their document, so the kiosk and merchant pages stay untouched. Cross-origin panes (the store) are skipped. */
function injectEmbedCss(f: HTMLIFrameElement | null) {
  try {
    const d = f?.contentDocument;
    if (!d || !d.head || d.location.href === "about:blank" || d.getElementById("ob-demo-embed")) return;
    const s = d.createElement("style");
    s.id = "ob-demo-embed";
    s.textContent = EMBED_CSS;
    d.head.appendChild(s);
  } catch { /* cross-origin */ }
}

function Pane({ title, role, src, allow, icon }: { title: string; role: string; src: string; allow?: string; icon: IconName }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const f = ref.current;
    if (!f || !mounted) return;
    const onLoad = () => { injectEmbedCss(f); setReady(true); };
    f.addEventListener("load", onLoad);
    const fallback = setTimeout(() => setReady(true), 6000);
    return () => { f.removeEventListener("load", onLoad); clearTimeout(fallback); };
  }, [mounted]);
  const url = src.replace(/[?&]embed=1$/, "").replace(/^https?:\/\//, "");
  return (
    <section className="dm-pane" aria-label={title}>
      <div className="dm-pane-bar">
        <span className="dm-dots" aria-hidden="true"><i /><i /><i /></span>
        <Icon name={icon} />
        <b>{title}</b>
        <span className="dm-role">{role}</span>
        <span className="dm-url" title={url}><Icon name="lock" />{url}</span>
      </div>
      <div className="dm-frame">
        {!ready && <div className="dm-frame-skel" aria-hidden="true"><span /><span /><span /></div>}
        <iframe ref={ref} src={mounted ? src : undefined} title={`${title}: ${role}`} allow={allow} className={ready ? "is-ready" : ""} />
      </div>
    </section>
  );
}

/** Split screen for the video: store/SDK · doorbell · merchant, with one live balance strip on top. */
export default function Demo() {
  const store = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:5174";
  // Only mount the panes on screens that show them: hidden iframes would still load (and the doorbell would ask for the camera).
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return (
    <>
      <main className="dm-narrow surface-hero theme-dark">
        <div className="dm-narrow-card">
          <a href="/" className="dm-brand"><Logo size={28} variant="dark" /><span>OpenBox</span></a>
          <h1 className="t-h1">The live demo needs a wide screen</h1>
          <p>It plays the shop, the doorbell and the merchant dashboard side by side, with live balances on top. Open it in a window at least 1280px wide, or try each part on its own:</p>
          <div className="dm-narrow-links">
            <a href={store} target="_blank" rel="noreferrer"><Icon name="store" /><span><b>Shop</b><small>Northwind Gadgets, the demo store</small></span><Icon name="external" /></a>
            <a href="/kiosk"><Icon name="doorbell" /><span><b>Doorbell</b><small>Scan a parcel at the door</small></span><Icon name="chevron-right" /></a>
            <a href="/merchant"><Icon name="package" /><span><b>Merchant dashboard</b><small>Orders, payouts and receipts</small></span><Icon name="chevron-right" /></a>
          </div>
        </div>
      </main>
      <div className="dm">
        <header className="dm-top">
          <a href="/" className="dm-brand"><Logo size={24} variant="dark" /><span>OpenBox</span></a>
          <span className="dm-sep" aria-hidden="true" />
          {wide && <Balances />}
        </header>
        {wide && (
          <div className="dm-panes">
            <Pane title="Shop" role="Buyer · Northwind Gadgets" src={`${store}/?embed=1`} icon="store" />
            <Pane title="Doorbell" role="Buyer's front door" src="/kiosk?embed=1" allow="camera" icon="doorbell" />
            <Pane title="Merchant" role="OpenBox dashboard" src="/merchant?embed=1" icon="package" />
          </div>
        )}
      </div>
    </>
  );
}
