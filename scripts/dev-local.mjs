#!/usr/bin/env node
// One command local stack: Anvil + contracts (MockUSDT) + facilitator + 2 inspectors + backend [+ web + demo store].
//   pnpm dev:local            start everything
//   pnpm dev:local --fresh    redeploy and reset local state (DB, mock HCS topics)
//   pnpm dev:local --no-ui    services only (used by e2e)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createRunner, portOpen, readEnvFile, root, startServices, startUi, waitPort } from "./lib/launcher.mjs";

const args = new Set(process.argv.slice(2));
if (!existsSync(resolve(root, ".env"))) copyFileSync(resolve(root, ".env.example"), resolve(root, ".env"));
const env = { ...readEnvFile(".env"), ...process.env };
if ((env.CHAIN_ID ?? "31337") !== "31337") { console.error("dev-local is for CHAIN_ID=31337"); process.exit(1); }
const { run } = createRunner(env);

// 1. chain
let fresh = args.has("--fresh");
if (!(await portOpen(8545))) {
  run("anvil", "anvil", ["--silent", "--chain-id", "31337", "--block-time", "1"]); // real chains mint blocks continuously; keep timestamps moving locally
  await waitPort(8545);
  fresh = true; // new chain => new deployment
}

// 2. contracts
const RPC = "http://127.0.0.1:8545";
const depFile = resolve(root, "deployments/31337.json");
const codeAt = (addr) => spawnSync("cast", ["code", addr, "--rpc-url", RPC], { encoding: "utf8" }).stdout.trim();
// Derive the public addresses the contract must trust from the configured keys, so they can never drift.
const addrOf = (pk) => spawnSync("cast", ["wallet", "address", "--private-key", pk], { encoding: "utf8" }).stdout.trim();
env.ATTESTER_ADDR = addrOf(env.ATTESTER_PK);
env.INSPECTOR_ADDRS = [env.INSPECTOR_PK, env.INSPECTOR2_PK].filter(Boolean).map(addrOf).join(",");
if (fresh || !existsSync(depFile) || codeAt(JSON.parse(readFileSync(depFile, "utf8")).deliveryCheckout) === "0x") {
  console.log("[dev] deploying contracts (MockUSDT, local only)...");
  const r = spawnSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast", "-q"], {
    cwd: resolve(root, "contracts"), env: { ...env, USDT_ADDR: "" }, stdio: "inherit",
  });
  if (r.status !== 0) process.exit(1);
  // Local state belongs to the old chain: reset it. Only our own generated files.
  for (const f of ["openbox-31337.db", "openbox-31337.db-wal", "openbox-31337.db-shm"]) rmSync(resolve(root, f), { force: true });
  rmSync(resolve(root, ".hedera-mock/31337"), { recursive: true, force: true });
}

// 3. services (+ UI)
await startServices(run, env);
if (!args.has("--no-ui")) startUi(run);
console.log(`\n[dev] up. backend ${env.BACKEND_PUBLIC_URL ?? "http://localhost:4000"} · web ${env.WEB_PUBLIC_URL ?? "http://localhost:3000"} · store http://localhost:5174\n`);
