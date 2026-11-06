import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Address, Hex } from "viem";
import type { GaslessMode } from "@openbox/shared";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
loadEnv({ path: resolve(root, process.env.OPENBOX_ENV_FILE ?? ".env") });

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Missing env ${k}`);
  return v;
};
const num = (k: string, d: number) => Number(process.env[k] ?? d);

export type Deployment = {
  chainId: number;
  token: Address;
  mockToken: boolean;
  deliveryCheckout: Address;
  accountFactory: Address;
  deployBlock: number;
  attester: Address;
  inspector: Address;
  /** Optional: invoice advances are disabled when the note isn't deployed on this chain. */
  receivableNote?: Address;
  receivableNoteBlock?: number;
  lender?: Address;
};

const chainId = num("CHAIN_ID", 31337);

export function loadDeployment(): Deployment {
  const p = resolve(root, "deployments", `${chainId}.json`);
  if (!existsSync(p)) throw new Error(`No deployment at ${p}. Run the deploy script first.`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export const cfg = {
  root,
  port: num("BACKEND_PORT", 4000),
  publicUrl: env("BACKEND_PUBLIC_URL", "http://localhost:4000"),
  webUrl: env("WEB_PUBLIC_URL", "http://localhost:3000"),
  chainId,
  rpcUrl: env("RPC_URL", chainId === 1874 ? "https://rpc.testnet.whitechain.io" : "http://127.0.0.1:8545"),
  explorer: process.env.WHITECHAIN_EXPLORER,
  dbPath: env("DB_PATH", resolve(root, `openbox-${chainId}.db`)),
  gaslessMode: env("GASLESS_MODE", "permit") as GaslessMode,
  demoMode: env("DEMO_MODE", "true") === "true",

  keys: {
    relayer: env("RELAYER_PK") as Hex,
    attester: env("ATTESTER_PK") as Hex,
    seller: env("SELLER_PK") as Hex, // demo merchant signer (production: merchant's own server)
    demoTreasury: process.env.DEMO_TREASURY_PK as Hex | undefined,
    demoLender: process.env.DEMO_LENDER_PK as Hex | undefined, // demo lender wallet (allowlisted on ReceivableNote)
  },

  /** Invoice advances (ReceivableNote). Shares of the order's face value (amount - courier fee), in basis points. */
  finance: {
    advanceBps: BigInt(num("FINANCE_ADVANCE_BPS", 9500)),
    holdbackBps: BigInt(num("FINANCE_HOLDBACK_BPS", 1000)),
    offerTtlS: num("FINANCE_OFFER_TTL_S", 2 * 3600),
    lenderApiKey: env("LENDER_API_KEY", "lk_demo_openbox"),
  },

  windows: {
    delivery: BigInt(num("DELIVERY_WINDOW_S", 3 * 24 * 3600)),
    inspection: BigInt(num("INSPECTION_WINDOW_S", 120)),
    return: BigInt(num("RETURN_WINDOW_S", 7 * 24 * 3600)),
  },

  relayer: {
    maxGasPerTx: BigInt(num("RELAYER_MAX_GAS_PER_TX", 1_500_000)),
    dailyBudgetWei: BigInt(env("RELAYER_DAILY_BUDGET_WEI", "50000000000000000")), // 0.05 WBT
    perIpPerMin: num("RELAYER_PER_IP_PER_MIN", 20),
    perWalletPerHour: num("RELAYER_PER_WALLET_PER_HOUR", 10),
    lowBalanceWei: BigInt(env("RELAYER_LOW_BALANCE_WEI", "10000000000000000")),
  },

  world: {
    mode: env("WORLD_MODE", "mock") as "mock" | "agentpass" | "idkit",
    issuer: env("WORLD_ISSUER", "https://auth.world.org"),
    clientId: process.env.WORLD_CLIENT_ID,
    clientSecret: process.env.WORLD_CLIENT_SECRET,
    // World ID Agent Pass (auth.world.org OIDC device flow) gates the household agent's money actions.
    // Defaults to the real IdP when a client is configured, otherwise the mock personas.
    agentPassMode: (process.env.WORLD_AGENT_PASS_MODE ??
      (process.env.WORLD_CLIENT_ID && process.env.WORLD_CLIENT_SECRET ? "agentpass" : "mock")) as "agentpass" | "mock",
    // Essential ID-token acr classes: Orb or Selfie Check. Use the -face variants to force a fresh face check.
    acrClasses: env("WORLD_ACR_CLASSES", "https://world.org/oidc/acr/orb https://world.org/oidc/acr/selfie")
      .split(/\s+/).filter(Boolean),
    tokenAuth: env("WORLD_TOKEN_AUTH", "basic") as "basic" | "post", // client_secret_basic (World's default) or _post
    requestTtlS: num("WORLD_REQUEST_TTL_S", 300),
    // IDKit (World ID 4.0) — values from developer.world.org. Signing key stays server-side.
    appId: process.env.WORLD_APP_ID,
    rpId: process.env.WORLD_RP_ID,
    signingKey: process.env.WORLD_SIGNING_KEY,
    environment: env("WORLD_ENVIRONMENT", "production") as "production" | "staging" | "sandbox",
    credentials: env("WORLD_CREDENTIAL", "proof_of_human,selfie").split(",").map((c) => c.trim()).filter(Boolean) as ("proof_of_human" | "selfie" | "passport" | "mnc")[],
    requirePresence: env("WORLD_REQUIRE_PRESENCE", "true") === "true",
    verifyBase: env("WORLD_VERIFY_BASE", "https://developer.world.org"),
  },

  agent: {
    allowlist: env("AGENT_INSPECTOR_ALLOWLIST", "").split(",").map((s) => s.trim()).filter(Boolean),
    maxPricePerCall: num("AGENT_MAX_PRICE_PER_CALL", 0.1), // USD
    dailyBudget: num("AGENT_DAILY_BUDGET", 2), // USD
    approvalThreshold: num("AGENT_APPROVAL_THRESHOLD", 0.25), // above this the agent refuses (needs a human)
    hederaMode: env("HEDERA_MODE", "mock") as "mock" | "live",
    hederaNetwork: env("HEDERA_NETWORK", "hedera:testnet"),
    hederaAccountId: process.env.HEDERA_AGENT_ACCOUNT_ID,
    hederaPrivateKey: process.env.HEDERA_AGENT_PRIVATE_KEY,
  },

  webhookTimeoutMs: num("WEBHOOK_TIMEOUT_MS", 5000),
};
