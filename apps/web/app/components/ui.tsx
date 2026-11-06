"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, isLocal, useEvents } from "../lib/api";

/* ─── icons (inline, lucide-style 24px stroke paths) ────────────────────────────────────── */
const ICONS: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  "check-circle": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  "x-circle": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="m7.5 4.27 9 5.15"/>',
  "camera-off": '<path d="m2 2 20 20"/><path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16"/><path d="M9.5 4h5L17 7h3a2 2 0 0 1 2 2v7.5"/><path d="M14.12 15.12A3 3 0 1 1 9.88 10.88"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  return: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  fuel: '<path d="M3 22h12"/><path d="M4 9h10"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
  webhook: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  receipt: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  store: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20v3a2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0Z"/>',
  flask: '<path d="M10 2v7.31"/><path d="M14 9.3V1.99"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/><path d="M5.52 16h12.96"/>',
  door: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.56v16.16a1 1 0 0 1-1.24.97L5 20V5.56a2 2 0 0 1 1.51-1.94l4-1A2 2 0 0 1 13 4.56Z"/>',
};
export type IconName = keyof typeof ICONS;
export function Icon({ name, className = "", label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label} dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
  );
}

/** OpenBox logomark: a parcel with a verified tick. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg className={`mark ${className}`} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0F766E" />
      <path d="M16 6.5 25 11v10l-9 4.5L7 21V11z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="m12 16 3 3 5.5-6" fill="none" stroke="#5EEAD4" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function Brand({ href = "/" }: { href?: string }) {
  return <a className="brand" href={href}><Logo /> OpenBox</a>;
}

/* ─── formatting ────────────────────────────────────────────────────────────────────────── */
export const fmtAmount = (v?: string | number | null) => (v == null || v === "" || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Money: 2 decimals, tabular, muted currency suffix. */
export function Money({ v, cur = "USDT", strong, muted }: { v?: string | number | null; cur?: string | null; strong?: boolean; muted?: boolean }) {
  if (v == null || v === "") return <span className="money muted">—</span>;
  return (
    <span className="money" style={{ fontWeight: strong ? 600 : undefined, color: muted ? "var(--text-3)" : undefined }}>
      {fmtAmount(v)}{cur && <span className="cur">{cur}</span>}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (ts: number | string) => (typeof ts === "number" ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date(ts));
export const fmtTime = (ts: number | string) => { const d = toDate(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** "6 Nov 2026, 06:04" */
export const fmtDate = (ts: number | string) => { const d = toDate(ts); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${fmtTime(ts)}`; };
/** "Today, 06:04" / "Yesterday, 06:04" / "6 Nov, 06:04" */
export const fmtRelDay = (ts: number | string) => {
  const d = toDate(ts), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return `Today, ${fmtTime(ts)}`;
  if (diff === 1) return `Yesterday, ${fmtTime(ts)}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}, ${fmtTime(ts)}`;
};

export function Timestamp({ ts, mode = "rel" }: { ts?: number | string | null; mode?: "rel" | "abs" | "time" }) {
  if (ts == null) return <span className="muted">—</span>;
  const d = toDate(ts);
  const text = mode === "abs" ? fmtDate(ts) : mode === "time" ? fmtTime(ts) : fmtRelDay(ts);
  return <time className="tnum nowrap" dateTime={d.toISOString()} title={fmtDate(ts)}>{text}</time>;
}

/* ─── hash / id ─────────────────────────────────────────────────────────────────────────── */
export const middle = (s: string, head = 6, tail = 4) => (s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="icon-btn" aria-label={`${label} ${value}`} title={label}
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {}); }}>
      <Icon name={done ? "check" : "copy"} />
      {done && <span className="copied" role="status">Copied</span>}
    </button>
  );
}

/** Hash: mono, middle-truncated, copy button, optional explorer link. Used for addresses, tx hashes, Hedera ids, serials. */
export function Hash({ value, href, head = 6, tail = 4, full, copy = true, linkLabel }: { value?: string | null; href?: string; head?: number; tail?: number; full?: boolean; copy?: boolean; linkLabel?: string }) {
  if (!value) return <span className="muted">—</span>;
  const text = full ? value : middle(value, head, tail);
  const link = href && !isLocal(href);
  return (
    <span className="hash" title={value}>
      {link ? <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label={linkLabel ?? `View ${value} in explorer`}>{text}</a> : <span className="v">{text}</span>}
      {copy && <CopyButton value={value} />}
      {link && <a className="icon-btn" href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} tabIndex={-1} aria-hidden="true" title="Open in explorer"><Icon name="external" /></a>}
    </span>
  );
}

/** Explorer link with text label ("View on HashScan ↗"). */
export function ExtLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href || isLocal(href)) return <span className="muted">{children}</span>;
  return <a href={href} target="_blank" rel="noreferrer" className="row" style={{ display: "inline-flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>{children}<Icon name="external" /></a>;
}

/** Back-compat wrappers. */
export function TxLink({ url, hash }: { url?: string; hash?: string; label?: string }) {
  return <Hash value={hash} href={url} />;
}
export function HashscanLink({ txId, url }: { txId?: string; url?: string }) {
  if (!txId) return null;
  return url ? <ExtLink href={url}>View on HashScan</ExtLink> : <span className="muted" title={txId}>Simulated (no network record)</span>;
}

/* ─── status ────────────────────────────────────────────────────────────────────────────── */
type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";
const STATUS: Record<string, [string, Tone]> = {
  created: ["Created", "neutral"],
  paid: ["Paid · held", "info"],
  packed: ["Packed", "info"],
  dispatched: ["Out for delivery", "info"],
  handed_over: ["At the door", "info"],
  settled: ["Settled", "success"],
  returning: ["Return in progress", "warning"],
  returned: ["Returned", "neutral"],
  returned_to_seller: ["Returned", "neutral"],
  cancelled: ["Cancelled", "neutral"],
  timeout: ["Timed out", "warning"],
  awaiting_buyer: ["Awaiting buyer", "warning"],
  // inspection outcomes
  match: ["Verified match", "success"],
  mismatch: ["Wrong item", "danger"],
  damaged: ["Damaged", "warning"],
  // world checks
  pending: ["Pending", "info"], creating: ["Starting", "info"], validating: ["Validating", "info"],
  verified: ["Verified", "success"], denied: ["Declined", "danger"], wrong_courier: ["Wrong courier", "danger"],
  expired: ["Expired", "neutral"], failed: ["Failed", "danger"],
  low: ["Low balance", "warning"], ok: ["Healthy", "success"],
};
export const statusLabel = (s?: string | null) => (s ? STATUS[s]?.[0] ?? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "—");
export function Badge({ tone = "neutral", children, dot = true, title }: { tone?: Tone; children: ReactNode; dot?: boolean; title?: string }) {
  return <span className={`badge ${tone} ${dot ? "" : "nodot"}`} title={title}>{children}</span>;
}
export function StatusBadge({ s }: { s?: string | null }) {
  if (!s) return <span className="muted">—</span>;
  const [label, tone] = STATUS[s] ?? [statusLabel(s), "neutral" as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}
/** Back-compat. */
export const Pill = ({ s }: { s?: string | null }) => <StatusBadge s={s} />;

/* ─── layout primitives ─────────────────────────────────────────────────────────────────── */
export function PageHeader({ title, sub, badges, actions }: { title: ReactNode; sub?: ReactNode; badges?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <div className="row" style={{ gap: 10 }}><h1>{title}</h1>{badges}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, desc, actions, children, footer, flush, className = "", id }: { title?: ReactNode; desc?: ReactNode; actions?: ReactNode; children?: ReactNode; footer?: ReactNode; flush?: boolean; className?: string; id?: string }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || actions) && (
        <div className="card-h">
          <div>{title && <h2>{title}</h2>}{desc && <div className="desc">{desc}</div>}</div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-b ${flush ? "flush" : ""}`}>{children}</div>
      {footer && <div className="card-f">{footer}</div>}
    </section>
  );
}

export function KpiTile({ label, value, cur = "USDT", sub, loading, error, icon }: { label: string; value?: string | number | null; cur?: string | null; sub?: ReactNode; loading?: boolean; error?: boolean; icon?: IconName }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{icon && <Icon name={icon} />}{label}</div>
      <div className="kpi-value">
        {loading ? <Skeleton w={110} h={28} /> : error || value == null ? "—" : <>{cur ? fmtAmount(value) : value}{cur && <span className="cur">{cur}</span>}</>}
      </div>
      <div className="kpi-sub">{loading ? <Skeleton w={90} h={12} /> : sub ?? " "}</div>
    </div>
  );
}

export function Skeleton({ w = "100%", h = 14, r }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}
export function SkeletonRows({ rows = 3, cols = 5 }: { rows?: number; cols?: number }) {
  return <>{Array.from({ length: rows }).map((_, i) => <tr key={i}>{Array.from({ length: cols }).map((__, j) => <td key={j}><Skeleton w={j === 0 ? 90 : "70%"} /></td>)}</tr>)}</>;
}

const CALLOUT_ICON: Record<string, IconName> = { success: "check-circle", warning: "alert", danger: "x-circle", info: "info", neutral: "info" };
export function Callout({ tone = "info", title, children, action, icon }: { tone?: "success" | "warning" | "danger" | "info" | "neutral"; title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className={`callout ${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={icon ?? CALLOUT_ICON[tone]} />
      <div className="grow">
        {title && <div className="callout-title">{title}</div>}
        {children && <div className="callout-body">{children}</div>}
        {action && <div className="callout-action">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon = "package", title, children, action, small }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode; small?: boolean }) {
  return (
    <div className={`empty ${small ? "sm" : ""}`}>
      <div className="empty-icon"><Icon name={icon} /></div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export type StepState = "done" | "current" | "upcoming" | "failed" | "warn" | "neutral";
export function Stepper({ steps, responsive = true, label = "Progress" }: { steps: { label: string; state: StepState; time?: number | null; icon?: IconName }[]; responsive?: boolean; label?: string }) {
  return (
    <ol className={`stepper ${responsive ? "responsive" : ""}`} aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.label} className={s.state} aria-current={s.state === "current" ? "step" : undefined}>
          <div className="step-dot">
            {s.icon ? <Icon name={s.icon} /> : s.state === "done" ? <Icon name="check" /> : s.state === "failed" ? <Icon name="x" /> : s.state === "warn" ? <Icon name="alert" /> : i + 1}
          </div>
          <div>
            <div className="step-label">{s.label}<span className="sr-only"> ({s.state === "done" ? "complete" : s.state === "current" ? "in progress" : s.state === "upcoming" ? "not started" : s.state})</span></div>
            {s.time ? <div className="step-time">{fmtRelDay(s.time)}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Field({ label, htmlFor, help, children }: { label: string; htmlFor: string; help?: ReactNode; children: ReactNode }) {
  return <div className="field"><label htmlFor={htmlFor}>{label}</label>{children}{help && <div className="help">{help}</div>}</div>;
}

export function CodeBlock({ code }: { code: string }) {
  return <div className="code-block"><pre><code>{code}</code></pre><CopyButton value={code} label="Copy code" /></div>;
}

/* ─── receipts: contract events → buyer-friendly labels, grouped by transaction ─────────── */
const EVENT_LABEL: Record<string, string> = {
  OrderCreated: "Payment received", Paid: "Payment received", Dispatched: "Out for delivery", HandedOver: "Delivered",
  Settled: "Order settled", CourierPaid: "Courier paid", SellerPaid: "Seller paid", BuyerRefunded: "Refund to buyer",
  ReturnToSender: "Return started", ReturnRefunded: "Return refunded", Returned: "Return received", Cancelled: "Order cancelled",
  // invoice advances (merchant view only; the API hides these from buyers)
  NoteFunded: "Invoice advance received", PayoutLocked: "Payout assigned to lender", PayoutToNote: "Payout repays advance", NoteClosed: "Bond returned",
};
/** Amount a receipt line moved, in USDT. Advances show what reached the seller. */
const receiptAmount = (r: Receipt): number | undefined => {
  const d = r.data ?? {};
  if (r.event === "NoteFunded") return (Number(d.advance) - Number(d.holdback)) / 1e6;
  if (r.event === "NoteClosed") return Number(d.toSeller) > 0 ? Number(d.toSeller) / 1e6 : undefined;
  return d.amount != null ? Number(d.amount) / 1e6 : undefined;
};
export const eventLabel = (e: string) => EVENT_LABEL[e] ?? e.replace(/([a-z])([A-Z])/g, "$1 $2");
export type Receipt = { event: string; txHash: string; explorerUrl?: string; at?: number; data: any };
export type ReceiptGroup = { txHash: string; explorerUrl?: string; at?: number; title: string; lines: { label: string; amount?: number }[] };
const MERCHANT_LABEL: Record<string, string> = { HandedOver: "Delivered to buyer", BuyerRefunded: "Refund to buyer" };
const BUYER_LABEL: Record<string, string> = { HandedOver: "Delivered", BuyerRefunded: "Refund to you" };
export function groupReceipts(receipts: Receipt[], audience: "buyer" | "merchant" = "merchant", sellerPaid?: string | number | null): ReceiptGroup[] {
  const L = audience === "buyer" ? BUYER_LABEL : MERCHANT_LABEL;
  const lbl = (e: string) => L[e] ?? eventLabel(e);
  const out: ReceiptGroup[] = [];
  for (const r of receipts ?? []) {
    let g = out.find((x) => x.txHash === r.txHash);
    if (!g) { g = { txHash: r.txHash, explorerUrl: r.explorerUrl, at: r.at, title: lbl(r.event), lines: [] }; out.push(g); }
    const label = lbl(r.event);
    g.lines.push({ label, amount: receiptAmount(r) });
  }
  // Buyer view: when the seller's share was paid on the seller's behalf (e.g. to a financing partner), the API omits
  // that line. Show it as "Seller paid" on the settlement so the receipt matches the payment summary.
  if (audience === "buyer" && Number(sellerPaid) > 0 && !out.some((g) => g.lines.some((l) => l.label === EVENT_LABEL.SellerPaid))) {
    const settle = out.find((g) => g.lines.some((l) => l.label === EVENT_LABEL.Settled));
    if (settle) settle.lines.push({ label: EVENT_LABEL.SellerPaid, amount: Number(sellerPaid) });
  }
  for (const g of out) if (g.lines.length > 1) g.title = g.lines.some((l) => l.label === "Order settled") ? "Settlement" : g.lines.some((l) => l.label === EVENT_LABEL.NoteFunded) ? EVENT_LABEL.NoteFunded : g.title;
  return out;
}

/** Receipts list: event, amount, time, receipt link; groups lines that share one transaction. */
export function ReceiptList({ receipts, audience = "merchant", sellerPaid }: { receipts: Receipt[]; audience?: "buyer" | "merchant"; sellerPaid?: string | number | null }) {
  const groups = groupReceipts(receipts, audience, sellerPaid);
  if (!groups.length) return <EmptyState small icon="receipt" title="No receipts yet">They appear here as each step is recorded.</EmptyState>;
  return (
    <ul className="list">
      {groups.map((g) => {
        const money = g.lines.filter((l) => l.amount != null);
        const notes = g.lines.length > 1 ? g.lines.filter((l) => l.amount == null && l.label !== g.title).map((l) => l.label) : [];
        const single = g.lines.length === 1 && money.length === 1;
        return (
          <li key={g.txHash}>
            <div className="row between" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              <div className="grow">
                <div className="strong">{g.title}</div>
                <div className="xs muted"><Timestamp ts={g.at} />{notes.length ? <> · {notes.join(" · ")}</> : null}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <Hash value={g.txHash} href={g.explorerUrl} linkLabel="View receipt" />
                {single && <div className="small"><Money v={money[0].amount} /></div>}
              </div>
            </div>
            {!single && money.length > 0 && (
              <ul className="lines" style={{ marginTop: 6 }}>
                {money.map((l, i) => <li key={i} style={{ padding: "3px 0", fontSize: 13 }}><span>{l.label}</span><Money v={l.amount} /></li>)}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ─── live balances: presenter overlay for /demo only ───────────────────────────────────── */
export function BalanceStrip({ refId }: { refId?: string }) {
  const tick = useEvents(undefined, undefined);
  const [b, setB] = useState<any>();
  const [flash, setFlash] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api("GET", `/v1/demo/balances${refId ? `?ref=${refId}` : ""}`).then((nb) => {
      setB((old: any) => {
        if (old) {
          const f: Record<string, boolean> = {};
          nb.parties.forEach((p: any, i: number) => { if (old.parties[i]?.usdt !== p.usdt) f[p.role] = true; });
          setFlash(f);
          setTimeout(() => setFlash({}), 1200);
        }
        return nb;
      });
    }).catch(() => {});
  }, [tick, refId]);
  const roles: Record<string, string> = { buyer: "Buyer", courier: "Courier", seller: "Seller", lender: "Lender" };
  return (
    <>
      {!b && [0, 1, 2].map((i) => <div key={i} className="bal"><span className="skel" style={{ width: 120, height: 18, background: "#253045" }} /></div>)}
      {b?.parties.filter((p: any) => p.usdt != null).map((p: any) => (
        <div key={p.role} className={`bal ${flash[p.role] ? "flash" : ""}`} title={p.address}>
          <span className="role">{roles[p.role] ?? p.role}</span>
          <b>{fmtAmount(p.usdt)}</b> <small>USDT</small>
        </div>
      ))}
      {b && (
        <div className="bal" title={b.relayer.address}>
          <span className="role">Gas balance</span>
          <b>{fmtGas(b.relayer.balance)}</b> <small>WBT</small>
        </div>
      )}
    </>
  );
}

/* ─── inspection details (definition list) ───────────────────────────────────────────── */
export const hashscan = (network: string | undefined, kind: "topic" | "transaction", id: string) =>
  `https://hashscan.io/${(network ?? "hedera:testnet").split(":")[1] ?? "testnet"}/${kind}/${id}`;

/** Serial numbers compared ignoring separators/case (labels are read without dashes). */
export const sameSerial = (a?: string | null, b?: string | null) => !!a && !!b && a.replace(/[^a-z0-9]/gi, "").toUpperCase() === b.replace(/[^a-z0-9]/gi, "").toUpperCase();
/** Lay out a raw label read (e.g. "SNAX177310042") in the expected serial's format (e.g. "SN-AX1-7731-0042") when lengths line up. */
export function formatSerialLike(read?: string | null, expected?: string | null) {
  if (!read) return read ?? "";
  const raw = read.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!expected) return read;
  const exp = expected.replace(/[^a-z0-9]/gi, "");
  if (raw.length !== exp.length) return read;
  let i = 0;
  return expected.replace(/[a-z0-9]/gi, () => raw[i++]);
}
export const fmtGas = (v?: string | number | null) => (v == null ? "—" : Number(v).toFixed(3));
/** Display name without internal pricing tiers, e.g. "Northstar Inspect (budget)" → "Northstar Inspect". */
export const inspectorName = (n?: string) => (n ?? "").replace(/\s*\([^)]*\)\s*$/, "");

export function InspectionList({ i, expected, audience = "merchant" }: { i: any; expected?: string; audience?: "buyer" | "merchant" }) {
  const network = i.payment?.hashscan?.includes("/mainnet/") ? "hedera:mainnet" : "hedera:testnet";
  const matches = sameSerial(i.serialRead, expected);
  return (
    <dl className="dl">
      <dt>Result</dt><dd><StatusBadge s={i.outcome} />{i.outcome === "damaged" && i.refundBps ? <span className="small text-2">{i.refundBps / 100}% refund</span> : null}</dd>
      {expected && <><dt>Expected serial</dt><dd><span className="mono">{expected}</span></dd></>}
      <dt>Serial on label</dt><dd>
        {!i.serialRead ? <span className="muted">Not readable</span> : <span className="mono" title={`Read as ${i.serialRead}`}>{formatSerialLike(i.serialRead, expected)}</span>}
        {expected && i.serialRead && (matches ? <Badge tone="success">Matches</Badge> : <Badge tone="danger">Doesn&apos;t match</Badge>)}
      </dd>
      <dt>Damage</dt><dd>{i.damage === "none" ? "None found" : i.damage?.replace(/^./, (c: string) => c.toUpperCase())}</dd>
      <dt>Inspected by</dt><dd>{audience === "buyer" ? inspectorName(i.inspectorName) : i.inspectorName}</dd>
      <dt>Inspection fee</dt><dd>{audience === "buyer" ? <span className="text-2">Paid by your doorbell, not you</span> : <Money v={i.payment?.amountUsd} cur="USDC" />}</dd>
      <dt>Proof</dt><dd>
        {i.payment?.hashscan ? <ExtLink href={i.payment.hashscan}>{audience === "buyer" ? "Inspection payment" : "Payment"}</ExtLink> : <span className="muted">Simulated</span>}
        {i.hcs?.sequence && (i.payment?.mock ? <span className="muted">Verdict #{i.hcs.sequence}</span> : <ExtLink href={hashscan(network, "topic", i.hcs.topicId)}>Verdict #{i.hcs.sequence}</ExtLink>)}
      </dd>
    </dl>
  );
}

/* ─── overlays: drawer + dialog (focus moves in, Esc closes, focus returns) ─────────────── */
export function useModal(onClose: () => void) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = o; prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

export function Drawer({ title, sub, children, onClose }: { title: ReactNode; sub?: ReactNode; children: ReactNode; onClose: () => void }) {
  const closeRef = useModal(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="drawer-h">
          <div><h2 id="drawer-title">{title}</h2>{sub}</div>
          <button ref={closeRef} type="button" className="btn ghost sm" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="drawer-b">{children}</div>
      </aside>
    </>
  );
}

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const closeRef = useModal(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="row between" style={{ padding: "20px 24px 0" }}>
          <h2 id="dialog-title">{title}</h2>
          <button ref={closeRef} type="button" className="btn ghost sm" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </>
  );
}
