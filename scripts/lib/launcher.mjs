// Shared process plumbing for dev-local.mjs and dev-testnet.mjs: env files, child processes, ports,
// and the one place that knows how the OpenBox services are started.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const root = resolve(fileURLToPath(import.meta.url), "../../..");

/** KEY=value lines of an env file (comments and blanks ignored). */
export function readEnvFile(file) {
  return Object.fromEntries(readFileSync(resolve(root, file), "utf8").split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
}

const colors = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m", "\x1b[34m", "\x1b[31m", "\x1b[90m"];

/** Child-process runner with prefixed, coloured output; kills its children on exit / Ctrl-C. */
export function createRunner(env) {
  const children = [];
  function run(name, cmd, argv, extraEnv = {}) {
    const c = colors[children.length % colors.length];
    const p = spawn(cmd, argv, { cwd: root, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    const out = (d) => d.toString().split("\n").filter(Boolean).forEach((l) => console.log(`${c}[${name}]\x1b[0m ${l}`));
    p.stdout.on("data", out); p.stderr.on("data", out);
    p.on("exit", (code) => console.log(`${c}[${name}]\x1b[0m exited ${code}`));
    children.push(p);
    return p;
  }
  const stopAll = () => children.forEach((c) => c.kill("SIGTERM"));
  process.on("SIGINT", () => { stopAll(); process.exit(0); });
  process.on("exit", stopAll);
  return { run };
}

export const portOpen = (port) => new Promise((r) => {
  const s = createConnection({ port, host: "127.0.0.1" }, () => { s.end(); r(true); });
  s.on("error", () => r(false));
});

export async function waitPort(port, ms = Number(process.env.SERVICE_START_TIMEOUT_MS ?? 60000)) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await portOpen(port)) return; await new Promise((r) => setTimeout(r, 300)); }
  throw new Error(`port ${port} did not open`);
}

/**
 * Facilitator → two inspectors at different prices (both self-register in the HCS directory) → backend.
 * Inspector B gets its own verdict key, price, payTo and Hedera operator.
 */
export async function startServices(run, env) {
  spawnSync("node", ["packages/shared/scripts/gen-abi.mjs"], { cwd: root, stdio: "ignore" });
  const tsx = resolve(root, "node_modules/.bin/tsx");
  run("facilitator", tsx, ["services/facilitator/src/server.ts"]);
  await waitPort(Number(env.FACILITATOR_PORT ?? 4200));
  run("inspector-A", tsx, ["services/inspector/src/server.ts"], {
    INSPECTOR_NAME: "Northstar Inspect (budget)", INSPECTOR_PORT: "4100", INSPECTOR_PUBLIC_URL: env.INSPECTOR_PUBLIC_URL ?? "http://localhost:4100",
  });
  run("inspector-B", tsx, ["services/inspector/src/server.ts"], {
    INSPECTOR_NAME: "Precision Vision Labs (premium)", INSPECTOR_PORT: "4101", INSPECTOR_PUBLIC_URL: env.INSPECTOR2_PUBLIC_URL ?? "http://localhost:4101",
    INSPECTOR_PK: env.INSPECTOR2_PK, INSPECTOR_PRICE_USD: env.INSPECTOR2_PRICE_USD ?? "0.30", INSPECTOR_PAY_TO: env.INSPECTOR2_PAY_TO ?? "0.0.9003",
    HEDERA_INSPECTOR_ACCOUNT_ID: env.HEDERA_INSPECTOR2_ACCOUNT_ID, HEDERA_INSPECTOR_PRIVATE_KEY: env.HEDERA_INSPECTOR2_PRIVATE_KEY,
  });
  await Promise.all([waitPort(4100), waitPort(4101)]);
  run("backend", tsx, ["services/backend/src/server.ts"], { LOG_LEVEL: "warn" });
  await waitPort(Number(env.BACKEND_PORT ?? 4000));
}

/** Builds the SDK bundle, then the Next.js app and the separate demo store. */
export function startUi(run) {
  spawnSync("pnpm", ["--filter", "openbox-checkout", "build"], { cwd: root, stdio: "ignore" });
  if (existsSync(resolve(root, "apps/web/package.json"))) run("web", "pnpm", ["--filter", "@openbox/web", "dev"]);
  if (existsSync(resolve(root, "apps/demo-store/package.json"))) run("store", "pnpm", ["--filter", "@openbox/demo-store", "dev"]);
}
