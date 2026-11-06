import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type { Address } from "viem";
import { cfg } from "./config";
import { db, getOrderByRef, now } from "./db";
import { accounts, deployment } from "./chain";
import { bus, type BusEvent } from "./bus";
import { relay, relayerStatus, RelayError } from "./relayer";
import { indexNow, startIndexer } from "./indexer";
import { startWebhookWorker } from "./webhooks";
import { createSession, merchantByPk, merchantBySk, merchantById, pay, prepare, sessionView, type Merchant } from "./checkout";
import { demoFund, depositRefundPool, exportCsv, FINANCE_EVENTS, merchantOrders, orderView, pack, refundPool, scan, tokenInfo, usdtBalance } from "./ops";
import { createOffer, financingView, fundOffer, lenderAddress, marketplace, merchantFinanceStats } from "./finance";
import { cancelRequest, checkpointVerifier, createRequest, getRequest, publicView, simulateApproval, startWorldPoller, verifier, verifierFor } from "./world/service";
import { mockComplete, PERSONAS } from "./world/mock";
import { discoverInspectors, inspect, lastFrame, startKeeper, topics } from "./agent/household";
import { policySummary } from "./agent/policy";
import { PolicyRefusal } from "./agent/x402";
import { householdApprovals, householdOverview } from "./household";

// ---- seed demo merchant + catalog ------------------------------------------------------
function seed() {
  const sk = process.env.MERCHANT_SECRET_KEY ?? "sk_demo_openbox";
  const pk = process.env.MERCHANT_PUBLISHABLE_KEY ?? "pk_demo_openbox";
  db.prepare(
    `INSERT INTO merchants (id, name, seller, publishable_key, secret_key, webhook_url, webhook_secret) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET seller = excluded.seller, publishable_key = excluded.publishable_key, secret_key = excluded.secret_key,
       webhook_url = COALESCE(merchants.webhook_url, excluded.webhook_url)`,
  ).run("m_demo", "Northwind Gadgets", accounts.seller.address, pk, sk,
    process.env.DEMO_STORE_WEBHOOK_URL ?? "http://localhost:5174/webhooks/openbox",
    process.env.DEMO_STORE_WEBHOOK_SECRET ?? "whsec_demo_openbox");
  const products = [
    ["aurora-x1", "Aurora X1 Smartphone", 120_000000, 4_000000, "SN-AX1-7731-0042"],
    ["pixelbuds", "PixelBuds Pro", 40_000000, 2_000000, "SN-PBP-5520-0007"],
    ["lumen-tab", "Lumen Tab 11", 90_000000, 3_000000, "SN-LT11-3304-0019"],
  ] as const;
  // CATALOG_DIVISOR shrinks demo prices on testnet (official test USDT is scarce): 20 → 6 / 2 / 4.5 USDT.
  const div = Math.max(1, Number(process.env.CATALOG_DIVISOR ?? 1));
  for (const [sku, name, amount, fee, serial] of products)
    db.prepare(`INSERT INTO products (merchant_id, sku, name, amount, courier_fee, serial) VALUES (?,?,?,?,?,?)
      ON CONFLICT(merchant_id, sku) DO UPDATE SET amount = excluded.amount, courier_fee = excluded.courier_fee`)
      .run("m_demo", sku, name, String(Math.round(amount / div)), String(Math.round(fee / div)), serial);
}
seed();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 12 * 1024 * 1024, trustProxy: true });
await app.register(cors, { origin: true });

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof z.ZodError) return reply.code(400).send({ error: "bad_request", issues: err.issues });
  if (err instanceof RelayError) return reply.code(err.code === "rate_limited" ? 429 : 422).send({ error: err.code, message: err.message });
  if (err instanceof PolicyRefusal) return reply.code(402).send({ error: "agent_policy", message: err.message });
  app.log.warn(err);
  return reply.code(err.statusCode ?? 400).send({ error: "failed", message: err.message });
});

