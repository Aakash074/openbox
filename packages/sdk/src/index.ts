import type { Hex } from "viem";
import { signableTypedData, type JsonTypedData } from "@openbox/shared";
import { embeddedWallet, resetWallet, type WalletMode } from "./wallet";

export { embeddedWallet, resetWallet };
export type { WalletMode };

export type PaidResult = {
  ref: string;
  orderId: Hex;
  txHash: Hex;
  explorerUrl: string;
  buyer: Hex;
  trackUrl: string;
};

export type MountOptions = {
  /** Merchant publishable key (safe in the browser; prices come from the merchant's catalog server-side). */
  publishableKey: string;
  /** Catalog SKU to buy. */
  sku: string;
  /** OpenBox API base. */
  apiBase?: string;
  /** Where buyers follow their order (open-box at the door, refunds). */
  trackBase?: string;
  /** Embedded key mode. Default "passkey" (falls back to local when the device lacks WebAuthn PRF). */
  wallet?: WalletMode;
  /** Demo only: auto top-up the buyer with test USDT when the balance is short. */
  demoFund?: boolean;
  label?: string;
  onPaid?: (r: PaidResult) => void;
  onError?: (e: Error) => void;
  onStatus?: (s: string) => void;
};

type ToSign = { kind: string; typedData: JsonTypedData };

async function call<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
  return j as T;
}

/** Headless checkout: create the order, sign silently with the embedded key, relay gaslessly. */
export async function checkout(o: MountOptions): Promise<PaidResult> {
  const api = (o.apiBase ?? "http://localhost:4000").replace(/\/$/, "");
  const status = o.onStatus ?? (() => {});
  status("Creating order…");
  const session = await call<{ ref: string; orderId: Hex; amount: string }>(api, "POST", "/v1/checkout/sessions", { publishableKey: o.publishableKey, sku: o.sku });
  const { account } = await embeddedWallet(o.wallet ?? "passkey");
  status("Preparing payment…");
  const prep = await call<{ mode: string; payer: Hex; toSign: ToSign[] }>(api, "POST", `/v1/checkout/sessions/${session.ref}/prepare`, { buyer: account.address });
  if (o.demoFund) {
    const { usdt } = await call<{ usdt: string }>(api, "GET", `/v1/balance/${prep.payer}`);
    if (Number(usdt) * 1e6 < Number(session.amount)) {
      status("Topping up test USDT…");
      await call(api, "POST", "/v1/demo/fund", { address: prep.payer, amount: 300 });
    }
  }
  status("Authorising…");
  const signatures: Record<string, Hex> = {};
  for (const item of prep.toSign) {
    signatures[item.kind] = await account.signTypedData(signableTypedData(item.typedData) as Parameters<typeof account.signTypedData>[0]);
  }
  status("Paying (no gas needed)…");
  const paid = await call<{ txHash: Hex; explorerUrl: string }>(api, "POST", `/v1/checkout/sessions/${session.ref}/pay`, { buyer: account.address, signatures });
  const trackBase = (o.trackBase ?? "http://localhost:3000").replace(/\/$/, "");
  return { ref: session.ref, orderId: session.orderId, txHash: paid.txHash, explorerUrl: paid.explorerUrl, buyer: account.address, trackUrl: `${trackBase}/buyer/${session.ref}` };
}

const F = `font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif`;
const STYLE = `
.obx{${F};color:#101828;text-align:left}
.obx-btn{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:.5rem;width:100%;min-height:44px;padding:.7rem 1rem;border-radius:8px;background:#101828;color:#fff;${F};font-weight:600;font-size:15px;line-height:1.2;cursor:pointer;transition:background .12s}
.obx-btn:hover{background:#1D2939}
.obx-btn:focus-visible{outline:2px solid #0F766E;outline-offset:2px;box-shadow:0 0 0 4px rgb(15 118 110 / .25)}
.obx-btn[disabled]{cursor:progress;background:#344054}
.obx-btn svg{width:20px;height:20px;flex:none}
.obx-btn.obx-done{background:#067647;cursor:default}
.obx-spin{animation:obx-spin 1s linear infinite}@keyframes obx-spin{to{transform:rotate(360deg)}}
.obx-sub{font-size:12px;line-height:1.45;color:#475467;margin-top:.5rem}
.obx-steps{display:flex;gap:4px;margin-top:.6rem;list-style:none;padding:0}
.obx-steps[hidden]{display:none}
.obx-steps li{flex:1;font-size:11px;color:#667085;padding-top:6px;border-top:3px solid #E4E7EC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.obx-steps li.on{color:#101828;font-weight:600;border-color:#0F766E}
.obx-steps li.done{border-color:#0F766E}
.obx-ok{font-size:13px;line-height:1.45;color:#054F31;background:#ECFDF3;border:1px solid #ABEFC6;border-radius:8px;padding:.6rem .75rem;margin-top:.6rem}
.obx-ok b{display:block;font-size:14px;color:#067647;margin-bottom:2px}
.obx-ok a,.obx-foot a{color:#0F766E;font-weight:500;text-decoration:none}
.obx-ok a:hover,.obx-foot a:hover{text-decoration:underline}
.obx-err{font-size:13px;line-height:1.45;color:#912018;background:#FEF3F2;border:1px solid #FECDCA;border-radius:8px;padding:.6rem .75rem;margin-top:.6rem}
.obx-err button{all:unset;cursor:pointer;color:#B42318;font-weight:600;text-decoration:underline;margin-left:.25rem}
.obx-err button:focus-visible{outline:2px solid #B42318;outline-offset:2px}
.obx-foot{display:flex;align-items:center;gap:5px;font-size:11px;color:#667085;margin-top:.55rem}
.obx-foot svg{width:12px;height:12px;flex:none}
.obx-foot b{color:#344054;font-weight:600}`;

