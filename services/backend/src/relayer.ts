import {
  BaseError, ContractFunctionRevertedError, decodeFunctionData, encodeFunctionData, erc20Abi, formatEther, type Abi, type Address, type Hex,
} from "viem";
import { deliveryCheckoutAbi, openBoxAccountAbi, openBoxAccountFactoryAbi } from "@openbox/shared";
import { cfg } from "./config";
import { accounts, deployment, publicClient, wallet } from "./chain";
import { db, now, today } from "./db";

/**
 * Merchant-run gas relayer. Buyers never hold or spend WBT. Drain protection:
 *  1. Target + function allowlist (only DeliveryCheckout flows, the account factory, and OpenBoxAccount.execute
 *     whose inner calls are restricted to USDT.approve(checkout) and checkout.createOrder).
 *  2. Per-tx gas cap (estimate must be under RELAYER_MAX_GAS_PER_TX).
 *  3. Rate limits per IP and per buyer wallet (token buckets).
 *  4. Daily WBT budget across all relayed txs.
 */
const CHECKOUT_FNS = new Set([
  "createOrderWithPermit", "createOrderWithAuthorization", "dispatch", "handover", "settle",
  "timeoutRelease", "returnRefund", "cancelUndelivered",
]);
const BUYER_FNS = new Set(["createOrderWithPermit", "createOrderWithAuthorization", "execute", "createAccount"]);

export class RelayError extends Error {
  constructor(public code: string, msg: string) { super(msg); }
}

// ---- rate limiting -------------------------------------------------------
const buckets = new Map<string, { n: number; reset: number }>();
function hit(key: string, limit: number, windowS: number) {
  const t = now();
  const b = buckets.get(key);
  if (!b || b.reset <= t) { buckets.set(key, { n: 1, reset: t + windowS }); return; }
  if (++b.n > limit) throw new RelayError("rate_limited", `Rate limit exceeded for ${key.split(":")[0]}`);
}

// ---- serial nonce queue ----------------------------------------------------
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

export function spentToday(): bigint {
  const rows = db.prepare("SELECT cost_wei FROM relayer_spend WHERE day = ?").all(today()) as { cost_wei: string | null }[];
  return rows.reduce((a, r) => a + BigInt(r.cost_wei ?? 0), 0n);
}

async function checkAccountCalls(to: Address, data: Hex) {
  const { args } = decodeFunctionData({ abi: openBoxAccountAbi, data });
  const calls = args[0] as readonly { target: Address; value: bigint; data: Hex }[];
  // `to` must be an OpenBoxAccount from our factory
  const owner = (await publicClient.readContract({ address: to, abi: openBoxAccountAbi, functionName: "owner" }).catch(() => null)) as Address | null;
  if (!owner) throw new RelayError("not_allowed", "Target is not an OpenBox account");
  const expected = await publicClient.readContract({
    address: deployment.accountFactory, abi: openBoxAccountFactoryAbi, functionName: "accountAddress", args: [owner],
  });
  if (expected.toLowerCase() !== to.toLowerCase()) throw new RelayError("not_allowed", "Account not from OpenBox factory");
  for (const c of calls) {
    if (c.value !== 0n) throw new RelayError("not_allowed", "Value transfers not relayed");
    if (c.target.toLowerCase() === deployment.token.toLowerCase()) {
      const d = decodeFunctionData({ abi: erc20Abi, data: c.data });
      if (d.functionName !== "approve" || (d.args[0] as Address).toLowerCase() !== deployment.deliveryCheckout.toLowerCase())
        throw new RelayError("not_allowed", "Only USDT.approve(checkout) allowed");
    } else if (c.target.toLowerCase() === deployment.deliveryCheckout.toLowerCase()) {
      const d = decodeFunctionData({ abi: deliveryCheckoutAbi, data: c.data });
      if (d.functionName !== "createOrder") throw new RelayError("not_allowed", "Only createOrder allowed via account");
    } else throw new RelayError("not_allowed", "Inner call target not allowed");
  }
  return owner;
}