/** Demo lender desk: a bearer key held by the web app's server-side proxy (like the merchant secret key). */
const lenderAuth = (req: FastifyRequest) => {
  const h = req.headers.authorization ?? "";
  if (h !== `Bearer ${cfg.finance.lenderApiKey}`) throw Object.assign(new Error("invalid lender key"), { statusCode: 401 });
};

const merchantAuth = (req: FastifyRequest): Merchant => {
  const h = req.headers.authorization ?? "";
  const m = h.startsWith("Bearer ") ? merchantBySk(h.slice(7)) : undefined;
  if (!m) throw Object.assign(new Error("invalid merchant secret key"), { statusCode: 401 });
  return m;
};

// ---- public config ---------------------------------------------------------------------
app.get("/health", async () => ({ ok: true }));
app.get("/v1/config", async () => ({
  chainId: cfg.chainId, rpcUrl: cfg.rpcUrl, explorer: cfg.explorer, deliveryCheckout: deployment.deliveryCheckout,
  accountFactory: deployment.accountFactory, token: await tokenInfo(), gaslessMode: cfg.gaslessMode, demoMode: cfg.demoMode,
  worldMode: verifier.kind, agentPassMode: checkpointVerifier.kind, simulatedApproval: cfg.demoMode, hederaMode: cfg.agent.hederaMode, inspectionWindowS: Number(cfg.windows.inspection),
  receivableNote: deployment.receivableNote ?? null,
}));

// ---- checkout (SDK) --------------------------------------------------------------------
app.get("/v1/catalog/:pk", async (req) => {
  const m = merchantByPk((req.params as { pk: string }).pk);
  if (!m) throw new Error("unknown publishable key");
  return { merchant: m.name, products: db.prepare("SELECT sku, name, amount, courier_fee AS courierFee FROM products WHERE merchant_id = ?").all(m.id) };
});

