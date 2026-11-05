#!/usr/bin/env node
// Testnet stack: Whitechain Sepolia (1874, official USDT) + Hedera testnet (HCS + HTS USDC, x402) + live vision.
// Uses .env.testnet only (contracts already deployed: deployments/1874.json).
//   pnpm dev:testnet                  services + web + demo store
//   pnpm dev:testnet --no-ui          services only
//   pnpm dev:testnet --world-mock     mock World personas (e.g. while the World app is pending verification)
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRunner, readEnvFile, root, startServices, startUi } from "./lib/launcher.mjs";

const args = new Set(process.argv.slice(2));
const ENV_FILE = ".env.testnet";
if (!existsSync(resolve(root, ENV_FILE))) { console.error(`${ENV_FILE} missing`); process.exit(1); }
if (!existsSync(resolve(root, "deployments/1874.json"))) { console.error("deployments/1874.json missing: deploy first"); process.exit(1); }
const env = { ...process.env, ...readEnvFile(ENV_FILE), OPENBOX_ENV_FILE: ENV_FILE };
if (env.CHAIN_ID !== "1874") { console.error("dev-testnet expects CHAIN_ID=1874"); process.exit(1); }
if (args.has("--world-mock")) env.WORLD_MODE = "mock";
const { run } = createRunner(env);

console.log(`OpenBox testnet · chain 1874 · world=${env.WORLD_MODE} · hedera=${env.HEDERA_MODE} · facilitator=${env.FACILITATOR_MODE} · vision=${env.VISION_PROVIDER}`);
await startServices(run, env);
if (!args.has("--no-ui")) startUi(run);
console.log("\nReady: backend http://localhost:4000 · web http://localhost:3000 · store http://localhost:5174");
