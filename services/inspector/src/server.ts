import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import express from "express";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import {
  chainFor, deliveryCheckoutAbi, normalizeSerial, openBoxDomain, returnVerdictTypes, serialHash, verdictTypes,
} from "@openbox/shared";
import { visionProvider } from "./vision";
import { openTopics, signEntry, topicsFromEnv } from "@openbox/hedera";

/**
 * OpenBox Neutral Inspector: an independent, pay-per-call inspection API.
 *  - POST /inspect is x402-protected (HTS USDC on Hedera testnet).
 *  - Reads the expected serial *commitment* from Whitechain (never trusts the caller for it).
 *  - Calls a swappable vision model, logs the verdict to an HCS topic, returns an EIP-712 signed verdict that
 *    DeliveryCheckout accepts from allowlisted inspector keys.
 */
const root = resolve(fileURLToPath(import.meta.url), "../../../..");
loadEnv({ path: resolve(root, process.env.OPENBOX_ENV_FILE ?? ".env") });

const port = Number(process.env.INSPECTOR_PORT ?? 4100);
const publicUrl = process.env.INSPECTOR_PUBLIC_URL ?? `http://localhost:${port}`;
const chainId = Number(process.env.CHAIN_ID ?? 31337);
const rpcUrl = process.env.RPC_URL ?? (chainId === 1874 ? "https://rpc.testnet.whitechain.io" : "http://127.0.0.1:8545");
const dep = JSON.parse(readFileSync(resolve(root, "deployments", `${chainId}.json`), "utf8")) as { deliveryCheckout: Address };
const signer = privateKeyToAccount(process.env.INSPECTOR_PK as Hex);
const chain = chainFor(chainId, rpcUrl);
const client = createPublicClient({ chain, transport: http(rpcUrl) });

const network = process.env.HEDERA_NETWORK ?? "hedera:testnet";
const payTo = process.env.INSPECTOR_PAY_TO ?? "0.0.9002";
const priceUsd = Number(process.env.INSPECTOR_PRICE_USD ?? 0.05);
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "http://localhost:4200";
const name = process.env.INSPECTOR_NAME ?? `OpenBox Inspector :${port}`;
const usdcAsset = process.env.HEDERA_USDC_TOKEN_ID ?? "0.0.429274";
const operator = process.env.HEDERA_INSPECTOR_ACCOUNT_ID && process.env.HEDERA_INSPECTOR_PRIVATE_KEY
  ? { accountId: process.env.HEDERA_INSPECTOR_ACCOUNT_ID, privateKey: process.env.HEDERA_INSPECTOR_PRIVATE_KEY }
  : undefined;
const topicsCfg = topicsFromEnv(root, operator);
const topics = openTopics(topicsCfg);
const hcsMode = topicsCfg.mode;

const REFUND_BPS = { minor: Number(process.env.DAMAGE_MINOR_BPS ?? 1500), major: Number(process.env.DAMAGE_MAJOR_BPS ?? 5000) };
const OUTCOME = { match: 1, mismatch: 2, damaged: 3 } as const;

const app = express();
app.use(express.json({ limit: "12mb" }));

// ---- discovery (the household agent finds us here) ------------------------------------------
app.get("/.well-known/x402", (_req, res) =>
  res.json({
    x402Version: 2,
    name,
    description: "Reads the serial and checks for damage in one still frame; returns an EIP-712 verdict and logs it to HCS.",
    inspector: signer.address,
    verifyingContract: dep.deliveryCheckout,
    chainId,
    priceUsd,
    directoryTopicId: topics.inspectors.id,
    logTopicId: topics.log.id,
    vision: process.env.VISION_PROVIDER ?? "mock",
    resources: [{ method: "POST", path: "/inspect", url: `${publicUrl}/inspect`, network, payTo, priceUsd }],
  }),
);
app.get("/health", (_req, res) => res.json({ ok: true, inspector: signer.address, hcs: hcsMode }));

