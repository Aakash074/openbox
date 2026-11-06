/**
 * ReceivableNote transfer rule on Whitechain testnet: a live invoice note moves only between allowlisted lenders.
 *   (a) holder → non-lender address: simulated with eth_call, reverts with NotLender (no gas spent)
 *   (b) holder → a second allowlisted lender: succeeds on-chain. The second lender is the contract owner
 *       (DEPLOYER_PK); if it is not allowlisted yet, the owner calls setLender(owner, true) first.
 *       By default the note is then sent back to the original holder (also lender → lender), so the demo
 *       lender is repaid at settlement as before. Pass --keep to leave it with the second lender, who is then
 *       the one repaid when the order settles.
 *
 * Needs a live (funded, unsettled) note. Either pass its note ID (decimal or the 0x order ID), or pass nothing
 * and the script finances a fresh order through the API first (stack up: pnpm dev:testnet --no-ui --world-mock).
 *
 *   OPENBOX_ENV_FILE=.env.testnet npx tsx scripts/testnet/note-transfer-rules.ts [noteId] [--dry] [--keep]
 *
 * --dry sends no transactions: it runs (a), then only simulates (b) (and setLender, if it would be needed).
 * Keys used (from the env file): DEMO_LENDER_PK (the note holder), DEPLOYER_PK (ReceivableNote owner).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, http, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { chainFor, explorerAddress, explorerToken, explorerTx, receivableNoteAbi } from "@openbox/shared";
import { openboxClient, sleep } from "../lib/openbox-client";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
loadEnv({ path: resolve(root, process.env.OPENBOX_ENV_FILE ?? ".env") });

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const keep = args.includes("--keep");
const noteArg = args.find((a) => !a.startsWith("--"));

const chainId = 1874;
const dep = JSON.parse(readFileSync(resolve(root, `deployments/${chainId}.json`), "utf8"));
if (!dep.receivableNote) throw new Error(`deployments/${chainId}.json has no receivableNote`);
const noteAddr = dep.receivableNote as Address;
const rpc = process.env.RPC_URL || "https://rpc.testnet.whitechain.io";
const chain = chainFor(chainId, rpc);
const pub = createPublicClient({ chain, transport: http(rpc) });
const note = { address: noteAddr, abi: receivableNoteAbi } as const;

const needKey = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} in ${process.env.OPENBOX_ENV_FILE ?? ".env"}`);
  return privateKeyToAccount(v as Hex);
};
const lenderA = needKey("DEMO_LENDER_PK");
const owner = needKey("DEPLOYER_PK");
const walletOf = (account: typeof owner) => createWalletClient({ account, chain, transport: http(rpc) });

/** eth_call a write; returns the custom error name if it reverts, or null if it would succeed. */
async function simulate(account: Address, functionName: "transferFrom" | "setLender", fnArgs: readonly unknown[]) {
  try {
    await pub.simulateContract({ ...note, account, functionName, args: fnArgs } as Parameters<typeof pub.simulateContract>[0]);
    return null;
  } catch (e) {
    const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    if (rev instanceof ContractFunctionRevertedError) return rev.data?.errorName ?? rev.reason ?? rev.shortMessage;
    throw e;
  }
}

async function send(account: typeof owner, functionName: "transferFrom" | "setLender", fnArgs: readonly unknown[], label: string) {
  const { request } = await pub.simulateContract({ ...note, account, functionName, args: fnArgs } as Parameters<typeof pub.simulateContract>[0]);
  const hash = await walletOf(account).writeContract(request as Parameters<ReturnType<typeof walletOf>["writeContract"]>[0]);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`   ${label}: ${explorerTx(chainId, hash)}`);
  return hash;
}

