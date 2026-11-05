import { randomBytes } from "node:crypto";
import {
  encodeFunctionData, erc20Abi, hashStruct, parseAbi, parseSignature, type Address, type Hex,
} from "viem";
import {
  accountDomain, authNonce, deliveryCheckoutAbi, executeTypes, openBoxAccountAbi, openBoxAccountFactoryAbi,
  orderIdFromRef, orderIntentTypes, orderTermsTypes, permitTypes, receiveWithAuthorizationTypes,
  type OrderTerms,
} from "@openbox/shared";
import { cfg } from "./config";
import { accounts, deployment, publicClient, txUrl, checkoutDomain } from "./chain";
import { db, getOrderByRef, now, type OrderRow } from "./db";
import { relay } from "./relayer";
import { indexNow } from "./indexer";
import { publish } from "./bus";

export type Merchant = {
  id: string; name: string; seller: Address; publishable_key: string; secret_key: string;
  webhook_url: string | null; webhook_secret: string;
};
export type Product = { merchant_id: string; sku: string; name: string; amount: string; courier_fee: string; serial: string | null };

export const merchantByPk = (pk: string) =>
  db.prepare("SELECT * FROM merchants WHERE publishable_key = ?").get(pk) as Merchant | undefined;
export const merchantBySk = (sk: string) =>
  db.prepare("SELECT * FROM merchants WHERE secret_key = ?").get(sk) as Merchant | undefined;
export const merchantById = (id: string) =>
  db.prepare("SELECT * FROM merchants WHERE id = ?").get(id) as Merchant | undefined;

const big = (o: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export function termsFromRow(o: OrderRow): OrderTerms {
  const t = JSON.parse(o.terms_json);
  return {
    orderId: t.orderId, seller: t.seller, amount: BigInt(t.amount), courierFee: BigInt(t.courierFee),
    deliveryWindow: BigInt(t.deliveryWindow), inspectionWindow: BigInt(t.inspectionWindow),
    returnWindow: BigInt(t.returnWindow), deadline: BigInt(t.deadline),
  };
}

function newRef() {
  return `OB-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Create a checkout session: price comes from the merchant's catalog, never from the browser. */
export async function createSession(m: Merchant, sku: string) {
  const p = db.prepare("SELECT * FROM products WHERE merchant_id = ? AND sku = ?").get(m.id, sku) as Product | undefined;
  if (!p) throw new Error(`unknown sku ${sku}`);
  const ref = newRef();
  const orderId = orderIdFromRef(ref);
  const terms: OrderTerms = {
    orderId, seller: m.seller, amount: BigInt(p.amount), courierFee: BigInt(p.courier_fee),
    deliveryWindow: cfg.windows.delivery, inspectionWindow: cfg.windows.inspection, returnWindow: cfg.windows.return,
    deadline: BigInt(now() + 3600),
  };
  // Demo: the backend holds the merchant's signing key. Production: merchant signs on its own server.
  const sellerSig = await accounts.seller.signTypedData({ domain: checkoutDomain, types: orderTermsTypes, primaryType: "OrderTerms", message: terms });
  db.prepare(
    `INSERT INTO orders (ref, order_id, merchant_id, sku, product, seller, amount, courier_fee, terms_json, seller_sig, serial, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(ref, orderId.toLowerCase(), m.id, sku, p.name, m.seller.toLowerCase(), p.amount, p.courier_fee,
    JSON.stringify(big(terms)), sellerSig, p.serial, now(), now());
  publish("order.created", { ref, orderId, data: { product: p.name, amount: p.amount } });
  return sessionView(getOrderByRef(ref)!);
}

export function sessionView(o: OrderRow) {
  return {
    ref: o.ref, orderId: o.order_id, product: o.product, amount: o.amount, courierFee: o.courier_fee,
    status: o.status, chainId: cfg.chainId, checkout: deployment.deliveryCheckout, token: deployment.token,
    gaslessMode: cfg.gaslessMode, mockToken: deployment.mockToken,
  };
}

// ---- token EIP-712 domain (for permit / 3009) ---------------------------------------

let tokenDomainCache: { name: string; version: string; chainId: number; verifyingContract: Address } | undefined;

export async function tokenDomain() {
  if (tokenDomainCache) return tokenDomainCache;
  const t = deployment.token;
  let name: string, version: string;
  try {
    const d = await publicClient.readContract({
      address: t,
      abi: parseAbi(["function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])"]),
      functionName: "eip712Domain",
    });
    name = d[1]; version = d[2];
  } catch {
    name = await publicClient.readContract({ address: t, abi: erc20Abi, functionName: "name" });
    version = process.env.USDT_PERMIT_VERSION ?? "1";
  }
  const dom = { name, version, chainId: cfg.chainId, verifyingContract: t };
  // Sanity check against DOMAIN_SEPARATOR() so we never ask buyers to sign something the token will reject.
  try {
    const sep = await publicClient.readContract({ address: t, abi: parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]), functionName: "DOMAIN_SEPARATOR" });
    const ours = hashStruct({
      data: { ...dom, chainId: BigInt(dom.chainId) }, primaryType: "EIP712Domain",
      types: { EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ] },
    });
    if (sep.toLowerCase() !== ours.toLowerCase()) console.warn(`[checkout] token domain mismatch: set USDT_PERMIT_VERSION (tried ${version})`);
  } catch { /* token without DOMAIN_SEPARATOR */ }
  tokenDomainCache = dom;
  return dom;
}