// ---- x402 paywall ----------------------------------------------------------------------------
const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register("hedera:*", new ExactHederaScheme());
app.use(
  paymentMiddleware(
    {
      "POST /inspect": {
        accepts: [{ scheme: "exact", price: `$${priceUsd}`, network: network as `${string}:${string}`, payTo, maxTimeoutSeconds: 120 }],
        description: "One parcel inspection (serial read + damage check) with signed verdict",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

// ---- the paid endpoint ------------------------------------------------------------------------
app.post("/inspect", async (req, res) => {
  try {
    const { orderId, mode = "delivery", frame, expectedItem } = req.body as { orderId: Hex; mode?: "delivery" | "return"; frame: string; expectedItem?: string };
    if (!/^0x[0-9a-fA-F]{64}$/.test(orderId ?? "")) return res.status(400).json({ error: "orderId required" });
    if (!frame) return res.status(400).json({ error: "frame required" });
    const m = /^data:(image\/(?:jpeg|png));base64,(.*)$/s.exec(frame);
    const imageB64 = m ? m[2] : frame;
    const mediaType = (m?.[1] ?? "image/jpeg") as "image/jpeg" | "image/png";

    // Expected serial comes from the chain (committed by the seller's signed label at handover), not from the caller.
    const order = await client.readContract({ address: dep.deliveryCheckout, abi: deliveryCheckoutAbi, functionName: "getOrder", args: [orderId] });
    const status = Number(order.status);
    if (mode === "delivery" && status !== 3) return res.status(409).json({ error: `order not awaiting inspection (status ${status})` });
    if (mode === "return" && status !== 4) return res.status(409).json({ error: `order not returnable (status ${status})` });

    const provider = visionProvider();
    const reading = await provider.inspect({ imageB64, mediaType, expectedItem, mode });
    const serialRead = normalizeSerial(reading.serialRead);
    const readHash = serialHash(serialRead);
    const matches = serialRead.length > 0 && readHash.toLowerCase() === order.serialHash.toLowerCase();

    let outcome: keyof typeof OUTCOME;
    let refundBps = 0;
    if (!matches) { outcome = "mismatch"; refundBps = 10_000; }
    else if (mode === "delivery" && reading.damage !== "none") { outcome = "damaged"; refundBps = REFUND_BPS[reading.damage]; }
    else outcome = "match";

    const frameHash = `0x${createHash("sha256").update(Buffer.from(imageB64, "base64")).digest("hex")}` as Hex;
    // Tamper-evident trail: the verdict content goes to the HCS log first; its sequence number is bound into the
    // signed verdict, so any settlement on Whitechain can be matched to its public HCS record.
    const seq = await topics.log.submit({
      type: "inspection.verdict", v: 1, chainId, contract: dep.deliveryCheckout, orderId, seller: order.seller, mode,
      outcome, refundBps, serialReadHash: readHash, frameHash, inspector: signer.address, provider: provider.name,
      at: new Date().toISOString(),
    });
    const hcs = { topicId: topics.log.id, sequence: seq.sequence, txId: seq.txId };

    const domain = openBoxDomain(chainId, dep.deliveryCheckout);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    let verdict: Record<string, string | number>;
    let signature: Hex;
    if (mode === "delivery") {
      const v = { orderId, outcome: OUTCOME[outcome], refundBps, serialReadHash: readHash, frameHash, hcsSeq: BigInt(hcs.sequence), deadline };
      signature = await signer.signTypedData({ domain, types: verdictTypes, primaryType: "Verdict", message: v });
      verdict = { ...v, hcsSeq: hcs.sequence, deadline: deadline.toString() };
    } else {
      const v = { orderId, returnedSerialHash: readHash, frameHash, hcsSeq: BigInt(hcs.sequence), deadline };
      signature = await signer.signTypedData({ domain, types: returnVerdictTypes, primaryType: "ReturnVerdict", message: v });
      verdict = { ...v, hcsSeq: hcs.sequence, deadline: deadline.toString() };
    }

    console.log(`[inspector] ${orderId.slice(0, 10)} ${mode} -> ${outcome} (read "${serialRead || "-"}", damage ${reading.damage}, hcs #${hcs.sequence}, ${provider.name})`);
    res.json({
      orderId, mode, outcome, serialRead, damage: reading.damage, refundBps,
      confidence: Math.max(0, Math.min(1, reading.confidence)), frameHash, hcs, verdict, signature,
      inspector: signer.address, provider: provider.name,
      notes: [reading.itemDescription, reading.damageNotes].filter(Boolean).join(" · "),
    });
  } catch (e) {
    console.error("[inspector]", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

if (!existsSync(resolve(root, "deployments", `${chainId}.json`))) throw new Error("deploy contracts first");
/** Publish (or refresh) this inspector's signed entry in the HCS "inspectors" directory. */
async function register() {
  const entry = await signEntry({
    type: "inspector.register", v: 1, name, url: publicUrl, priceUsd, payTo, network, asset: usdcAsset,
    evmAddress: signer.address, chainId, at: new Date().toISOString(),
  }, signer);
  const r = await topics.inspectors.submit(entry);
  console.log(`[inspector] registered in directory ${topics.inspectors.id} #${r.sequence}${r.txId ? ` tx ${r.txId}` : ""}`);
}

app.listen(port, () => {
  console.log(`[inspector] ${name} ${publicUrl} price=$${priceUsd} key=${signer.address} vision=${process.env.VISION_PROVIDER ?? "mock"} hcs=${hcsMode} facilitator=${facilitatorUrl}`);
  if (process.env.INSPECTOR_REGISTER !== "false") register().catch((e) => console.error("[inspector] directory registration failed:", e.message));
});
