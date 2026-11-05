import { createHmac, randomUUID } from "node:crypto";
import type { WebhookEvent } from "@openbox/shared";
import { cfg } from "./config";
import { db, now } from "./db";

type Merchant = { id: string; webhook_url: string | null; webhook_secret: string };

/** Queue a webhook. Payload is signed: X-OpenBox-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + body)> */
export function enqueueWebhook(merchantId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const payload = JSON.stringify({ id: `evt_${randomUUID()}`, type: event, created: now(), data });
  db.prepare("INSERT INTO webhook_deliveries (merchant_id, event, payload, next_at) VALUES (?, ?, ?, ?)").run(
    merchantId, event, payload, now(),
  );
}

export function sign(secret: string, t: number, body: string) {
  return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
}

async function deliverDue() {
  const due = db
    .prepare("SELECT * FROM webhook_deliveries WHERE delivered_at IS NULL AND attempts < 8 AND next_at <= ? LIMIT 20")
    .all(now()) as { id: number; merchant_id: string; payload: string; attempts: number }[];
  for (const d of due) {
    const m = db.prepare("SELECT id, webhook_url, webhook_secret FROM merchants WHERE id = ?").get(d.merchant_id) as
      | Merchant
      | undefined;
    if (!m?.webhook_url) {
      db.prepare("UPDATE webhook_deliveries SET attempts = 99 WHERE id = ?").run(d.id);
      continue;
    }
    const t = now();
    let status = 0;
    try {
      const res = await fetch(m.webhook_url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-openbox-signature": `t=${t},v1=${sign(m.webhook_secret, t, d.payload)}` },
        body: d.payload,
        signal: AbortSignal.timeout(cfg.webhookTimeoutMs),
      });
      status = res.status;
    } catch {
      status = 0;
    }
    if (status >= 200 && status < 300) {
      db.prepare("UPDATE webhook_deliveries SET status = ?, attempts = attempts + 1, delivered_at = ? WHERE id = ?").run(status, t, d.id);
    } else {
      const backoff = Math.min(2 ** d.attempts * 5, 3600);
      db.prepare("UPDATE webhook_deliveries SET status = ?, attempts = attempts + 1, next_at = ? WHERE id = ?").run(status, t + backoff, d.id);
    }
  }
}

export function startWebhookWorker() {
  setInterval(() => deliverDue().catch((e) => console.error("[webhooks]", e)), 1500);
}