/** Finance a fresh order through the API, as scripts/testnet/live-financed-order.ts steps 1-4 do. */
async function freshNote(): Promise<bigint> {
  const { api, waitReq, checkout } = openboxClient();
  const base = process.env.API ?? "http://localhost:4000";
  const lenderKey = process.env.LENDER_API_KEY ?? "lk_demo_openbox";
  const lenderApi = async (method: string, path: string) => {
    const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${lenderKey}` } });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
    return JSON.parse(text);
  };
  const cfg = await api("GET", "/v1/config");
  if (cfg.chainId !== chainId) throw new Error(`backend is on chain ${cfg.chainId}, expected ${chainId}`);
  const buyer = privateKeyToAccount(generatePrivateKey());
  const courier = privateKeyToAccount(generatePrivateKey()).address;
  console.log("0) No note ID given: financing a fresh order through the API");
  const fund = await api("POST", "/v1/demo/fund", { address: buyer.address });
  if (fund.txHash) console.log(`   demo top-up: ${explorerTx(chainId, fund.txHash)}`);
  const s = await checkout(buyer, "aurora-x1");
  console.log(`   order ${s.ref} paid: ${explorerTx(chainId, s.payTx)}`);
  await api("POST", `/v1/merchant/orders/${s.ref}/pack`, { serial: "SN-AX1-7731-0042" }, true);
  const dreq = await api("POST", `/v1/merchant/orders/${s.ref}/dispatch`, { courierName: "Alice", payout: courier }, true);
  if (cfg.worldMode === "mock") await api("POST", "/v1/world/mock/complete", { requestId: dreq.id, persona: "alice", decision: "approve" });
  else console.log(`   >>> Courier: open in World App: ${dreq.verificationUri}`);
  const d = await waitReq(dreq.id, ["dispatched", "failed", "denied", "expired"], 300000, 1000);
  if (d.status !== "dispatched") throw new Error(`dispatch ${d.status}: ${d.reason}`);
  const view = await api("POST", `/v1/merchant/orders/${s.ref}/financing`, {}, true);
  if (!view.offer?.id) throw new Error(`no offer created: ${JSON.stringify(view).slice(0, 300)}`);
  const funded = await lenderApi("POST", `/v1/lender/offers/${view.offer.id}/fund`);
  console.log(`   note funded: ${explorerTx(chainId, funded.txHash)}`);
  if (!funded.tokenId) throw new Error("fund response has no tokenId; rerun with the note ID as an argument");
  console.log(`   note ID ${funded.tokenId} (order ${s.ref} stays open: no handover yet, so the note is live)`);
  return BigInt(funded.tokenId);
}

if (dry && !noteArg) throw new Error("--dry needs a note ID (financing a fresh order sends transactions)");
const noteId = noteArg ? BigInt(noteArg) : await freshNote();
if (!noteArg) await sleep(2000);

console.log(`\nOpenBox ReceivableNote transfer rule · Whitechain ${chainId}${dry ? " · DRY RUN (no transactions)" : ""}`);
console.log(`   contract ${explorerAddress(chainId, noteAddr)}`);
console.log(`   note ${explorerToken(chainId, noteAddr, noteId)}\n`);

const [n, contractOwner] = await Promise.all([
  pub.readContract({ ...note, functionName: "getNote", args: [noteId] }),
  pub.readContract({ ...note, functionName: "owner" }),
]);
if (n.status !== 1) throw new Error(`note is not live (status ${n.status}: 0 none, 2 repaid, 3 shortfall)`);
const holder = await pub.readContract({ ...note, functionName: "ownerOf", args: [noteId] });
console.log(`   live note: face ${Number(n.face) / 1e6} USDT · holder ${holder}`);
if (holder.toLowerCase() !== lenderA.address.toLowerCase())
  throw new Error(`note is held by ${holder}, not the DEMO_LENDER_PK wallet ${lenderA.address}`);
if (contractOwner.toLowerCase() !== owner.address.toLowerCase())
  throw new Error(`ReceivableNote owner is ${contractOwner}, not the DEPLOYER_PK wallet ${owner.address}`);
const lenderB = owner;
if (lenderB.address.toLowerCase() === holder.toLowerCase()) throw new Error("second lender must differ from the holder");

console.log("\n(a) Transfer to a non-lender address is refused (eth_call, no gas)");
const outsider = privateKeyToAccount(generatePrivateKey()).address;
const outsiderAllowed = await pub.readContract({ ...note, functionName: "isLender", args: [outsider] });
const errA = await simulate(holder, "transferFrom", [holder, outsider, noteId]);
console.log(`   transferFrom(holder → ${outsider}) · isLender=${outsiderAllowed} → ${errA ? `reverts: ${errA}` : "WOULD SUCCEED"}`);
if (errA !== "NotLender") throw new Error(`expected NotLender, got ${errA ?? "success"}`);

console.log("\n(b) Transfer to a second allowlisted lender succeeds");
let bAllowed = await pub.readContract({ ...note, functionName: "isLender", args: [lenderB.address] });
console.log(`   second lender ${lenderB.address} (ReceivableNote owner) · isLender=${bAllowed}`);
if (!bAllowed) {
  const errBefore = await simulate(holder, "transferFrom", [holder, lenderB.address, noteId]);
  console.log(`   before allowlisting, transferFrom(holder → second lender) → ${errBefore ? `reverts: ${errBefore}` : "would succeed"}`);
  if (dry) {
    const errSet = await simulate(owner.address, "setLender", [lenderB.address, true]);
    console.log(`   [dry] owner setLender(second lender, true) → ${errSet ? `reverts: ${errSet}` : "would succeed"}`);
    console.log("   [dry] stopping here: the lender → lender transfer needs the allowlisting transaction first");
    process.exit(0);
  }
  await send(owner, "setLender", [lenderB.address, true], "owner allowlists the second lender (setLender)");
  bAllowed = true;
}
const errB = await simulate(holder, "transferFrom", [holder, lenderB.address, noteId]);
console.log(`   simulate transferFrom(holder → second lender) → ${errB ? `reverts: ${errB}` : "succeeds"}`);
if (errB) throw new Error(`lender → lender transfer should succeed, got ${errB}`);
if (dry) process.exit(0);

await send(lenderA, "transferFrom", [holder, lenderB.address, noteId], "lender → lender transfer");
const newHolder = await pub.readContract({ ...note, functionName: "ownerOf", args: [noteId] });
console.log(`   ownerOf(note) = ${newHolder} (the second lender is now repaid at settlement)`);

if (!keep) {
  await send(lenderB, "transferFrom", [lenderB.address, holder, noteId], "transfer back to the original lender");
  console.log(`   ownerOf(note) = ${await pub.readContract({ ...note, functionName: "ownerOf", args: [noteId] })}`);
}
process.exit(0);
