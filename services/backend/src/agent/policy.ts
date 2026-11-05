import { cfg } from "../config";
import { db, today } from "../db";

/**
 * Household agent spending controls (no human in the loop, so these are the guard rails):
 *  - inspector allowlist (by base URL; at discovery the inspector key must also be registered on-chain)
 *  - max price per call, and an approval threshold above which the agent refuses (would need a human)
 *  - per-day budget across all inspections
 *  - only USDC on the configured Hedera network
 */
export type SpendDecision = { ok: boolean; reason: string; amountUsd: number };

const USDC_DECIMALS = 6;
const HEDERA_TESTNET_USDC = "0.0.429274";

export const usdcAsset = () => process.env.HEDERA_USDC_TOKEN_ID ?? HEDERA_TESTNET_USDC;

export function spentTodayUsd(): number {
  const r = db
    .prepare("SELECT COALESCE(SUM(amount_usd),0) AS s FROM agent_payments WHERE day = ? AND status = 'settled'")
    .get(today()) as { s: number };
  return r.s;
}

/** `inspectorIds`: the inspector's URL and/or verdict-key address; either may appear on the allowlist. */
export function checkSpend(
  inspectorIds: string | string[],
  req: { network: string; asset: string; amount: string; payTo: string },
): SpendDecision {
  if (req.network !== cfg.agent.hederaNetwork) return { ok: false, reason: `network ${req.network} not allowed`, amountUsd: 0 };
  if (req.asset !== usdcAsset()) return { ok: false, reason: `asset ${req.asset} is not USDC (${usdcAsset()})`, amountUsd: 0 };
  const usd = Number(req.amount) / 10 ** USDC_DECIMALS;
  const ids = (Array.isArray(inspectorIds) ? inspectorIds : [inspectorIds]).map((x) => x.toLowerCase());
  const allow = cfg.agent.allowlist.map((a) => a.toLowerCase());
  if (allow.length && !ids.some((id) => allow.includes(id)))
    return { ok: false, reason: `inspector ${ids[0]} is not on the allowlist`, amountUsd: usd };
  if (usd > cfg.agent.approvalThreshold)
    return { ok: false, reason: `${usd} USD is above the ${cfg.agent.approvalThreshold} USD no-human threshold`, amountUsd: usd };
  if (usd > cfg.agent.maxPricePerCall)
    return { ok: false, reason: `${usd} USD exceeds the max ${cfg.agent.maxPricePerCall} USD per inspection`, amountUsd: usd };
  const spent = spentTodayUsd();
  if (spent + usd > cfg.agent.dailyBudget)
    return {
      ok: false,
      reason: `daily budget ${cfg.agent.dailyBudget} USD would be exceeded (spent ${spent.toFixed(2)} USD)`,
      amountUsd: usd,
    };
  return { ok: true, reason: "within policy", amountUsd: usd };
}

export function policySummary() {
  return {
    allowlist: cfg.agent.allowlist.length ? cfg.agent.allowlist : ["(any inspector registered on-chain)"],
    maxPricePerCall: cfg.agent.maxPricePerCall,
    approvalThreshold: cfg.agent.approvalThreshold,
    dailyBudget: cfg.agent.dailyBudget,
    spentToday: spentTodayUsd(),
    network: cfg.agent.hederaNetwork,
    asset: usdcAsset(),
    mode: cfg.agent.hederaMode,
  };
}
