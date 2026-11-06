// Northwind Gadgets: a stand-in for any merchant's site. Serves the store, the OpenBox SDK bundle,
// and receives OpenBox webhooks (verifying the HMAC signature) to show them live.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";

const here = resolve(fileURLToPath(import.meta.url), "..");
const PORT = Number(process.env.STORE_PORT ?? 5174);
const SECRET = process.env.DEMO_STORE_WEBHOOK_SECRET ?? "whsec_demo_openbox";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const WEB = process.env.WEB_PUBLIC_URL ?? "http://localhost:3000";
const sdk = resolve(here, "../../packages/sdk/dist/openbox-checkout.global.js");
const clients = new Set();

function verify(sigHeader, body) {
  const t = /t=(\d+)/.exec(sigHeader ?? "")?.[1];
  const v1 = /v1=([0-9a-f]+)/.exec(sigHeader ?? "")?.[1];
  if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expect = createHmac("sha256", SECRET).update(`${t}.${body}`).digest();
  const got = Buffer.from(v1, "hex");
  return got.length === expect.length && timingSafeEqual(got, expect);
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhooks/openbox") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const valid = verify(req.headers["x-openbox-signature"], body);
      const evt = JSON.parse(body);
      for (const c of clients) c.write(`data: ${JSON.stringify({ type: evt.type, data: evt.data, valid })}\n\n`);
      res.writeHead(valid ? 200 : 401).end();
    });
    return;
  }
  if (req.url === "/hooks/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.url === "/openbox-checkout.js") {
    if (!existsSync(sdk)) return res.writeHead(500).end("build the SDK: pnpm --filter openbox-checkout build");
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(readFileSync(sdk));
  }
  const path = req.url.split("?")[0];
  const file = resolve(here, "public", path === "/" ? "index.html" : path.slice(1));
  if (!file.startsWith(resolve(here, "public")) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  let out = readFileSync(file);
  if (extname(file) === ".html") out = Buffer.from(out.toString().replace("__API__", API).replace("__WEB__", WEB));
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(out);
}).listen(PORT, () => console.log(`[store] Northwind Gadgets on http://localhost:${PORT}`));
