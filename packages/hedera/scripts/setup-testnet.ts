/**
 * One-shot Hedera testnet setup for OpenBox (JS SDK only, zero Solidity).
 * From ONE portal account (the household agent / payer) it:
 *   1. creates 3 ECDSA accounts: inspector A (fees + HCS writer), inspector B (fees), facilitator (fee payer)
 *   2. associates every account that touches USDC (0.0.429274) with the token
 *   3. creates the HCS topics "inspectors" and "log"
 *   4. writes all IDs/keys into .env.testnet (never printed)
 * Idempotent: anything already present in .env.testnet is reused.
 * Usage (repo root): pnpm --filter @openbox/hedera exec tsx scripts/setup-testnet.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AccountCreateTransaction, AccountId, Client, Hbar, PrivateKey, Status, TokenAssociateTransaction,
} from "@hiero-ledger/sdk";
import { hashscanAccount, hashscanTopic } from "@openbox/shared";
import { createTopic, parseKey } from "../src/topics";

const ENV = resolve(import.meta.dirname, "../../../.env.testnet");
let text = readFileSync(ENV, "utf8");
const get = (k: string) => text.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim() || undefined;
function set(k: string, v: string) {
  const re = new RegExp(`^#?\\s*${k}=.*$`, "m");
  text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
  writeFileSync(ENV, text, { mode: 0o600 });
}

const opId = get("HEDERA_AGENT_ACCOUNT_ID");
const opKeyStr = get("HEDERA_AGENT_PRIVATE_KEY");
if (!opId || !opKeyStr) throw new Error("Put HEDERA_AGENT_ACCOUNT_ID and HEDERA_AGENT_PRIVATE_KEY in .env.testnet first");
const opKey = parseKey(opKeyStr);
const USDC = get("HEDERA_USDC_TOKEN_ID") ?? "0.0.429274";
const client = Client.forTestnet().setOperator(AccountId.fromString(opId), opKey);

const acct = (await (await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${opId}`)).json()) as { balance: { balance: number } };
console.log(`Agent ${opId}: ${acct.balance.balance / 1e8} HBAR`);
if (acct.balance.balance < 60 * 1e8) throw new Error("Agent account needs at least 60 HBAR (portal accounts start with more)");

async function associate(id: string, key: PrivateKey) {
  try {
    const tx = await new TokenAssociateTransaction().setAccountId(id).setTokenIds([USDC]).freezeWith(client).sign(key);
    const rc = await (await tx.execute(client)).getReceipt(client);
    console.log(`  ${id} associated with USDC ${USDC}: ${rc.status}`);
  } catch (e) {
    if (String(e).includes("TOKEN_ALREADY_ASSOCIATED")) console.log(`  ${id} already associated with USDC`);
    else throw e;
  }
}

async function ensureAccount(label: string, idKey: string, pkKey: string, hbar: number) {
  const existing = get(idKey), existingPk = get(pkKey);
  if (existing && existingPk && !existing.endsWith(".x")) { console.log(`${label}: reusing ${existing}`); return existing; }
  const key = PrivateKey.generateECDSA();
  const rc = await (await new AccountCreateTransaction()
    .setKeyWithoutAlias(key.publicKey).setInitialBalance(new Hbar(hbar)).setAccountMemo(`OpenBox ${label}`)
    .execute(client)).getReceipt(client);
  if (rc.status !== Status.Success || !rc.accountId) throw new Error(`create ${label} failed: ${rc.status}`);
  const id = rc.accountId.toString();
  set(idKey, id); set(pkKey, `0x${key.toStringRaw()}`);
  console.log(`${label}: created ${id} (${hbar} HBAR)  ${hashscanAccount(id)}`);
  return id;
}

console.log("\n1) Accounts");
const inspA = await ensureAccount("inspector A", "HEDERA_INSPECTOR_ACCOUNT_ID", "HEDERA_INSPECTOR_PRIVATE_KEY", 15);
const inspB = await ensureAccount("inspector B", "HEDERA_INSPECTOR2_ACCOUNT_ID", "HEDERA_INSPECTOR2_PRIVATE_KEY", 5);
const fac = await ensureAccount("facilitator", "HEDERA_FACILITATOR_ACCOUNT_ID", "HEDERA_FACILITATOR_PRIVATE_KEY", 20);
set("INSPECTOR_PAY_TO", inspA);
set("INSPECTOR2_PAY_TO", inspB);

console.log("\n2) USDC associations");
await associate(opId, opKey);
await associate(inspA, parseKey(get("HEDERA_INSPECTOR_PRIVATE_KEY")!));
await associate(inspB, parseKey(get("HEDERA_INSPECTOR2_PRIVATE_KEY")!));

console.log("\n3) HCS topics");
for (const [k, memo] of [
  ["HCS_INSPECTORS_TOPIC_ID", "OpenBox inspectors directory v1"],
  ["HCS_LOG_TOPIC_ID", "OpenBox audit log v1 (payments, refusals, verdicts)"],
] as const) {
  const have = get(k);
  if (have && !have.endsWith(".x")) { console.log(`${k}: reusing ${have}`); continue; }
  const id = await createTopic(memo, "hedera:testnet", { accountId: opId, privateKey: opKeyStr });
  set(k, id);
  console.log(`${k}=${id}  ${hashscanTopic(id)}`);
}

console.log(`\nDone. Facilitator ${fac} pays network fees.`);
console.log(`NEXT: get testnet USDC for the agent at https://faucet.circle.com → network "Hedera Testnet" → address ${opId}`);
client.close();
process.exit(0);
