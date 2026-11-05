/**
 * Small HTTP client for the OpenBox API, shared by the e2e suite and the live testnet order.
 * Drives the same public endpoints the UIs and the SDK use.
 */
import { createPublicClient, erc20Abi, formatUnits, http, type Address, type Hex, type LocalAccount } from "viem";
import { signableTypedData, type JsonTypedData } from "@openbox/shared";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function openboxClient(opts: { api?: string; secretKey?: string; publishableKey?: string } = {}) {
  const base = opts.api ?? process.env.API ?? "http://localhost:4000";
  const sk = opts.secretKey ?? process.env.MERCHANT_SECRET_KEY ?? "sk_demo_openbox";
  const pk = opts.publishableKey ?? process.env.MERCHANT_PUBLISHABLE_KEY ?? "pk_demo_openbox";

  /** `merchant: true` adds the merchant secret key (server-to-server endpoints). */
  async function api<T = any>(method: string, path: string, body?: unknown, merchant = false): Promise<T> {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(merchant ? { authorization: `Bearer ${sk}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Poll a World check until it reaches one of `until`. */
  async function waitReq(id: string, until: string[], ms = 20000, pollMs = 300) {
    const t = Date.now();
    for (;;) {
      const r = await api("GET", `/v1/world/requests/${id}`);
      if (until.includes(r.status)) return r;
      if (Date.now() - t > ms) throw new Error(`World request ${id} stuck at ${r.status} (${r.reason ?? ""})`);
      await sleep(pollMs);
    }
  }

  /** Buyer checkout exactly as the SDK does it: prepare → sign typed data (no tx, no gas) → relayer pays. */
  async function checkout(buyer: LocalAccount, sku = "aurora-x1") {
    const s = await api("POST", "/v1/checkout/sessions", { publishableKey: pk, sku });
    const prep = await api<{ toSign: { kind: string; typedData: JsonTypedData }[] }>("POST", `/v1/checkout/sessions/${s.ref}/prepare`, { buyer: buyer.address });
    const signatures: Record<string, Hex> = {};
    for (const item of prep.toSign) {
      signatures[item.kind] = await buyer.signTypedData(signableTypedData(item.typedData) as Parameters<LocalAccount["signTypedData"]>[0]);
    }
    const paid = await api("POST", `/v1/checkout/sessions/${s.ref}/pay`, { buyer: buyer.address, signatures });
    return { ref: s.ref as string, amount: Number(s.amount) / 1e6, fee: Number(s.courierFee) / 1e6, payTx: paid.txHash as Hex };
  }

  return { api, waitReq, checkout, secretKey: sk };
}

/** USDT balance reader (6 decimals) plus the public client, from the backend's /v1/config. */
export function chainReader(rpcUrl: string, token: Address) {
  const pub = createPublicClient({ transport: http(rpcUrl) });
  const bal = async (a: Address) =>
    Number(formatUnits(await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [a] }), 6));
  return { pub, bal };
}
