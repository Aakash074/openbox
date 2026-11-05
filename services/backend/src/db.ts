import { DatabaseSync } from "node:sqlite";
import { cfg } from "./config";

export const db = new DatabaseSync(cfg.dbPath);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, seller TEXT NOT NULL,
  publishable_key TEXT UNIQUE NOT NULL, secret_key TEXT UNIQUE NOT NULL,
  webhook_url TEXT, webhook_secret TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  merchant_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL,
  amount TEXT NOT NULL, courier_fee TEXT NOT NULL, serial TEXT,
  PRIMARY KEY (merchant_id, sku)
);
CREATE TABLE IF NOT EXISTS orders (
  ref TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL, merchant_id TEXT NOT NULL, sku TEXT, product TEXT,
  seller TEXT NOT NULL, buyer TEXT, amount TEXT NOT NULL, courier_fee TEXT NOT NULL,
  terms_json TEXT NOT NULL, seller_sig TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created', outcome TEXT, serial TEXT, serial_hash TEXT,
  courier_id TEXT, courier_hash TEXT, courier_name TEXT, courier_payout TEXT, courier_world_sub TEXT,
  label_json TEXT, label_sig TEXT, qr TEXT,
  pay_tx TEXT, dispatch_tx TEXT, handover_tx TEXT, settle_tx TEXT, return_tx TEXT,
  courier_paid TEXT DEFAULT '0', seller_paid TEXT DEFAULT '0', buyer_refunded TEXT DEFAULT '0',
  pending_verdict_json TEXT, last_inspection_json TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chain_events (
  tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, block INTEGER NOT NULL, ts INTEGER NOT NULL,
  name TEXT NOT NULL, order_id TEXT, data_json TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS couriers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, courier_hash TEXT UNIQUE NOT NULL, payout TEXT NOT NULL,
  world_iss TEXT, world_sub TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_requests (
  id TEXT PRIMARY KEY, purpose TEXT NOT NULL, order_ref TEXT, label_hash TEXT,
  status TEXT NOT NULL, reason TEXT, device_code TEXT, user_code TEXT, verification_uri TEXT,
  poll_interval INTEGER DEFAULT 5, started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  courier_hash TEXT, world_sub TEXT, tx_hash TEXT, enroll_name TEXT, enroll_payout TEXT, timeline_json TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS agent_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, ts INTEGER NOT NULL, order_ref TEXT,
  inspector TEXT NOT NULL, amount_usd REAL NOT NULL, hedera_tx TEXT, network TEXT, status TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS relayer_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, ts INTEGER NOT NULL, fn TEXT NOT NULL,
  tx_hash TEXT, gas_used TEXT, cost_wei TEXT, ip TEXT, wallet TEXT
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, merchant_id TEXT NOT NULL, event TEXT NOT NULL, payload TEXT NOT NULL,
  status INTEGER, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, delivered_at INTEGER
);
`);

export const now = () => Math.floor(Date.now() / 1000);
export const today = () => new Date().toISOString().slice(0, 10);

export function kvGet(k: string): string | undefined {
  return (db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined)?.v;
}
export function kvSet(k: string, v: string) {
  db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}

export type OrderRow = {
  ref: string; order_id: `0x${string}`; merchant_id: string; sku: string | null; product: string | null;
  seller: `0x${string}`; buyer: `0x${string}` | null; amount: string; courier_fee: string;
  terms_json: string; seller_sig: `0x${string}`; status: string; outcome: string | null;
  serial: string | null; serial_hash: `0x${string}` | null; courier_id: string | null;
  courier_hash: `0x${string}` | null; courier_name: string | null; courier_payout: `0x${string}` | null;
  courier_world_sub: string | null; dispatch_tx: string | null; label_json: string | null; label_sig: `0x${string}` | null; qr: string | null;
  pay_tx: string | null; handover_tx: string | null; settle_tx: string | null; return_tx: string | null;
  courier_paid: string; seller_paid: string; buyer_refunded: string;
  pending_verdict_json: string | null; last_inspection_json: string | null;
  created_at: number; updated_at: number;
};

export const getOrderByRef = (ref: string) =>
  db.prepare("SELECT * FROM orders WHERE ref = ?").get(ref) as OrderRow | undefined;
export const getOrderById = (id: string) =>
  db.prepare("SELECT * FROM orders WHERE order_id = ?").get(id.toLowerCase()) as OrderRow | undefined;

export function updateOrder(ref: string, patch: Partial<OrderRow>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE orders SET ${set}, updated_at = ? WHERE ref = ?`).run(
    ...keys.map((k) => (patch as Record<string, unknown>)[k] as string),
    now(),
    ref,
  );
}
