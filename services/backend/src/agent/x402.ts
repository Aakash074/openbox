import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner, type ClientHederaSigner } from "@x402/hedera";
import { parseKey } from "@openbox/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { cfg } from "../config";
import { checkSpend, type SpendDecision } from "./policy";

/**
 * The household agent's x402 wallet on Hedera. Live mode signs real HTS USDC TransferTransactions with the agent
 * account (facilitator pays the network fee). Mock mode produces a placeholder payload that only the local mock
 * facilitator accepts, so the whole flow runs offline.
 */
function signer(): ClientHederaSigner {
  if (cfg.agent.hederaMode === "live") {
    const id = cfg.agent.hederaAccountId;
    const key = cfg.agent.hederaPrivateKey;
    if (!id || !key) throw new Error("HEDERA_AGENT_ACCOUNT_ID / HEDERA_AGENT_PRIVATE_KEY required in live mode");
    return createClientHederaSigner(id, parseKey(key), { network: cfg.agent.hederaNetwork });
  }
  const from = cfg.agent.hederaAccountId ?? "0.0.9001";
  return {
    accountId: from,
    async createPartiallySignedTransferTransaction(req) {
      const body = { mock: true, from, to: req.payTo, amount: req.amount, asset: req.asset, nonce: crypto.randomUUID() };
      return Buffer.from(JSON.stringify(body)).toString("base64");
    },
  };
}

export type Settlement = { transaction?: string; network?: string; payer?: string; success?: boolean };
export type PaidResponse = { res: Response; settlement?: Settlement; spend: SpendDecision };

export class PolicyRefusal extends Error {
  constructor(public decision: SpendDecision) {
    super(`Agent refused to pay: ${decision.reason}`);
  }
}

/** One paid call. The spending policy runs inside x402's onBeforePaymentCreation hook, on the real requirements. */
export async function paidFetch(url: string, init: RequestInit, ctx: { inspectorBase: string; inspectorAddress?: string }): Promise<PaidResponse> {
  let decision: SpendDecision | undefined;
  const client = new x402Client()
    .register("hedera:*", new ExactHederaScheme(signer()))
    .onBeforePaymentCreation(async ({ selectedRequirements }) => {
      decision = checkSpend([ctx.inspectorBase, ctx.inspectorAddress ?? ""].filter(Boolean), selectedRequirements);
      if (!decision.ok) return { abort: true, reason: decision.reason };
    });
  const pay = wrapFetchWithPayment(fetch, client);
  let res: Response;
  try {
    res = await pay(url, init);
  } catch (e) {
    if (decision && !decision.ok) throw new PolicyRefusal(decision);
    throw e;
  }
  if (decision && !decision.ok) throw new PolicyRefusal(decision);
  const h = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  let settlement: Settlement | undefined;
  if (h) {
    try {
      settlement = decodePaymentResponseHeader(h) as Settlement;
    } catch {
      /* ignore malformed header */
    }
  }
  return { res, settlement, spend: decision ?? { ok: true, amountUsd: 0, reason: "free" } };
}
