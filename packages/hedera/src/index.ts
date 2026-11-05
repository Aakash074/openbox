import { resolve } from "node:path";
import { recoverMessageAddress, type Hex, type LocalAccount } from "viem";
import { liveTopic, mockTopic, type Operator, type Topic } from "./topics";

export * from "./topics";

/**
 * The two OpenBox topics:
 *  - inspectors: a public directory. Each inspection service posts a signed entry (endpoint URL, price, payTo,
 *    verdict key). The household agent discovers services from here, never from a hard-coded URL.
 *  - log: a tamper-evident trail of every agent payment, refusal and inspection verdict hash. It also feeds
 *    seller reputation.
 */
export type InspectorEntry = {
  type: "inspector.register";
  v: 1;
  name: string;
  url: string;
  priceUsd: number;
  payTo: string;
  network: string;
  asset: string;
  evmAddress: Hex; // verdict-signing key, registered on DeliveryCheckout
  chainId: number;
  at: string;
  sig?: Hex; // EIP-191 signature by evmAddress over the entry without `sig`
};

export type LogEntry =
  | { type: "agent.payment"; v: 1; orderId: Hex; inspector: Hex; url: string; amountUsd: number; hederaTx?: string; at: string }
  | { type: "agent.refusal"; v: 1; orderId?: Hex; inspector: Hex; url: string; priceUsd: number; reason: string; at: string }
  | {
      type: "inspection.verdict"; v: 1; chainId: number; contract: Hex; orderId: Hex; seller?: Hex; mode: "delivery" | "return";
      outcome: "match" | "mismatch" | "damaged"; refundBps: number; serialReadHash: Hex; frameHash: Hex;
      inspector: Hex; provider: string; at: string;
    };

export type TopicsConfig = {
  network: string;
  inspectorsTopicId?: string;
  logTopicId?: string;
  operator?: Operator;
  mockDir: string;
  mode: "live" | "mock";
};

export function topicsFromEnv(root: string, operator?: Operator): TopicsConfig {
  const mode = (process.env.HCS_MODE ?? (process.env.HCS_INSPECTORS_TOPIC_ID ? "live" : "mock")) as "live" | "mock";
  return {
    network: process.env.HEDERA_NETWORK ?? "hedera:testnet",
    inspectorsTopicId: process.env.HCS_INSPECTORS_TOPIC_ID,
    logTopicId: process.env.HCS_LOG_TOPIC_ID,
    operator,
    mockDir: resolve(root, ".hedera-mock", process.env.CHAIN_ID ?? "31337"),
    mode,
  };
}

export function openTopics(c: TopicsConfig): { inspectors: Topic; log: Topic } {
  if (c.mode === "live") {
    if (!c.inspectorsTopicId || !c.logTopicId) throw new Error("HCS_INSPECTORS_TOPIC_ID and HCS_LOG_TOPIC_ID required (run packages/hedera/scripts/setup-testnet.ts)");
    return {
      inspectors: liveTopic(c.inspectorsTopicId, { network: c.network, operator: c.operator }),
      log: liveTopic(c.logTopicId, { network: c.network, operator: c.operator }),
    };
  }
  return { inspectors: mockTopic("inspectors", c.mockDir), log: mockTopic("log", c.mockDir) };
}

const canonical = (e: Omit<InspectorEntry, "sig">) => JSON.stringify(e, Object.keys(e).sort());

export async function signEntry(e: Omit<InspectorEntry, "sig">, account: LocalAccount): Promise<InspectorEntry> {
  return { ...e, sig: await account.signMessage({ message: canonical(e) }) };
}

export async function verifyEntry(e: InspectorEntry): Promise<boolean> {
  if (!e.sig) return false;
  const { sig, ...rest } = e;
  try {
    const addr = await recoverMessageAddress({ message: canonical(rest), signature: sig });
    return addr.toLowerCase() === e.evmAddress.toLowerCase();
  } catch {
    return false;
  }
}

/** Latest valid entry per inspector key. */
export async function readDirectory(t: Topic, chainId: number) {
  const msgs = await t.read<InspectorEntry>();
  const latest = new Map<string, InspectorEntry & { sequence: number }>();
  for (const m of msgs) {
    const e = m.message;
    if (e?.type !== "inspector.register" || e.chainId !== chainId) continue;
    if (!(await verifyEntry(e))) continue;
    latest.set(e.evmAddress.toLowerCase(), { ...e, sequence: m.sequence });
  }
  return [...latest.values()];
}
