import { createRemoteJWKSet, jwtVerify } from "jose";
import { cfg } from "../config";
import type { HumanVerifier, PollResult } from "./verifier";

/**
 * World ID Agent Pass: the World IdP at auth.world.org (or sandbox.auth.world.org), OIDC Device Authorization
 * Grant (RFC 8628), used as a human checkpoint before the household agent acts with the buyer's money.
 * Follows https://auth.world.org/docs/guides/oidc#device-flow and /docs/guides/step-up:
 *  - start: POST scope=openid + an essential ID-token `acr` request (Orb or Selfie Check) via `claims`;
 *    when the household is already linked, also request `sub` so World itself rejects anyone else.
 *    Device authentication is always fresh; nonce/prompt/max_age don't apply to this grant.
 *  - poll: authorization_pending / slow_down (+5s) / stop on any other error, 503 or 429.
 *  - validate: signature (JWKS), issuer, audience, expiry, required auth_time (after this attempt started),
 *    acr in the requested classes, amr present. Device tokens omit nonce.
 * Client credentials stay on the server; the person only sees the user code / verification link.
 */
type Discovery = { device_authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string };
let disco: Discovery | undefined;
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

async function discovery(): Promise<Discovery> {
  if (!disco) {
    const r = await fetch(`${cfg.world.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`World discovery failed: ${r.status}`);
    disco = (await r.json()) as Discovery;
    jwks = createRemoteJWKSet(new URL(disco.jwks_uri));
  }
  return disco;
}

/** client_secret_basic (World's recommended default) or client_secret_post, matching the registration. */
function withClientAuth(form: Record<string, string>): { headers: Record<string, string>; body: URLSearchParams } {
  const { clientId, clientSecret } = cfg.world;
  if (!clientId || !clientSecret) throw new Error("WORLD_CLIENT_ID / WORLD_CLIENT_SECRET not set");
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (cfg.world.tokenAuth === "post") return { headers, body: new URLSearchParams({ ...form, client_id: clientId, client_secret: clientSecret }) };
  const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, "+"); // RFC 6749 §2.3.1
  headers.authorization = `Basic ${Buffer.from(`${enc(clientId)}:${enc(clientSecret)}`).toString("base64")}`;
  return { headers, body: new URLSearchParams(form) };
}

export function claimsRequest(sub?: string) {
  return JSON.stringify({
    id_token: {
      acr: { essential: true, values: cfg.world.acrClasses },
      ...(sub ? { sub: { value: sub } } : {}),
    },
  });
}

export const agentPassVerifier: HumanVerifier = {
  kind: "agentpass",
  async start(_requestId, _purpose, ctx) {
    const d = await discovery();
    const { headers, body } = withClientAuth({ scope: "openid", claims: claimsRequest(ctx?.sub) });
    const r = await fetch(d.device_authorization_endpoint, { method: "POST", headers, body });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(`device_authorization failed: ${j.error ?? r.status} ${j.error_description ?? ""}`.trim());
    return {
      deviceCode: String(j.device_code),
      userCode: j.user_code ? String(j.user_code) : undefined,
      verificationUri: String(j.verification_uri_complete ?? j.verification_uri),
      interval: Number(j.interval ?? 5),
      expiresIn: Number(j.expires_in ?? cfg.world.requestTtlS),
    };
  },
  async poll(row): Promise<PollResult> {
    const d = await discovery();
    const { headers, body } = withClientAuth({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: row.device_code ?? "",
    });
    const r = await fetch(d.token_endpoint, { method: "POST", headers, body });
    if (r.status === 503) return { status: "failed", reason: "World ID temporarily unavailable" };
    if (r.status === 429) return { status: "failed", reason: "rate limited by World ID" };
    const j = (await r.json().catch(() => ({}))) as Record<string, string>;
    if (!r.ok) {
      switch (j.error) {
        case "authorization_pending": return { status: "pending" };
        case "slow_down": return { status: "pending", slowDown: true };
        case "access_denied": return { status: "denied", reason: "access_denied: declined in World ID, or not the linked person" };
        case "expired_token": return { status: "expired", reason: "expired_token" };
        default: return { status: "failed", reason: `${j.error ?? r.status}: ${j.error_description ?? ""}`.trim() };
      }
    }
    try {
      const { payload } = await jwtVerify(j.id_token, jwks!, { issuer: d.issuer, audience: cfg.world.clientId! });
      const authTime = Number(payload.auth_time);
      if (!Number.isFinite(authTime)) return { status: "failed", reason: "id_token has no auth_time" };
      if (authTime < row.started_at - 5) return { status: "failed", reason: "stale: authenticated before this request started" };
      if (authTime > Math.floor(Date.now() / 1000) + 60) return { status: "failed", reason: "auth_time is in the future" };
      const acr = payload.acr as string | undefined;
      if (!acr || !cfg.world.acrClasses.includes(acr)) return { status: "failed", reason: `insufficient assurance: ${acr ?? "none"}` };
      if (!Array.isArray(payload.amr) || payload.amr.length === 0) return { status: "failed", reason: "id_token has no amr" };
      if (!payload.sub) return { status: "failed", reason: "no subject" };
      return { status: "verified", iss: String(payload.iss), sub: String(payload.sub), authTime, acr };
    } catch (e) {
      return { status: "failed", reason: `invalid id_token: ${(e as Error).message}` };
    }
  },
};
