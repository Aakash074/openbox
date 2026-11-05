import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import {
  createHederaClient, createHederaPreflightTransfer, createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature, toFacilitatorHederaSigner,
} from "@x402/hedera";
import { parseKey } from "@openbox/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";

/**
 * OpenBox fallback x402 facilitator for Hedera ("or your own" in the track rules). Use a listed facilitator
 * (Blocky402 / official x402 / Ax402) when reachable; run this when they are not.
 *
 *  FACILITATOR_MODE=live  real verify + settle on Hedera testnet using @x402/hedera's facilitator scheme
 *                         (payer-signature check against the mirror node, balance/association preflight,
 *                         fee payer never a net sender, exact amount to payTo, replay protection).
 *  FACILITATOR_MODE=mock  offline: accepts the household agent's mock payloads, with the same amount/payTo/replay
 *                         checks, and returns placeholder transaction ids. Never touches a network.
 */
loadEnv({ path: resolve(fileURLToPath(import.meta.url), "../../../..", process.env.OPENBOX_ENV_FILE ?? ".env") });

const mode = (process.env.FACILITATOR_MODE ?? "mock") as "mock" | "live";
const port = Number(process.env.FACILITATOR_PORT ?? 4200);
const network = process.env.HEDERA_NETWORK ?? "hedera:testnet";
const app = express();
app.use(express.json({ limit: "1mb" }));

type Body = { x402Version: number; paymentPayload: any; paymentRequirements: any };

if (mode === "live") {
  const feePayer = process.env.HEDERA_FACILITATOR_ACCOUNT_ID;
  const key = process.env.HEDERA_FACILITATOR_PRIVATE_KEY;
  if (!feePayer || !key) throw new Error("HEDERA_FACILITATOR_ACCOUNT_ID / HEDERA_FACILITATOR_PRIVATE_KEY required");
  const signer = toFacilitatorHederaSigner({
    getAddresses: () => [feePayer],
    signAndSubmitTransaction: createHederaSignAndSubmitTransaction((n) => createHederaClient(n), parseKey(key)),
    verifyPayerSignature: createHederaVerifyPayerSignature(),
    preflightTransfer: createHederaPreflightTransfer(),
  });
  const facilitator = new x402Facilitator().register(network as `${string}:${string}`, new ExactHederaScheme(signer, { aliasPolicy: "reject" }));

  app.get("/supported", (_req, res) => res.json(facilitator.getSupported()));
  app.post("/verify", async (req, res) => {
    const b = req.body as Body;
    res.json(await facilitator.verify(b.paymentPayload, b.paymentRequirements));
  });
  app.post("/settle", async (req, res) => {
    const b = req.body as Body;
    const r = await facilitator.settle(b.paymentPayload, b.paymentRequirements);
    console.log(`[facilitator] settle ${r.success ? "OK" : "FAIL"} ${r.transaction ?? r.errorReason}`);
    res.json(r);
  });
} else {
  const feePayer = process.env.HEDERA_FACILITATOR_ACCOUNT_ID ?? "0.0.9999";
  const seen = new Set<string>();
  const decode = (p: any) => {
    const tx = p?.payload?.transaction;
    const j = JSON.parse(Buffer.from(String(tx), "base64").toString("utf8"));
    if (!j.mock) throw new Error("not a mock payload");
    return j as { from: string; to: string; amount: string; asset: string; nonce: string };
  };
  const check = (b: Body) => {
    const t = decode(b.paymentPayload);
    const r = b.paymentRequirements;
    if (t.to !== r.payTo) return { ok: false as const, reason: "invalid_exact_hedera_payload_recipient", t };
    if (t.amount !== r.amount) return { ok: false as const, reason: "invalid_exact_hedera_payload_amount", t };
    if (t.asset !== r.asset) return { ok: false as const, reason: "invalid_exact_hedera_payload_asset", t };
    if (seen.has(t.nonce)) return { ok: false as const, reason: "invalid_exact_hedera_payload_replay", t };
    return { ok: true as const, t };
  };
  app.get("/supported", (_req, res) =>
    res.json({ kinds: [{ x402Version: 2, scheme: "exact", network, extra: { feePayer } }], extensions: [], signers: { [network]: [feePayer] } }),
  );
  app.post("/verify", (req, res) => {
    try {
      const c = check(req.body);
      res.json(c.ok ? { isValid: true, payer: c.t.from } : { isValid: false, invalidReason: c.reason, payer: c.t.from });
    } catch (e) {
      res.json({ isValid: false, invalidReason: "invalid_payload", invalidMessage: (e as Error).message });
    }
  });
  app.post("/settle", (req, res) => {
    try {
      const c = check(req.body);
      if (!c.ok) return res.json({ success: false, errorReason: c.reason, transaction: "", network });
      seen.add(c.t.nonce);
      const t = Date.now();
      const transaction = `${feePayer}@${Math.floor(t / 1000)}.${String(t % 1000).padStart(3, "0")}000000-mock`;
      console.log(`[facilitator:mock] settled ${c.t.amount} ${c.t.asset} ${c.t.from} -> ${c.t.to} (${transaction})`);
      res.json({ success: true, payer: c.t.from, transaction, network, amount: c.t.amount });
    } catch (e) {
      res.json({ success: false, errorReason: "invalid_payload", errorMessage: (e as Error).message, transaction: "", network });
    }
  });
}

app.get("/health", (_req, res) => res.json({ ok: true, mode }));
app.listen(port, () => console.log(`[facilitator] ${mode} mode on :${port} (${network})`));