const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0F766E"/><path d="M16 6.5 25 11v10l-9 4.5L7 21V11z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="m12 16 3 3 5.5-6" fill="none" stroke="#5EEAD4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const SPIN = `<svg class="obx-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
const STEPS = ["Order", "Authorise", "Pay", "Held"];
/** Map checkout() status strings (unchanged, still sent to onStatus) to a widget step. */
const stepOf = (s: string) => (/creat|prepar/i.test(s) ? 0 : /top|authoris/i.test(s) ? 1 : /pay/i.test(s) ? 2 : 0);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Buyer-friendly error copy; the raw error still goes to onError. */
function friendly(e: Error): string {
  const m = e.message || "";
  if (/failed to fetch|network|load failed/i.test(m)) return "We couldn't reach the payment service. Check your connection.";
  if (/insufficient|balance|exceeds/i.test(m)) return "There isn't enough balance to complete this payment.";
  if (/cancel|abort|notallowed|denied/i.test(m)) return "The payment was cancelled on this device.";
  if (/sku|product|catalog|not found/i.test(m)) return "This item can't be bought right now.";
  return "The payment didn't go through.";
}

/** Drop-in button. `OpenBox.mount('#checkout', { publishableKey, sku, onPaid })` */
export function mount(target: string | HTMLElement, o: MountOptions) {
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`OpenBox: ${target} not found`);
  if (!document.getElementById("obx-style")) {
    const s = document.createElement("style");
    s.id = "obx-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
  const label = o.label ?? "Pay with OpenBox";
  const learn = `${(o.trackBase ?? "http://localhost:3000").replace(/\/$/, "")}/`;
  el.innerHTML = `<div class="obx">
    <button class="obx-btn" type="button">${MARK}<span class="obx-label">${esc(label)}</span></button>
    <ol class="obx-steps" aria-label="Payment progress" hidden>${STEPS.map((s) => `<li>${s}</li>`).join("")}</ol>
    <div class="obx-sub">Your payment is held until the parcel is checked at your door. Full refund if it's not what you ordered.</div>
    <div class="obx-msg" aria-live="polite"></div>
    <div class="obx-foot">${LOCK}<span>Secured by <b>OpenBox</b></span>·<a href="${learn}" target="_blank" rel="noopener">Learn more</a></div>
  </div>`;
  const btn = el.querySelector<HTMLButtonElement>(".obx-btn")!;
  const steps = el.querySelector<HTMLOListElement>(".obx-steps")!;
  const msg = el.querySelector<HTMLDivElement>(".obx-msg")!;
  const setStep = (n: number) => steps.querySelectorAll("li").forEach((li, i) => { li.className = i < n ? "done" : i === n ? "on" : ""; });
  const idle = () => { btn.disabled = false; btn.innerHTML = `${MARK}<span class="obx-label">${esc(label)}</span>`; steps.hidden = true; };
  const run = async () => {
    btn.disabled = true;
    btn.innerHTML = `${SPIN}<span class="obx-label">Processing…</span>`;
    steps.hidden = false; setStep(0);
    msg.innerHTML = "";
    try {
      const r = await checkout({ ...o, onStatus: (s) => { setStep(stepOf(s)); o.onStatus?.(s); } });
      setStep(4);
      btn.classList.add("obx-done");
      btn.innerHTML = `${CHECK}<span>Payment held</span>`;
      msg.innerHTML = `<div class="obx-ok" role="status"><b>Order ${esc(r.ref)} placed</b>Your payment is held until delivery is verified. <a href="${r.trackUrl}" target="_blank" rel="noopener">Track your order</a> · <a href="${r.explorerUrl}" target="_blank" rel="noopener">Payment receipt</a></div>`;
      o.onPaid?.(r);
    } catch (e) {
      idle();
      msg.innerHTML = `<div class="obx-err" role="alert">${esc(friendly(e as Error))}<button type="button">Try again</button></div>`;
      msg.querySelector("button")!.onclick = run;
      o.onError?.(e as Error);
    }
  };
  btn.onclick = run;
  return { el };
}

export const OpenBox = { mount, checkout, embeddedWallet, resetWallet };
export default OpenBox;
