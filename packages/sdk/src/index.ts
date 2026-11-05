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

const STYLE = `
.obx-btn{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:.5rem;width:100%;padding:.85rem 1rem;border-radius:.6rem;background:#0f766e;color:#fff;font:600 15px/1.2 system-ui,sans-serif;cursor:pointer}
.obx-btn[disabled]{opacity:.6;cursor:progress}
.obx-sub{font:12px/1.4 system-ui,sans-serif;color:#475569;margin-top:.45rem;text-align:center}
.obx-ok{font:13px/1.4 system-ui,sans-serif;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:.5rem;padding:.6rem;margin-top:.6rem}
.obx-ok a{color:#047857}
.obx-err{font:13px/1.4 system-ui,sans-serif;color:#991b1b;margin-top:.5rem}`;

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
  el.innerHTML = `<button class="obx-btn" type="button">${o.label ?? "Pay on delivery · USDT"}</button>
    <div class="obx-sub">Paid only when the box at your door holds what you ordered. No gas, no wallet app.</div>
    <div class="obx-msg"></div>`;
  const btn = el.querySelector<HTMLButtonElement>(".obx-btn")!;
  const msg = el.querySelector<HTMLDivElement>(".obx-msg")!;
  btn.onclick = async () => {
    btn.disabled = true;
    msg.innerHTML = "";
    try {
      const r = await checkout({ ...o, onStatus: (s) => { btn.textContent = s; o.onStatus?.(s); } });
      btn.textContent = "Paid ✓";
      msg.innerHTML = `<div class="obx-ok">Order <b>${r.ref}</b> is held for verified delivery. <a href="${r.explorerUrl}" target="_blank" rel="noopener">On-chain receipt</a> · <a href="${r.trackUrl}" target="_blank" rel="noopener">Track &amp; open at the door</a></div>`;
      o.onPaid?.(r);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = o.label ?? "Pay on delivery · USDT";
      msg.innerHTML = `<div class="obx-err">${(e as Error).message}</div>`;
      o.onError?.(e as Error);
    }
  };
  return { el };
}

export const OpenBox = { mount, checkout, embeddedWallet, resetWallet };
export default OpenBox;
