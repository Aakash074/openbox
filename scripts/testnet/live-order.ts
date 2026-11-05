/**
 * One real order on the testnets, through the public API exactly as the UIs drive it:
 *   buyer pays official USDT gaslessly (Whitechain 1874) → merchant packs → courier World check binds courier on-chain →
 *   door: same courier passes → household agent discovers inspectors on HCS, refuses the over-budget one, pays the
 *   cheaper one in HTS USDC over x402 (Hedera testnet) → Claude reads the label → signed verdict settles on Whitechain.
 * Prints every explorer / HashScan link for the README.
 * Run with the stack up:  pnpm dev:testnet --no-ui --world-mock   then   pnpm live:order [label.png] [serial]
 */
import { readFileSync } from "node:fs";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { explorerTx, hashscanTopic } from "@openbox/shared";
import { chainReader, openboxClient, sleep } from "../lib/openbox-client";

const [imgPath = "scripts/testnet/fixtures/label-aurora.png", serial = "SN-AX1-7731-0042"] = process.argv.slice(2);
const { api, waitReq, checkout } = openboxClient();

const links: [string, string][] = [];
const tx = (label: string, h?: string) => {
  if (!h) return;
  const url = explorerTx(1874, h);
  links.push([label, url]);
  console.log(`   ${label}: ${url}`);
};

const cfg = await api("GET", "/v1/config");
if (cfg.chainId !== 1874) throw new Error(`backend is on chain ${cfg.chainId}, expected 1874`);
const token = cfg.token.address as Address;
const { pub, bal } = chainReader(cfg.rpcUrl, token);
console.log(`\nOpenBox LIVE · Whitechain ${cfg.chainId} (${cfg.token.symbol} ${token}) · world=${cfg.worldMode} · hedera=${cfg.hederaMode}\n`);

const buyer = privateKeyToAccount(generatePrivateKey());
const courier = privateKeyToAccount(generatePrivateKey()).address;
const seller = (await api("GET", "/v1/merchant/stats", undefined, true)).merchant.seller as Address;

console.log("1) Fund a fresh buyer wallet from the demo treasury (official USDT)");
const fund = await api("POST", "/v1/demo/fund", { address: buyer.address });
tx("demo top-up", fund.txHash);

console.log("2) Checkout: buyer signs only (EIP-3009), merchant relayer pays gas");
const s = await checkout(buyer, "aurora-x1");
console.log(`   order ${s.ref}: ${s.amount} USDT (courier fee ${s.fee})`);
tx("official USDT payment (createOrderWithAuthorization)", s.payTx);

console.log("3) Merchant packs; courier passes World check → bound on-chain");
await api("POST", `/v1/merchant/orders/${s.ref}/pack`, { serial }, true);
const dreq = await api("POST", `/v1/merchant/orders/${s.ref}/dispatch`, { courierName: "Alice", payout: courier }, true);
if (cfg.worldMode === "mock") await api("POST", "/v1/world/mock/complete", { requestId: dreq.id, persona: "alice", decision: "approve" });
else console.log(`   >>> Courier: scan/open in World App: ${dreq.verificationUri}`);
const d = await waitReq(dreq.id, ["dispatched", "failed", "denied", "expired"], 300000, 1000);
if (d.status !== "dispatched") throw new Error(`dispatch ${d.status}: ${d.reason}`);
tx("dispatch (courier World ID hash bound)", d.txHash);
const qr = (await api("GET", `/v1/merchant/orders/${s.ref}`, undefined, true)).qr as string;

console.log("4) Door: QR scanned, same courier passes World check → handover (pays nothing)");
const h = await api("POST", "/v1/doorbell/handover", { qr });
if (!h.ok) throw new Error(`handover refused: ${h.reason}`);
if (cfg.worldMode === "mock") await api("POST", "/v1/world/mock/complete", { requestId: h.request.id, persona: "alice", decision: "approve" });
else console.log(`   >>> Courier: scan/open in World App: ${h.request.verificationUri}`);
const hv = await waitReq(h.request.id, ["handed_over", "wrong_courier", "denied", "failed", "expired"], 300000, 1000);
if (hv.status !== "handed_over") throw new Error(`handover ${hv.status}: ${hv.reason}`);
tx("handover", hv.txHash);

console.log("5) Open box on camera → agent pays inspector over x402 (Hedera USDC) → Claude → verdict settles");
const c0 = await bal(courier), s0 = await bal(seller);
const img = readFileSync(imgPath).toString("base64");
const frame = `data:image/${imgPath.endsWith(".png") ? "png" : "jpeg"};base64,${img}`;
const insp = await api("POST", "/v1/doorbell/inspect", { ref: s.ref, frame, mode: "delivery" });
const r = insp.result;
for (const c of r.candidates ?? []) console.log(`   candidate ${c.name} $${c.priceUsd}: ${c.allowed ? "allowed" : `REFUSED (${c.reason})`}`);
console.log(`   paid: ${r.inspectorName} · provider ${r.provider} · serial read "${r.serialRead}" → ${r.outcome}`);
if (r.payment?.hashscan) { links.push(["Hedera x402 inspection payment (HTS USDC)", r.payment.hashscan]); console.log(`   Hedera x402 payment: ${r.payment.hashscan}`); }
if (r.paymentLog) links.push(["HCS log: agent.payment", hashscanTopic(r.paymentLog.topicId)]);
tx(`settle (${r.outcome})`, insp.txHash);
await sleep(3000);
console.log(`   courier +${((await bal(courier)) - c0).toFixed(2)} USDT · seller +${((await bal(seller)) - s0).toFixed(2)} USDT · buyer gas balance ${await pub.getBalance({ address: buyer.address })}`);

console.log("\nREADME links:");
for (const [k, v] of links) console.log(`| ${k} | ${v} |`);
process.exit(0);
