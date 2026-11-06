#!/usr/bin/env node
// Hosted entrypoint (Render): the same four processes as `pnpm dev:testnet --no-ui`, configured from the
// platform's environment instead of .env.testnet. The backend listens on $PORT; the facilitator and both
// inspectors stay on internal ports inside the container.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRunner, root, startServices } from "./lib/launcher.mjs";

if (!existsSync(resolve(root, "deployments/1874.json"))) { console.error("deployments/1874.json missing"); process.exit(1); }
const env = { ...process.env, BACKEND_PORT: process.env.PORT ?? process.env.BACKEND_PORT ?? "4000" };
if (env.CHAIN_ID !== "1874") { console.error("render-start expects CHAIN_ID=1874"); process.exit(1); }
const { run } = createRunner(env);
console.log(`OpenBox hosted · chain 1874 · world=${env.WORLD_MODE} · hedera=${env.HEDERA_MODE} · port ${env.BACKEND_PORT}`);
await startServices(run, env);
console.log("Ready");