app.post("/v1/checkout/sessions", async (req) => {
  const b = z.object({ publishableKey: z.string(), sku: z.string() }).parse(req.body);
  const m = merchantByPk(b.publishableKey);
  if (!m) throw new Error("unknown publishable key");
  return createSession(m, b.sku);
});
app.get("/v1/checkout/sessions/:ref", async (req) => {
  const o = getOrderByRef((req.params as { ref: string }).ref);
  if (!o) throw Object.assign(new Error("not found"), { statusCode: 404 });
  return sessionView(o);
});
app.post("/v1/checkout/sessions/:ref/prepare", async (req) => {
  const b = z.object({ buyer: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).parse(req.body);
  return prepare((req.params as { ref: string }).ref, b.buyer as Address);
});
app.post("/v1/checkout/sessions/:ref/pay", async (req) => {
  const b = z.object({ buyer: z.string(), signatures: z.record(z.string().regex(/^0x[0-9a-fA-F]+$/)) }).parse(req.body);
  return pay((req.params as { ref: string }).ref, b.buyer as Address, b.signatures as Record<string, `0x${string}`>, req.ip);
});

// ---- buyer -----------------------------------------------------------------------------
app.get("/v1/orders/:ref", async (req) => {
  const o = getOrderByRef((req.params as { ref: string }).ref);
  if (!o) throw Object.assign(new Error("not found"), { statusCode: 404 });
  const { qr: _qr, ...view } = orderView(o);
  return { ...view, receipts: view.receipts.filter((r) => !FINANCE_EVENTS.has(r.event)) }; // seller financing is private
});
/**
 * Buyer asks the household agent to accept a damaged parcel's partial refund. The agent does not act yet:
 * it opens a World ID Agent Pass checkpoint, and settles only after the household owner's approval validates.
 */
app.post("/v1/orders/:ref/accept-partial-refund", async (req) => {
  const ref = (req.params as { ref: string }).ref;
  const o = getOrderByRef(ref);
  if (!o?.pending_verdict_json) throw Object.assign(new Error("No partial refund is waiting for approval."), { statusCode: 409 });
  const open = db.prepare("SELECT id FROM world_requests WHERE purpose = 'approve_refund' AND order_ref = ? AND status IN ('creating','pending','validating','verified') ORDER BY started_at DESC LIMIT 1").get(ref) as { id: string } | undefined;
  const approval = open ? publicView(getRequest(open.id)!) : await createRequest("approve_refund", { orderRef: ref });
  return { approval };
});
app.post("/v1/orders/:ref/cancel-undelivered", async (req) => {
  const o = getOrderByRef((req.params as { ref: string }).ref);
  if (!o) throw new Error("unknown order");
  const r = await relay({ target: "checkout", functionName: "cancelUndelivered", args: [o.order_id] });
  await indexNow();
  return r;
});

// ---- live events (SSE) -----------------------------------------------------------------
app.get("/v1/events", (req: FastifyRequest, reply: FastifyReply) => {
  const ref = (req.query as { ref?: string }).ref;
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive",
    "access-control-allow-origin": (req.headers.origin as string) ?? "*",
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  const on = (e: BusEvent) => {
    if (ref && e.ref && e.ref !== ref) return;
    res.write(`event: ob\ndata: ${JSON.stringify(e)}\n\n`);
  };
  bus.on("event", on);
  const ping = setInterval(() => res.write(`: ping\n\n`), 15000);
  req.raw.on("close", () => { bus.off("event", on); clearInterval(ping); });
});

// ---- doorbell ----------------------------------------------------------------------------
app.post("/v1/doorbell/scan", async (req) => scan(z.object({ qr: z.string() }).parse(req.body).qr));

app.post("/v1/doorbell/handover", async (req) => {
  const { qr } = z.object({ qr: z.string() }).parse(req.body);
  const s = await scan(qr);
  if (!s.ok) return { ok: false, reason: s.reason, ref: "ref" in s ? s.ref : undefined };
  const request = await createRequest("handover", { orderRef: s.ref, labelHash: s.labelHash });
  return { ok: true, scan: s, request };
});

app.post("/v1/doorbell/inspect", async (req) => {
  const b = z.object({
    ref: z.string(), frame: z.string().optional(), mode: z.enum(["delivery", "return"]).default("delivery"),
    useLastFrame: z.boolean().optional(),
  }).parse(req.body);
  if (!b.frame && !b.useLastFrame) throw new Error("frame required");
  if (b.useLastFrame && !lastFrame(b.ref)) throw new Error("no previous frame for this order");
  return inspect(b.ref, b.frame, b.mode);
});

// ---- World ---------------------------------------------------------------------------------
app.get("/v1/world/requests/:id", async (req) => {
  const r = getRequest((req.params as { id: string }).id);
  if (!r) throw Object.assign(new Error("not found"), { statusCode: 404 });
  return publicView(r);
});
app.post("/v1/world/requests/:id/cancel", async (req) => cancelRequest((req.params as { id: string }).id));
app.get("/v1/world/mock/personas", async () => ({ enabled: verifier.kind === "mock", personas: PERSONAS }));
app.post("/v1/world/mock/complete", async (req) => {
  const b = z.object({ requestId: z.string(), persona: z.string(), decision: z.enum(["approve", "deny"]) }).parse(req.body);
  const r = getRequest(b.requestId);
  if (!r || verifierFor(r.purpose).kind !== "mock") throw new Error("mock disabled");
  if (!r || r.status !== "pending") throw new Error(`request is ${r?.status ?? "missing"}`);
  mockComplete(b.requestId, b.persona, b.decision);
  return { ok: true };
});
// Demo-only: finish a partial-refund approval without World App (labelled as simulated; see simulateApproval).
app.post("/v1/world/requests/:id/simulate-approval", async (req) =>
  simulateApproval((req.params as { id: string }).id));


// ---- household agent -----------------------------------------------------------------------
app.get("/v1/agent/status", async () => {
  const inspectors = await discoverInspectors().catch((e) => ({ error: (e as Error).message }));
  const payments = db.prepare("SELECT * FROM agent_payments ORDER BY id DESC LIMIT 20").all();
  return { policy: policySummary(), inspectors, payments, topics: { inspectors: topics.inspectors.id, log: topics.log.id, live: topics.log.live } };
});
app.get("/v1/hcs/log", async () => {
  const msgs = await topics.log.read();
  return { topicId: topics.log.id, live: topics.log.live, messages: msgs.slice(-50).reverse() };
});

// ---- household app (read-only; see household.ts for the demo's one-household simplification) ------
app.get("/v1/household/overview", async () => householdOverview());
app.get("/v1/household/approvals", async () => householdApprovals());

// ---- merchant ------------------------------------------------------------------------------
app.get("/v1/merchant/orders", async (req) => merchantOrders(merchantAuth(req)));
app.get("/v1/merchant/orders/:ref", async (req) => {
  const m = merchantAuth(req);
  const o = getOrderByRef((req.params as { ref: string }).ref);
  if (!o || o.merchant_id !== m.id) throw Object.assign(new Error("not found"), { statusCode: 404 });
  return orderView(o);
});
app.post("/v1/merchant/orders/:ref/pack", async (req) => {
  const m = merchantAuth(req);
  const b = z.object({ serial: z.string().min(3) }).parse(req.body);
  return pack(m, (req.params as { ref: string }).ref, b.serial);
});
/** Assign a courier: starts a World check on the courier's phone; on success the courier is bound on-chain. */
app.post("/v1/merchant/orders/:ref/dispatch", async (req) => {
  const m = merchantAuth(req);
  const ref = (req.params as { ref: string }).ref;
  const o = getOrderByRef(ref);
  if (!o || o.merchant_id !== m.id) throw Object.assign(new Error("not found"), { statusCode: 404 });
  if (o.status !== "packed") throw new Error(`order is ${o.status}; pack it first`);
  const b = z.object({ courierName: z.string().min(1), payout: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).parse(req.body);
  return createRequest("dispatch", { orderRef: ref, courierName: b.courierName, courierPayout: b.payout as Address });
});
/** Tracked return after a mismatch: the seller confirms the parcel came back with the courier. */
app.post("/v1/merchant/orders/:ref/return-received", async (req) => {
  const m = merchantAuth(req);
  const ref = (req.params as { ref: string }).ref;
  const o = getOrderByRef(ref);
  if (!o || o.merchant_id !== m.id) throw Object.assign(new Error("not found"), { statusCode: 404 });
  if (o.status !== "returning") throw new Error(`order is ${o.status}, not returning`);
  db.prepare("UPDATE orders SET status = 'returned_to_seller', updated_at = ? WHERE ref = ?").run(now(), ref);
  return { ok: true };
});
/** Invoice advance for one order: quote, eligibility, current offer and note state. */
app.get("/v1/merchant/orders/:ref/financing", async (req) => {
  const m = merchantAuth(req);
  const o = getOrderByRef((req.params as { ref: string }).ref);
  if (!o || o.merchant_id !== m.id) throw Object.assign(new Error("not found"), { statusCode: 404 });
  return financingView(o);
});
/** Seller requests an advance: signs FinanceOffer + LockPayout with the seller key and lists the offer for lenders. */
app.post("/v1/merchant/orders/:ref/financing", async (req) => createOffer(merchantAuth(req), (req.params as { ref: string }).ref));

// ---- lender (invoice marketplace) --------------------------------------------------------
app.get("/v1/lender/marketplace", async (req) => { lenderAuth(req); return marketplace(); });
/** Demo lender funds an open offer from DEMO_LENDER_PK (approve if needed, then ReceivableNote.finance). */
app.post("/v1/lender/offers/:id/fund", async (req) => {
  lenderAuth(req);
  const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  return fundOffer(id);
});

app.get("/v1/merchant/export.csv", async (req, reply) => {
  const m = merchantAuth(req);
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="openbox-${m.id}-${new Date().toISOString().slice(0, 10)}.csv"`);
  return exportCsv(m);
});
app.get("/v1/merchant/stats", async (req) => {
  const m = merchantAuth(req);
  const totals = db.prepare(
    `SELECT COUNT(*) AS orders, SUM(CASE WHEN status IN ('settled','returned') THEN 1 ELSE 0 END) AS settled,
            SUM(CAST(seller_paid AS INTEGER)) AS sellerPaid, SUM(CAST(buyer_refunded AS INTEGER)) AS refunded,
            SUM(CAST(courier_paid AS INTEGER)) AS courierPaid
     FROM orders WHERE merchant_id = ? AND status != 'created'`,
  ).get(m.id);
  const financing = merchantFinanceStats(m.id);
  const { toNoteRaw, receivedRaw, ...fin } = financing;
  const tot = totals as { sellerPaid: number | null };
  // "Paid out to you": payouts routed to a note repaid the lender; the seller got the advance and bond instead.
  tot.sellerPaid = Number(BigInt(tot.sellerPaid ?? 0) - toNoteRaw + receivedRaw);
  const webhooks = db.prepare("SELECT event, status, attempts, delivered_at FROM webhook_deliveries WHERE merchant_id = ? ORDER BY id DESC LIMIT 15").all(m.id);
  return {
    merchant: { id: m.id, name: m.name, seller: m.seller, webhookUrl: m.webhook_url },
    totals, refundPool: await refundPool(m), relayer: await relayerStatus(), agent: policySummary(), webhooks,
    sellerBalance: await usdtBalance(m.seller),
    financing: fin,
  };
});
app.post("/v1/merchant/refund-pool", async (req) => {
  const m = merchantAuth(req);
  return depositRefundPool(m, z.object({ amount: z.number().positive() }).parse(req.body).amount);
});
app.put("/v1/merchant/webhook", async (req) => {
  const m = merchantAuth(req);
  const { url } = z.object({ url: z.string().url() }).parse(req.body);
  db.prepare("UPDATE merchants SET webhook_url = ? WHERE id = ?").run(url, m.id);
  return merchantById(m.id);
});

// ---- demo helpers ----------------------------------------------------------------------------
app.post("/v1/demo/fund", async (req) => {
  const b = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), amount: z.number().int().positive().max(500).optional() }).parse(req.body);
  return demoFund(b.address as Address, b.amount);
});
/** Live balance strip for the demo: the parties of the latest (or given) order. */
app.get("/v1/demo/balances", async (req) => {
  const ref = (req.query as { ref?: string }).ref;
  const o = (ref ? getOrderByRef(ref) : db.prepare("SELECT * FROM orders WHERE buyer IS NOT NULL ORDER BY created_at DESC LIMIT 1").get()) as ReturnType<typeof getOrderByRef>;
  const parties: { role: string; address: string | null | undefined }[] = [
    { role: "buyer", address: o?.buyer },
    // Before dispatch the latest order has no courier yet: show the most recent courier's wallet so the slot isn't blank.
    { role: "courier", address: o?.courier_payout ?? (db.prepare("SELECT courier_payout FROM orders WHERE courier_payout IS NOT NULL ORDER BY created_at DESC LIMIT 1").get() as { courier_payout?: string } | undefined)?.courier_payout },
    { role: "seller", address: accounts.seller.address },
    { role: "lender", address: lenderAddress() },
  ];
  const out = [];
  for (const p of parties) out.push({ ...p, usdt: p.address ? await usdtBalance(p.address as Address) : null });
  return { ref: o?.ref ?? null, parties: out, relayer: await relayerStatus() };
});
app.get("/v1/balance/:address", async (req) => ({ usdt: await usdtBalance((req.params as { address: Address }).address), at: now() }));

startIndexer();
startWebhookWorker();
startWorldPoller();
startKeeper();
await app.listen({ port: cfg.port, host: "0.0.0.0" });
app.log.info(`OpenBox backend on ${cfg.publicUrl} (chain ${cfg.chainId}, gasless=${cfg.gaslessMode}, world=${verifier.kind}, hedera=${cfg.agent.hederaMode})`);
