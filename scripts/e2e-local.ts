/**
 * End-to-end test against the local stack (run `pnpm dev:local --fresh --no-ui` first, or `pnpm e2e:local --start`).
 * Drives every flow through the public HTTP API exactly as the UIs do, and asserts on-chain balances.
 *
 *   A  soap          -> mismatch: buyer refunded, courier still paid, tracked return
 *   B  matching      -> match: one settle pays courier + seller; later a serial-checked return from the refund pool
 *   C  cracked       -> damaged: buyer one-tap 15% partial refund
 *   D  denied paths  -> reused QR, wrong person (Mallory), declined, cancelled => no transfer
 *   T  timeout       -> no inspection in window: courier + seller paid by the agent's keeper
 *   + agent picks the cheaper inspector from the HCS directory and refuses the over-budget one
 *   + webhooks arrive HMAC-signed; CSV rows match on-chain money events
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { chainReader, openboxClient, sleep } from "./lib/openbox-client";

const API = process.env.API ?? "http://localhost:4000";
const { api, waitReq, checkout: buy, secretKey: SK } = openboxClient({ api: API });
const WH_SECRET = process.env.DEMO_STORE_WEBHOOK_SECRET ?? "whsec_demo_openbox";
const SKIP_TIMEOUT = process.argv.includes("--skip-timeout");

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "  \x1b[32m✔\x1b[0m" : "  \x1b[31m✘\x1b[0m"} ${msg}`);
  if (!cond) failures++;
};

// ---- webhook receiver (plays the demo store) --------------------------------------------
const hooks: { type: string; data: any; valid: boolean }[] = [];
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const sig = String(req.headers["x-openbox-signature"] ?? "");
    const t = /t=(\d+)/.exec(sig)?.[1];
    const v1 = /v1=([0-9a-f]+)/.exec(sig)?.[1];
    const expect = createHmac("sha256", WH_SECRET).update(`${t}.${body}`).digest("hex");
    const evt = JSON.parse(body);
    hooks.push({ type: evt.type, data: evt.data, valid: v1 === expect });
    res.writeHead(200).end("ok");
  });
}).listen(5174);

async function main() {
  if (process.argv.includes("--start")) {
    spawn("node", ["scripts/dev-local.mjs", "--fresh", "--no-ui"], { stdio: "inherit", detached: false });
    for (let i = 0; i < 120; i++) { try { await fetch(`${API}/health`); break; } catch { await sleep(1000); } }
  }
  const cfg = await api("GET", "/v1/config");
  const { pub, bal } = chainReader(cfg.rpcUrl, cfg.token.address as Address);
  console.log(`\nOpenBox e2e · chain ${cfg.chainId} · gasless=${cfg.gaslessMode} · world=${cfg.worldMode} · hedera=${cfg.hederaMode}\n`);

  const buyer = privateKeyToAccount(generatePrivateKey());
  const courier = privateKeyToAccount(generatePrivateKey()).address;
  const stats = await api("GET", "/v1/merchant/stats", undefined, true);
  const seller = stats.merchant.seller as Address;
  await api("POST", "/v1/demo/fund", { address: buyer.address, amount: 500 });
  ok((await bal(buyer.address)) === 500, "buyer funded with 500 USDT (local mock token)");
  const ethBefore = await pub.getBalance({ address: buyer.address });

  // -------------------------------------------------------------------------- helpers
  const checkout = (sku = "aurora-x1") => buy(buyer, sku);
  async function dispatch(ref: string, serial: string) {
    await api("POST", `/v1/merchant/orders/${ref}/pack`, { serial }, true);
    const req = await api("POST", `/v1/merchant/orders/${ref}/dispatch`, { courierName: "Alice", payout: courier }, true);
    await api("POST", "/v1/world/mock/complete", { requestId: req.id, persona: "alice", decision: "approve" });
    const done = await waitReq(req.id, ["dispatched", "failed"]);
    if (done.status !== "dispatched") throw new Error(`dispatch failed: ${done.reason}`);
    return (await api("GET", `/v1/merchant/orders/${ref}`, undefined, true)).qr as string;
  }
  async function doorHandover(qr: string, persona = "alice", decision: "approve" | "deny" = "approve") {
    const h = await api("POST", "/v1/doorbell/handover", { qr });
    if (!h.ok) return { denied: h.reason as string };
    await api("POST", "/v1/world/mock/complete", { requestId: h.request.id, persona, decision });
    return await waitReq(h.request.id, ["handed_over", "wrong_courier", "denied", "failed"]);
  }
  const frame = (o: object) => Buffer.from(`MOCK:${JSON.stringify(o)}`).toString("base64");

  // -------------------------------------------------------------------------- A: soap
  console.log("Parcel A: phone ordered, soap inside");
  const A = await checkout();
  ok((await api("GET", `/v1/orders/${A.ref}`)).status === "paid", `A paid gaslessly (${A.payTx.slice(0, 10)}…)`);
  const qrA = await dispatch(A.ref, "SN-AX1-7731-1001");
  ok((await api("GET", `/v1/orders/${A.ref}`)).status === "dispatched", "A dispatched: courier World ID bound on-chain");
  const hA = await doorHandover(qrA);
  ok(hA.status === "handed_over", "A handed over after the same courier passed the World check at the door");
  ok((await bal(courier)) === 0, "handover alone pays nothing");
  const b0 = await bal(buyer.address);
  const inspA = await api("POST", "/v1/doorbell/inspect", { ref: A.ref, frame: frame({ item: "bar of soap" }), mode: "delivery" });
  ok(inspA.result.outcome === "mismatch", "inspector verdict: mismatch");
  ok(inspA.result.inspectorName?.includes("budget"), `agent paid the cheaper inspector (${inspA.result.inspectorName})`);
  const refused = (inspA.result.candidates ?? []).find((c: any) => !c.allowed);
  ok(refused && /exceeds|threshold|budget/.test(refused.reason), `agent refused the over-budget inspector: ${refused?.reason}`);
  ok((await bal(buyer.address)) - b0 === A.amount - A.fee, `buyer refunded ${A.amount - A.fee} USDT`);
  ok((await bal(courier)) === A.fee, `courier still paid ${A.fee} USDT for an honest delivery`);
  ok((await api("GET", `/v1/orders/${A.ref}`)).status === "returning", "A is a tracked return with the courier");
  await api("POST", `/v1/merchant/orders/${A.ref}/return-received`, {}, true);

  // -------------------------------------------------------------------------- B: match
  console.log("Parcel B: matching serial");
  const B = await checkout();
  const qrB = await dispatch(B.ref, "SN-AX1-7731-0042");
  await doorHandover(qrB);
  const s0 = await bal(seller), c0 = await bal(courier);
  const inspB = await api("POST", "/v1/doorbell/inspect", { ref: B.ref, frame: frame({ serial: "SN-AX1-7731-0042", item: "Aurora X1 box" }), mode: "delivery" });
  ok(inspB.result.outcome === "match" && inspB.action === "settled", "verdict: match, settled");
  ok((await bal(seller)) - s0 === B.amount - B.fee, `one settle call paid seller ${B.amount - B.fee} USDT…`);
  ok((await bal(courier)) - c0 === B.fee, `…and courier ${B.fee} USDT`);

  // -------------------------------------------------------------------------- D: denied paths
  console.log("Denied paths");
  const reused = await doorHandover(qrB);
  ok("denied" in reused && /already used/i.test(reused.denied), `reused QR refused at the door: "${(reused as any).denied}"`);
  const D = await checkout("pixelbuds");
  const qrD = await dispatch(D.ref, "SN-PBP-5520-0007");
  const cBefore = await bal(courier);
  const wrong = await doorHandover(qrD, "mallory");
  ok(wrong.status === "wrong_courier", "different person (Mallory) at the door: denied, no attestation");
  const declined = await doorHandover(qrD, "alice", "deny");
  ok(declined.status === "denied", "courier declined in World ID: denied");
  const h = await api("POST", "/v1/doorbell/handover", { qr: qrD });
  const cancelled = await api("POST", `/v1/world/requests/${h.request.id}/cancel`);
  ok(cancelled.status === "cancelled", "request cancelled at the door");
  ok((await bal(courier)) === cBefore, "no transfer on any denied path");
  ok((await api("GET", `/v1/orders/${D.ref}`)).status === "dispatched", "order still awaiting a valid handover");

  // -------------------------------------------------------------------------- C: damaged
  console.log("Parcel C: cracked screen");
  const C = await checkout("lumen-tab");
  const qrC = await dispatch(C.ref, "SN-LT11-3304-0019");
  await doorHandover(qrC);
  const inspC = await api("POST", "/v1/doorbell/inspect", { ref: C.ref, frame: frame({ serial: "SN-LT11-3304-0019", damage: "minor", item: "tablet, cracked" }), mode: "delivery" });
  ok(inspC.action === "awaiting_buyer" && inspC.result.refundBps === 1500, "verdict: damaged, 15% partial refund offered");
  const bc = await bal(buyer.address);
  // World ID Agent Pass checkpoint: the agent pauses until the household owner approves.
  const denyReq = (await api("POST", `/v1/orders/${C.ref}/accept-partial-refund`)).approval;
  ok(denyReq.status === "pending", "agent paused for a World ID Agent Pass approval");
  await api("POST", "/v1/world/mock/complete", { requestId: denyReq.id, persona: "owner", decision: "deny" });
  ok((await waitReq(denyReq.id, ["denied", "refunded", "failed"])).status === "denied", "owner declined: the agent did nothing");
  ok((await bal(buyer.address)) === bc, "no refund without approval");
  const okReq = (await api("POST", `/v1/orders/${C.ref}/accept-partial-refund`)).approval;
  await api("POST", "/v1/world/mock/complete", { requestId: okReq.id, persona: "owner", decision: "approve" });
  const approved = await waitReq(okReq.id, ["refunded", "failed", "denied", "wrong_person"], 60000);
  ok(approved.status === "refunded" && !!approved.txHash, "owner approved with World ID: agent settled the partial refund");
  const share = C.amount - C.fee;
  ok(Math.abs((await bal(buyer.address)) - bc - share * 0.15) < 1e-6, `buyer partial refund ${share * 0.15} USDT`);

  // -------------------------------------------------------------------------- returns
  console.log("Return of B (serial-checked, refund pool)");
  await api("POST", "/v1/demo/fund", { address: seller, amount: 300 });
  await api("POST", "/v1/merchant/refund-pool", { amount: 300 }, true);
  const bb = await bal(buyer.address);
  const wrongRet = await api("POST", "/v1/doorbell/inspect", { ref: B.ref, frame: frame({ serial: "SN-FAKE-0000" }), mode: "return" });
  ok(wrongRet.action === "return_rejected", "return with a different serial: rejected");
  const ret = await api("POST", "/v1/doorbell/inspect", { ref: B.ref, frame: frame({ serial: "SN-AX1-7731-0042" }), mode: "return" });
  ok(ret.action === "return_refunded" && (await bal(buyer.address)) - bb === B.amount - B.fee, "matching return refunded from the merchant refund pool");

  // -------------------------------------------------------------------------- timeout
  if (!SKIP_TIMEOUT) {
    console.log(`Timeout: handover, box not opened (waiting ${cfg.inspectionWindowS}s window)…`);
    const T = await checkout("pixelbuds");
    const qrT = await dispatch(T.ref, "SN-PBP-5520-0099");
    await doorHandover(qrT);
    const st0 = await bal(seller), ct0 = await bal(courier);
    const t0 = Date.now();
    while ((await api("GET", `/v1/orders/${T.ref}`)).status !== "settled" && Date.now() - t0 < (cfg.inspectionWindowS + 30) * 1000) await sleep(2000);
    ok((await api("GET", `/v1/orders/${T.ref}`)).outcome === "timeout", "keeper released after the window");
    ok((await bal(seller)) - st0 === T.amount - T.fee && (await bal(courier)) - ct0 === T.fee, "timeout paid courier + seller");
  }

  // -------------------------------------------------------------------------- audit + merchant outputs
  console.log("Audit trail and merchant outputs");
  ok((await pub.getBalance({ address: buyer.address })) === ethBefore && ethBefore === 0n, "buyer never held or spent gas");
  const log = await api("GET", "/v1/hcs/log");
  const types = log.messages.map((m: any) => m.message.type);
  ok(types.includes("agent.payment") && types.includes("agent.refusal") && types.includes("inspection.verdict"), `HCS log has payments, refusals and verdicts (${log.messages.length} msgs, topic ${log.topicId})`);
  await sleep(4000);
  ok(hooks.length > 0 && hooks.every((h) => h.valid), `${hooks.length} webhooks received, all HMAC-valid`);
  for (const t of ["order.paid", "order.dispatched", "order.handed_over", "courier.paid", "order.settled", "seller.paid", "buyer.refunded", "order.return_to_sender", "order.return_refunded"])
    ok(hooks.some((h) => h.type === t), `webhook ${t}`);
  const csv = await (await fetch(`${API}/v1/merchant/export.csv`, { headers: { authorization: `Bearer ${SK}` } })).text();
  const rows = csv.trim().split("\n").slice(1);
  const orders = await api("GET", "/v1/merchant/orders", undefined, true);
  const moneyEvents = orders.flatMap((o: any) => o.receipts).filter((r: any) => ["OrderCreated", "CourierPaid", "SellerPaid", "BuyerRefunded", "ReturnRefunded", "DeliveryCancelled"].includes(r.event));
  ok(rows.length === moneyEvents.length, `CSV has ${rows.length} rows = ${moneyEvents.length} on-chain money events`);
  const relayer = (await api("GET", "/v1/merchant/stats", undefined, true)).relayer;
  ok(BigInt(relayer.spentTodayWei) > 0n, `relayer paid all gas (${relayer.spentTodayWei} wei today, budget ${relayer.dailyBudgetWei})`);

  console.log(failures ? `\n\x1b[31m${failures} check(s) failed\x1b[0m` : "\n\x1b[32mAll checks passed\x1b[0m");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