// ---- prepare / pay ------------------------------------------------------------------

const prepared = new Map<string, { buyer: Address; mode: string; message: Record<string, unknown>; payer: Address }>();

/** Returns the EIP-712 payloads the buyer signs. No transaction, no gas, for the buyer. */
export async function prepare(ref: string, buyer: Address) {
  const o = getOrderByRef(ref);
  if (!o) throw new Error("unknown order");
  if (o.status !== "created") throw new Error(`order already ${o.status}`);
  const terms = termsFromRow(o);
  const termsHash = hashStruct({ data: terms, types: orderTermsTypes, primaryType: "OrderTerms" });
  const deadline = BigInt(now() + 900);
  const mode = cfg.gaslessMode;
  const toSign: { kind: string; typedData: Record<string, unknown> }[] = [];

  if (mode === "permit" || mode === "eip3009") {
    toSign.push({ kind: "intent", typedData: big({ domain: checkoutDomain, types: orderIntentTypes, primaryType: "OrderIntent", message: { orderId: terms.orderId, buyer, termsHash } }) });
    const td = await tokenDomain();
    if (mode === "permit") {
      const nonce = await publicClient.readContract({ address: deployment.token, abi: parseAbi(["function nonces(address) view returns (uint256)"]), functionName: "nonces", args: [buyer] });
      const message = { owner: buyer, spender: deployment.deliveryCheckout, value: terms.amount, nonce, deadline };
      toSign.push({ kind: "permit", typedData: big({ domain: td, types: permitTypes, primaryType: "Permit", message }) });
      prepared.set(`${ref}:${buyer.toLowerCase()}`, { buyer, mode, message, payer: buyer });
    } else {
      const message = { from: buyer, to: deployment.deliveryCheckout, value: terms.amount, validAfter: 0n, validBefore: deadline, nonce: authNonce(terms.orderId, buyer) };
      toSign.push({ kind: "authorization", typedData: big({ domain: td, types: receiveWithAuthorizationTypes, primaryType: "ReceiveWithAuthorization", message }) });
      prepared.set(`${ref}:${buyer.toLowerCase()}`, { buyer, mode, message, payer: buyer });
    }
    return { mode, payer: buyer, toSign };
  }

  // account mode: buyer EOA owns a counterfactual OpenBoxAccount which holds the USDT
  const acct = await publicClient.readContract({ address: deployment.accountFactory, abi: openBoxAccountFactoryAbi, functionName: "accountAddress", args: [buyer] });
  const code = await publicClient.getCode({ address: acct });
  const nonce = code && code !== "0x"
    ? await publicClient.readContract({ address: acct, abi: openBoxAccountAbi, functionName: "nonce" })
    : 0n;
  const calls = [
    { target: deployment.token, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [deployment.deliveryCheckout, terms.amount] }) },
    { target: deployment.deliveryCheckout, value: 0n, data: encodeFunctionData({ abi: deliveryCheckoutAbi, functionName: "createOrder", args: [terms, o.seller_sig] }) },
  ];
  const message = { calls, nonce, deadline };
  toSign.push({ kind: "execute", typedData: big({ domain: accountDomain(cfg.chainId, acct), types: executeTypes, primaryType: "Execute", message }) });
  prepared.set(`${ref}:${buyer.toLowerCase()}`, { buyer, mode, message, payer: acct });
  return { mode, payer: acct, toSign };
}

export async function pay(ref: string, buyer: Address, sigs: Record<string, Hex>, ip?: string) {
  const o = getOrderByRef(ref);
  if (!o) throw new Error("unknown order");
  const p = prepared.get(`${ref}:${buyer.toLowerCase()}`);
  if (!p) throw new Error("call prepare first");
  const terms = termsFromRow(o);
  let hash: Hex;
  if (p.mode === "permit") {
    const s = parseSignature(sigs.permit);
    const m = p.message as { deadline: bigint };
    ({ hash } = await relay({
      target: "checkout", functionName: "createOrderWithPermit", ip, wallet: buyer,
      args: [terms, o.seller_sig, buyer, sigs.intent, { deadline: m.deadline, v: Number(s.v ?? BigInt(s.yParity + 27)), r: s.r, s: s.s }],
    }));
  } else if (p.mode === "eip3009") {
    const s = parseSignature(sigs.authorization);
    const m = p.message as { validAfter: bigint; validBefore: bigint };
    ({ hash } = await relay({
      target: "checkout", functionName: "createOrderWithAuthorization", ip, wallet: buyer,
      args: [terms, o.seller_sig, buyer, sigs.intent, { validAfter: m.validAfter, validBefore: m.validBefore, v: Number(s.v ?? BigInt(s.yParity + 27)), r: s.r, s: s.s }],
    }));
  } else {
    const code = await publicClient.getCode({ address: p.payer });
    if (!code || code === "0x") await relay({ target: "factory", functionName: "createAccount", args: [buyer], ip, wallet: buyer });
    const m = p.message as { calls: unknown[]; deadline: bigint };
    ({ hash } = await relay({ target: "account", to: p.payer, functionName: "execute", args: [m.calls, m.deadline, sigs.execute], ip, wallet: buyer }));
  }
  prepared.delete(`${ref}:${buyer.toLowerCase()}`);
  await indexNow();
  return { txHash: hash, explorerUrl: txUrl(hash), payer: p.payer };
}
