/**
 * One real invoice-advance order on Whitechain testnet, through the public API exactly as the UIs drive it:
 *   buyer pays official USDT gaslessly → merchant packs → courier World check binds courier →
 *   merchant requests an invoice advance (seller signs the offer) → lender funds it (ReceivableNote NFT minted,
 *   seller paid today minus the bond) → handover at the door → inspection verdict settles →
 *   the payout repays the note holder and the bond returns to the seller.
 * Run with the stack up:  pnpm dev:testnet --no-ui --world-mock   then   npx tsx scripts/testnet/live-financed-order.ts
 */
import { readFileSync } from "node:fs";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { explorerTx } from "@openbox/shared";
import { chainReader, openboxClient, sleep } from "../lib/openbox-client";

const [imgPath = "scripts/testnet/fixtures/label-aurora.png", serial = "SN-AX1-7731-0042"] = process.argv.slice(2);
const { api, waitReq, checkout } = openboxClient();
const lenderKey = process.env.LENDER_API_KEY ?? "lk_demo_openbox";
const lenderApi = async (method: string, path: string) => {
  const r = await fetch(`${process.env.API ?? "http://localhost:4000"}${path}`, { method, headers: { authorization: `Bearer ${lenderKey}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return JSON.parse(text);
};

const links: [string, string][] = [];
const tx = (label: string, h?: string) => {
  if (!h) return;
  const url = explorerTx(1874, h);
  links.push([label, url]);
  console.log(`   ${label}: ${url}`);
};

const cfg = await api("GET", "/v1/config");
if (cfg.chainId !== 1874) throw new Error(`backend is on chain ${cfg.chainId}, expected 1874`);
const { bal } = chainReader(cfg.rpcUrl, cfg.token.address as Address);
const buyer = privateKeyToAccount(generatePrivateKey());
const courier = privateKeyToAccount(generatePrivateKey()).address;
const seller = (await api("GET", "/v1/merchant/stats", undefined, true)).merchant.seller as Address;
const market0 = await lenderApi("GET", "/v1/lender/marketplace");
const lender = market0.lender as Address;
console.log(`\nOpenBox LIVE invoice advance · Whitechain ${cfg.chainId} · note ${market0.noteAddress} · lender ${lender}\n`);

console.log("1) Buyer pays (official USDT, gasless)");
tx("demo top-up", (await api("POST", "/v1/demo/fund", { address: buyer.address })).txHash);
const s = await checkout(buyer, "aurora-x1");
console.log(`   order ${s.ref}: ${s.amount} USDT (courier fee ${s.fee})`);
tx("official USDT payment", s.payTx);

console.log("2) Merchant packs; courier passes World check → dispatched");
await api("POST", `/v1/merchant/orders/${s.ref}/pack`, { serial }, true);
const dreq = await api("POST", `/v1/merchant/orders/${s.ref}/dispatch`, { courierName: "Alice", payout: courier }, true);
if (cfg.worldMode === "mock") await api("POST", "/v1/world/mock/complete", { requestId: dreq.id, persona: "alice", decision: "approve" });
else console.log(`   >>> Courier: open in World App: ${dreq.verificationUri}`);
const d = await waitReq(dreq.id, ["dispatched", "failed", "denied", "expired"], 300000, 1000);
if (d.status !== "dispatched") throw new Error(`dispatch ${d.status}: ${d.reason}`);
tx("dispatch", d.txHash);

console.log("3) Seller requests an invoice advance (signs FinanceOffer + LockPayout, no tx)");
const view = await api("POST", `/v1/merchant/orders/${s.ref}/financing`, {}, true);
const offer = view.offer;
if (!offer?.id) throw new Error(`no offer created: ${JSON.stringify(view).slice(0, 300)}`);
console.log(`   offer #${offer.id}: advance ${offer.advance} USDT, bond ${offer.holdback} USDT, face ${offer.face ?? view.quote?.face} USDT`);

console.log("4) Lender funds it → ReceivableNote NFT minted, seller paid today");
const sBefore = await bal(seller), lBefore = await bal(lender);
const funded = await lenderApi("POST", `/v1/lender/offers/${offer.id}/fund`);
tx("finance (note minted, seller advanced)", funded.txHash);
links.push(["ReceivableNote NFT", funded.tokenUrl]);
console.log(`   note: ${funded.tokenUrl}`);
await sleep(2000);
console.log(`   seller +${((await bal(seller)) - sBefore).toFixed(2)} USDT today · lender ${((await bal(lender)) - lBefore).toFixed(2)} USDT`);

console.log("5) Door: same courier → handover");
const qr = (await api("GET", `/v1/merchant/orders/${s.ref}`, undefined, true)).qr as string;
const h = await api("POST", "/v1/doorbell/handover", { qr });
if (!h.ok) throw new Error(`handover refused: ${h.reason}`);
if (cfg.worldMode === "mock") await api("POST", "/v1/world/mock/complete", { requestId: h.request.id, persona: "alice", decision: "approve" });
const hv = await waitReq(h.request.id, ["handed_over", "wrong_courier", "denied", "failed", "expired"], 300000, 1000);
if (hv.status !== "handed_over") throw new Error(`handover ${hv.status}: ${hv.reason}`);
tx("handover", hv.txHash);

console.log("6) Inspection → settle → payout repays the note holder, bond back to seller");
const s1 = await bal(seller), l1 = await bal(lender);
const frame = `data:image/png;base64,${readFileSync(imgPath).toString("base64")}`;
const insp = await api("POST", "/v1/doorbell/inspect", { ref: s.ref, frame, mode: "delivery" });
console.log(`   verdict: ${insp.result.outcome} (serial read "${insp.result.serialRead}")`);
if (insp.result.payment?.hashscan) links.push(["Hedera x402 inspection payment", insp.result.payment.hashscan]);
tx(`settle (${insp.result.outcome}) + note repaid`, insp.txHash);
await sleep(3000);
console.log(`   lender +${((await bal(lender)) - l1).toFixed(2)} USDT · seller +${((await bal(seller)) - s1).toFixed(2)} USDT (bond returned)`);
for (let i = 0; i < 20; i++) {
  const m = await lenderApi("GET", "/v1/lender/marketplace");
  const closed = (m.closed ?? []).find((n: { orderRef?: string; ref?: string }) => (n.orderRef ?? n.ref) === s.ref);
  if (closed) { console.log(`   marketplace: note closed as ${closed.status ?? closed.outcome}`); break; }
  await sleep(3000);
}

console.log("\nREADME links:");
for (const [k, v] of links) console.log(`| ${k} | ${v} |`);
process.exit(0);
