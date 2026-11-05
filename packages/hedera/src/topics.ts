import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AccountId, Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";

/**
 * HCS topics, written with the Hedera JS SDK and read back through the Mirror Node REST API.
 * Hedera side of OpenBox is SDK only, zero Solidity: HCS (directory + audit log) + HTS (USDC fees via x402).
 *
 * Live mode needs an operator account per writer. Mock mode stores each topic as a local JSONL file with the same
 * read/write shape, so the full flow runs offline.
 */
export type TopicMessage<T = Record<string, unknown>> = {
  sequence: number;
  consensusTimestamp: string;
  message: T;
  payer?: string;
};

export interface Topic {
  readonly id: string;
  readonly live: boolean;
  submit(message: Record<string, unknown>): Promise<{ sequence: string; txId?: string }>;
  read<T = Record<string, unknown>>(): Promise<TopicMessage<T>[]>;
}

export const MIRROR = {
  "hedera:testnet": "https://testnet.mirrornode.hedera.com",
  "hedera:mainnet": "https://mainnet.mirrornode.hedera.com",
} as const;

export type Operator = { accountId: string; privateKey: string };

export function parseKey(k: string) {
  return k.startsWith("0x") ? PrivateKey.fromStringECDSA(k) : PrivateKey.fromString(k);
}

function clientFor(network: string, op: Operator) {
  const c = network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
  return c.setOperator(AccountId.fromString(op.accountId), parseKey(op.privateKey));
}

/** Read every message on a topic via the Mirror Node (paginated, ascending). */
export async function mirrorRead<T>(topicId: string, network = "hedera:testnet", mirror?: string): Promise<TopicMessage<T>[]> {
  const base = mirror ?? MIRROR[network as keyof typeof MIRROR] ?? MIRROR["hedera:testnet"];
  let url: string | null = `${base}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
  const out: TopicMessage<T>[] = [];
  while (url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`mirror node ${r.status} for topic ${topicId}`);
    const j = (await r.json()) as {
      messages: { sequence_number: number; consensus_timestamp: string; message: string; payer_account_id?: string }[];
      links?: { next?: string | null };
    };
    for (const m of j.messages) {
      try {
        out.push({
          sequence: m.sequence_number,
          consensusTimestamp: m.consensus_timestamp,
          message: JSON.parse(Buffer.from(m.message, "base64").toString("utf8")) as T,
          payer: m.payer_account_id,
        });
      } catch {
        /* skip non-JSON messages */
      }
    }
    url = j.links?.next ? `${base}${j.links.next}` : null;
  }
  return out;
}

export function liveTopic(topicId: string, opts: { network?: string; operator?: Operator; mirror?: string }): Topic {
  const network = opts.network ?? "hedera:testnet";
  let client: Client | undefined;
  return {
    id: topicId,
    live: true,
    async submit(message) {
      if (!opts.operator) throw new Error(`no Hedera operator configured to write topic ${topicId}`);
      client ??= clientFor(network, opts.operator);
      const resp = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(JSON.stringify(message)).execute(client);
      const rc = await resp.getReceipt(client);
      return { sequence: rc.topicSequenceNumber!.toString(), txId: resp.transactionId.toString() };
    },
    read: <T>() => mirrorRead<T>(topicId, network, opts.mirror),
  };
}

export function mockTopic(name: string, dir: string): Topic {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${name}.jsonl`);
  const all = () =>
    existsSync(file)
      ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as TopicMessage)
      : [];
  return {
    id: `0.0.mock-${name}`,
    live: false,
    async submit(message) {
      const sequence = all().length + 1;
      const t = Date.now();
      appendFileSync(file, JSON.stringify({ sequence, consensusTimestamp: `${Math.floor(t / 1000)}.${String(t % 1000).padStart(9, "0")}`, message }) + "\n");
      return { sequence: String(sequence) };
    },
    read: async <T>() => all() as TopicMessage<T>[],
  };
}

/** Admin helper (packages/hedera/scripts/setup-testnet.ts): create a public topic with a memo. */
export async function createTopic(memo: string, network: string, op: Operator) {
  const client = clientFor(network, op);
  const rc = await (await new TopicCreateTransaction().setTopicMemo(memo).execute(client)).getReceipt(client);
  client.close();
  return rc.topicId!.toString();
}
