/**
 * Offline check of the World ID Agent Pass adapter against a local fake World IdP (discovery, device
 * authorization, token endpoint, JWKS) that signs real ES256 ID tokens. Proves the request shape (essential acr
 * claims, linked subject, client_secret_basic) and every validation rule before live credentials exist.
 * Run: npx tsx services/backend/scripts/agentpass-check.ts
 */
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const { publicKey, privateKey } = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
let next: { status: number; body: Record<string, unknown> } = { status: 400, body: { error: "authorization_pending" } };
let lastDeviceReq: { auth?: string; form: URLSearchParams } | undefined;

const readBody = (req: IncomingMessage) => new Promise<string>((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
const server = createServer(async (req, res) => {
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url === "/.well-known/openid-configuration") {
    return send(200, { issuer: base, device_authorization_endpoint: `${base}/device`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks` });
  }
  if (req.url === "/jwks") return send(200, { keys: [jwk] });
  if (req.url === "/device") {
    lastDeviceReq = { auth: req.headers.authorization, form: new URLSearchParams(await readBody(req)) };
    return send(200, { device_code: "dc_secret", user_code: "ABCD-EFGH", verification_uri: `${base}/activate`, verification_uri_complete: `${base}/activate?code=ABCD-EFGH`, interval: 5, expires_in: 1200 });
  }
  if (req.url === "/token") { await readBody(req); return send(next.status, next.body); }
  send(404, {});
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const ISS = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

process.env.WORLD_ISSUER = ISS;
process.env.WORLD_CLIENT_ID = "client_test";
process.env.WORLD_CLIENT_SECRET = "s3cret value";
process.env.WORLD_TOKEN_AUTH = "basic";
const { agentPassVerifier } = await import("../src/world/agentpass");

const nowS = () => Math.floor(Date.now() / 1000);
const token = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string } = {}) =>
  new SignJWT({ acr: "https://world.org/oidc/acr/selfie", amr: ["world_id"], auth_time: nowS(), ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(opts.iss ?? ISS).setAudience(opts.aud ?? "client_test")
    .setSubject("pairwise-sub-123").setIssuedAt().setExpirationTime("5m").sign(privateKey);

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`); };
const row = { id: "wr_test", device_code: "dc_secret", started_at: nowS() - 2 };
const poll = async (status: number, body: Record<string, unknown>) => { next = { status, body }; return agentPassVerifier.poll(row); };

// start: request shape
const s = await agentPassVerifier.start("wr_test", "approve_refund", { sub: "pairwise-sub-123" });
check("start returns user code + complete link, never exposes device code to caller UI", s.userCode === "ABCD-EFGH" && s.verificationUri.includes("ABCD-EFGH"));
check("client_secret_basic header, no secret in body", lastDeviceReq?.auth === `Basic ${Buffer.from("client_test:s3cret+value").toString("base64")}` && !lastDeviceReq.form.has("client_secret"), lastDeviceReq?.auth);
const claims = JSON.parse(lastDeviceReq?.form.get("claims") ?? "{}");
check("scope=openid", lastDeviceReq?.form.get("scope") === "openid");
check("essential acr: Orb or Selfie Check", claims.id_token?.acr?.essential === true && JSON.stringify(claims.id_token.acr.values) === JSON.stringify(["https://world.org/oidc/acr/orb", "https://world.org/oidc/acr/selfie"]), claims);
check("linked household subject requested", claims.id_token?.sub?.value === "pairwise-sub-123", claims);
await agentPassVerifier.start("wr_test2", "approve_refund", {});
check("first approval: no subject constraint", !JSON.parse(lastDeviceReq?.form.get("claims") ?? "{}").id_token?.sub);

// poll: protocol states
check("authorization_pending → pending", (await poll(400, { error: "authorization_pending" })).status === "pending");
const sd = await poll(400, { error: "slow_down" });
check("slow_down → pending + back off", sd.status === "pending" && (sd as { slowDown?: boolean }).slowDown === true);
check("access_denied → denied", (await poll(400, { error: "access_denied" })).status === "denied");
check("expired_token → expired", (await poll(400, { error: "expired_token" })).status === "expired");
check("503 → failed (never approval)", (await poll(503, {})).status === "failed");

// poll: ID token validation
const good = await poll(200, { id_token: await token({}) });
check("valid Selfie Check token → verified", good.status === "verified" && (good as { sub: string }).sub === "pairwise-sub-123" && (good as { acr: string }).acr.endsWith("/selfie"), good);
check("valid Orb token → verified", (await poll(200, { id_token: await token({ acr: "https://world.org/oidc/acr/orb" }) })).status === "verified");
check("unrequested acr (orb-face not in policy) → failed", (await poll(200, { id_token: await token({ acr: "https://world.org/oidc/acr/orb-face" }) })).status === "failed");
check("missing acr → failed", (await poll(200, { id_token: await token({ acr: undefined }) })).status === "failed");
check("missing amr → failed", (await poll(200, { id_token: await token({ amr: undefined }) })).status === "failed");
check("stale auth_time (before request) → failed", (await poll(200, { id_token: await token({ auth_time: nowS() - 600 }) })).status === "failed");
check("future auth_time → failed", (await poll(200, { id_token: await token({ auth_time: nowS() + 600 }) })).status === "failed");
check("wrong audience → failed", (await poll(200, { id_token: await token({}, { aud: "someone_else" }) })).status === "failed");
check("wrong issuer → failed", (await poll(200, { id_token: await token({}, { iss: "https://evil.example" }) })).status === "failed");
const forged = await new SignJWT({ acr: "https://world.org/oidc/acr/orb", amr: ["world_id"], auth_time: nowS() })
  .setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(ISS).setAudience("client_test").setSubject("x").setIssuedAt().setExpirationTime("5m")
  .sign((await generateKeyPair("ES256")).privateKey);
check("token signed by another key → failed", (await poll(200, { id_token: forged })).status === "failed");

server.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll Agent Pass adapter checks passed");
process.exit(failed ? 1 : 0);
