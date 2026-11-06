/**
 * World ID Agent Pass on testnet: a damaged parcel's partial refund that the household agent may only settle
 * after the household owner approves with a fresh World ID check (auth.world.org device flow).
 *   buyer pays → dispatch → handover → inspection says "damaged" → agent pauses →
 *   (denied path: owner declines, nothing happens) → owner approves → backend validates → agent settles.
 * With WORLD_CLIENT_ID/SECRET set, the approval runs against the real World IdP: scan the printed link/code in
 * World App. Without them it uses the mock household owner.
 * Run with the stack up:  pnpm dev:testnet --no-ui   then   npx tsx scripts/testnet/live-agentpass-refund.ts
 * SIMULATE=1 uses the labelled demo fallback instead of World App (no World ID proof). API=<url> targets a hosted backend.
 */
import { readFileSync } from "node:fs";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { explorerTx } from "@openbox/shared";
import { chainReader, openboxClient } from "../lib/openbox-client";

const imgPath = process.argv[2] ?? "scripts/testnet/fixtures/label-aurora-damaged.png";
const serial = "SN-AX1-7731-0042";
const { api, waitReq, checkout } = openboxClient();
const links: [string, string][] = [];
const tx = (label: string, h?: string) => { if (!h) return; const u = explorerTx(1874, h); links.push([label, u]); console.log(`   ${label}: ${u}`); };

const cfg = await api("GET", "/v1/config");
if (cfg.chainId !== 1874) throw new Error(`backend is on chain ${cfg.chainId}, expected 1874`);
const { bal } = chainReader(cfg.rpcUrl, cfg.token.address as Address);
const live = cfg.agentPassMode === "agentpass";
console.log(`\nOpenBox LIVE · World ID Agent Pass checkpoint (${cfg.agentPassMode}) · couriers via ${cfg.worldMode}\n`);

const buyer = privateKeyToAccount(generatePrivateKey());
const courier = privateKeyToAccount(generatePrivateKey()).address;
const courierCheck = async (id: string, uri: string) => {
  if (cfg.worldMode === "mock") await api("POST", "/v1/world/mock/complete", { requestId: id, persona: "alice", decision: "approve" });
  else console.log(`   >>> Courier: open in World App: ${uri}`);
};

console.log("1) Buyer pays, courier dispatched and verified at the door");
tx("demo top-up", (await api("POST", "/v1/demo/fund", { address: buyer.address })).txHash);
const s = await checkout(buyer, "aurora-x1");
tx(`official USDT payment (${s.ref})`, s.payTx);
await api("POST", `/v1/merchant/orders/${s.ref}/pack`, { serial }, true);
const dreq = await api("POST", `/v1/merchant/orders/${s.ref}/dispatch`, { courierName: "Alice", payout: courier }, true);
await courierCheck(dreq.id, dreq.verificationUri);
const d = await waitReq(dreq.id, ["dispatched", "failed", "denied", "expired"], 300000, 1000);
if (d.status !== "dispatched") throw new Error(`dispatch ${d.status}: ${d.reason}`);
const qr = (await api("GET", `/v1/merchant/orders/${s.ref}`, undefined, true)).qr as string;
const h = await api("POST", "/v1/doorbell/handover", { qr });
if (!h.ok) throw new Error(`handover refused: ${h.reason}`);
await courierCheck(h.request.id, h.request.verificationUri);
const hv = await waitReq(h.request.id, ["handed_over", "wrong_courier", "denied", "failed", "expired"], 300000, 1000);
if (hv.status !== "handed_over") throw new Error(`handover ${hv.status}: ${hv.reason}`);
tx("handover", hv.txHash);

console.log("2) Box opened on camera → inspection");
const insp = await api("POST", "/v1/doorbell/inspect", { ref: s.ref, frame: `data:image/png;base64,${readFileSync(imgPath).toString("base64")}`, mode: "delivery" });
console.log(`   verdict: ${insp.result.outcome} · refund ${insp.result.refundBps / 100}% → ${insp.action}`);
if (insp.action !== "awaiting_buyer") throw new Error("expected a damaged verdict awaiting the buyer");

const b0 = await bal(buyer.address);
console.log("3) Buyer asks the agent to accept the partial refund → agent pauses for World ID Agent Pass");
if (!live) {
  const deny = (await api("POST", `/v1/orders/${s.ref}/accept-partial-refund`)).approval;
  console.log(`   approval ${deny.id}: ${deny.status}`);
  await api("POST", "/v1/world/mock/complete", { requestId: deny.id, persona: "owner", decision: "deny" });
  const dn = await waitReq(deny.id, ["denied", "refunded", "failed"], 30000, 500);
  console.log(`   denied path: ${dn.status} · buyer balance change ${((await bal(buyer.address)) - b0).toFixed(2)} USDT (agent did nothing)`);
}
const ap = (await api("POST", `/v1/orders/${s.ref}/accept-partial-refund`)).approval;
if (live && process.env.SIMULATE === "1") {
  // Demo-only fallback for reviewers without World App: settles WITHOUT a World ID proof and is labelled as simulated.
  console.log(`   SIMULATE=1: simulated owner approval (demo fallback, no World ID proof)`);
  await api("POST", `/v1/world/requests/${ap.id}/simulate-approval`, {});
} else if (live) {
  console.log(`   >>> Household owner: approve in World App\n       link: ${ap.verificationUri}\n       code: ${ap.userCode}`);
} else {
  await api("POST", "/v1/world/mock/complete", { requestId: ap.id, persona: "owner", decision: "approve" });
}
const done = await waitReq(ap.id, ["refunded", "denied", "expired", "cancelled", "failed", "wrong_person"], 1150000, 1500);
console.log(`   approval: ${done.status}${done.reason ? ` (${done.reason})` : ""}`);
for (const t of done.timeline ?? []) console.log(`     · ${t.status}${t.note ? `: ${t.note}` : ""}`);
if (done.status !== "refunded") throw new Error("no refund settled");
tx(process.env.SIMULATE === "1" ? "settle (damaged, partial refund, simulated approval: no World ID proof)" : "settle (damaged, partial refund approved with World ID)", done.txHash);
console.log(`   buyer +${((await bal(buyer.address)) - b0).toFixed(2)} USDT`);

console.log("\nREADME links:");
for (const [k, v] of links) console.log(`| ${k} | ${v} |`);
process.exit(0);
