/**
 * Gate 4: one HCS message round-trips through the Mirror Node, and one x402 payment settles on Hedera testnet.
 *  1. submits a probe message to HCS_LOG_TOPIC_ID with the SDK, then polls the Mirror Node until it reads back
 *  2. pays an x402 endpoint (default: local inspector discovery doc's /inspect is order-bound, so use
 *     X402_PROBE_URL for any paid GET endpoint) and prints the Hedera tx id + HashScan link
 * Usage: pnpm tsx scripts/hour1/hedera-probe.ts
 */
import "dotenv/config";
import { hashscanTx } from "@openbox/shared";
import { liveTopic, mirrorRead, parseKey } from "@openbox/hedera";
import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";

const network = process.env.HEDERA_NETWORK ?? "hedera:testnet";
const accountId = process.env.HEDERA_AGENT_ACCOUNT_ID!;
const key = process.env.HEDERA_AGENT_PRIVATE_KEY!;
const topicId = process.env.HCS_LOG_TOPIC_ID;
if (!accountId || !key) throw new Error("HEDERA_AGENT_ACCOUNT_ID / HEDERA_AGENT_PRIVATE_KEY required");

if (topicId) {
  const t = liveTopic(topicId, { network, operator: { accountId, privateKey: key } });
  const nonce = crypto.randomUUID();
  const r = await t.submit({ type: "probe", nonce, at: new Date().toISOString() });
  console.log(`HCS submit #${r.sequence} tx ${r.txId}`);
  for (let i = 0; i < 20; i++) {
    const msgs = await mirrorRead<{ nonce?: string }>(topicId, network);
    if (msgs.some((m) => m.message.nonce === nonce)) { console.log(`✔ read back via Mirror Node after ${i * 2}s`); break; }
    await new Promise((res) => setTimeout(res, 2000));
  }
} else console.log("HCS_LOG_TOPIC_ID not set: run packages/hedera/scripts/setup-testnet.ts first");

const url = process.env.X402_PROBE_URL;
if (url) {
  const client = new x402Client().register("hedera:*", new ExactHederaScheme(createClientHederaSigner(accountId, parseKey(key), { network })));
  const res = await wrapFetchWithPayment(fetch, client)(url, { method: process.env.X402_PROBE_METHOD ?? "GET" });
  const h = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  const s = h ? (decodePaymentResponseHeader(h) as { transaction?: string; success?: boolean }) : undefined;
  console.log(`x402 ${res.status} settled=${s?.success} tx=${s?.transaction}`);
  if (s?.transaction) console.log(hashscanTx(s.transaction));
} else console.log("X402_PROBE_URL not set: the full e2e (HEDERA_MODE=live) exercises the paid /inspect endpoint");