export type RelayRequest = {
  target: "checkout" | "factory" | "account";
  to?: Address; // for account
  functionName: string;
  args: readonly unknown[];
  ip?: string;
  wallet?: string; // buyer wallet for rate limiting
};

export async function relay(req: RelayRequest): Promise<{ hash: Hex; gasUsed: bigint; status: "success" | "reverted" }> {
  let to: Address;
  let abi: Abi;
  if (req.target === "checkout") {
    if (!CHECKOUT_FNS.has(req.functionName)) throw new RelayError("not_allowed", `Function ${req.functionName} not relayed`);
    to = deployment.deliveryCheckout; abi = deliveryCheckoutAbi as Abi;
  } else if (req.target === "factory") {
    if (req.functionName !== "createAccount") throw new RelayError("not_allowed", "Only createAccount");
    to = deployment.accountFactory; abi = openBoxAccountFactoryAbi as Abi;
  } else {
    if (req.functionName !== "execute" || !req.to) throw new RelayError("not_allowed", "Only account.execute");
    to = req.to; abi = openBoxAccountAbi as Abi;
  }
  const data = encodeFunctionData({ abi, functionName: req.functionName, args: req.args });
  if (req.target === "account") await checkAccountCalls(to, data);

  if (BUYER_FNS.has(req.functionName)) {
    if (req.ip) hit(`ip:${req.ip}`, cfg.relayer.perIpPerMin, 60);
    if (req.wallet) hit(`wallet:${req.wallet.toLowerCase()}`, cfg.relayer.perWalletPerHour, 3600);
  }

  return serial(async () => {
    // Simulate with the ABI first so reverts come back decoded (e.g. LabelAlreadyUsed, WrongCourier).
    await publicClient
      .simulateContract({ account: accounts.relayer, address: to, abi, functionName: req.functionName, args: req.args })
      .catch((e) => { throw new RelayError("would_revert", shortErr(e)); });
    const gas = await publicClient.estimateGas({ account: accounts.relayer, to, data }).catch((e) => {
      throw new RelayError("would_revert", shortErr(e));
    });
    if (gas > cfg.relayer.maxGasPerTx) throw new RelayError("gas_cap", `Gas ${gas} exceeds cap ${cfg.relayer.maxGasPerTx}`);
    const gasPrice = await publicClient.getGasPrice();
    const est = gas * gasPrice;
    if (spentToday() + est > cfg.relayer.dailyBudgetWei)
      throw new RelayError("budget", `Relayer daily budget (${formatEther(cfg.relayer.dailyBudgetWei)} WBT) exhausted`);

    const hash = await wallet("relayer").sendTransaction({ to, data, gas: (gas * 12n) / 10n, chain: undefined });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    const cost = rc.gasUsed * (rc.effectiveGasPrice ?? gasPrice);
    db.prepare("INSERT INTO relayer_spend (day, ts, fn, tx_hash, gas_used, cost_wei, ip, wallet) VALUES (?,?,?,?,?,?,?,?)").run(
      today(), now(), req.functionName, hash, rc.gasUsed.toString(), cost.toString(), req.ip ?? null, req.wallet ?? null,
    );
    if (rc.status !== "success") throw new RelayError("reverted", `Transaction reverted: ${hash}`);
    return { hash, gasUsed: rc.gasUsed, status: rc.status };
  });
}

export async function relayerStatus() {
  const bal = await publicClient.getBalance({ address: accounts.relayer.address });
  return {
    address: accounts.relayer.address,
    balanceWei: bal.toString(),
    balance: formatEther(bal),
    low: bal < cfg.relayer.lowBalanceWei,
    spentTodayWei: spentToday().toString(),
    dailyBudgetWei: cfg.relayer.dailyBudgetWei.toString(),
    maxGasPerTx: cfg.relayer.maxGasPerTx.toString(),
  };
}

export function shortErr(e: unknown): string {
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (rev?.data?.errorName) return rev.data.errorName;
    if (rev?.reason) return rev.reason;
    return e.shortMessage.split("\n")[0];
  }
  return String((e as Error)?.message ?? e).split("\n")[0];
}
