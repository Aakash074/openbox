import { createRemoteJWKSet, jwtVerify } from "jose";
import { cfg } from "../config";
import type { HumanVerifier, PollResult } from "./verifier";

/**
 * World ID Agent Pass via OIDC device authorization grant (RFC 8628) at auth.world.org.
 * Discovery (verified): device_authorization_endpoint, token_endpoint, jwks_uri; subject_types: pairwise;
 * acr_values: orb, orb-face; claims include auth_time (used for freshness).
 * Client secret stays here; the courier only ever sees the user code / verification link.
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

function clientAuth(): Record<string, string> {
  if (!cfg.world.clientId || !cfg.world.clientSecret) throw new Error("WORLD_CLIENT_ID / WORLD_CLIENT_SECRET not set");
  return { client_id: cfg.world.clientId, client_secret: cfg.world.clientSecret };
}

const allowedAcr = () => cfg.world.acrValues.split(/\s+/).filter(Boolean);

export const agentPassVerifier: HumanVerifier = {
  kind: "agentpass",
  async start() {
    const d = await discovery();
    const body = new URLSearchParams({ ...clientAuth(), scope: "openid", acr_values: cfg.world.acrValues });
    const r = await fetch(d.device_authorization_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const j = (await r.json()) as Record<string, unknown>;
    if (!r.ok) throw new Error(`device_authorization failed: ${j.error ?? r.status} ${j.error_description ?? ""}`);
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
    const body = new URLSearchParams({
      ...clientAuth(),
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: row.device_code ?? "",
    });
    const r = await fetch(d.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const j = (await r.json()) as Record<string, string>;
    if (!r.ok) {
      switch (j.error) {
        case "authorization_pending": return { status: "pending" };
        case "slow_down": return { status: "pending", slowDown: true };
        case "access_denied": return { status: "denied", reason: "access_denied: declined in World ID" };
        case "expired_token": return { status: "expired", reason: "expired_token" };
        default: return { status: "failed", reason: `${j.error ?? r.status}: ${j.error_description ?? ""}` };
      }
    }
    // Validate the ID token on the server: signature (JWKS), issuer, audience, expiry, freshness, assurance level.
    try {
      const { payload } = await jwtVerify(j.id_token, jwks!, { issuer: d.issuer, audience: cfg.world.clientId! });
      const authTime = Number(payload.auth_time ?? payload.iat);
      if (!(authTime >= row.started_at - 5)) return { status: "failed", reason: "stale: auth_time before request started" };
      const acr = payload.acr as string | undefined;
      if (acr && !allowedAcr().includes(acr)) return { status: "failed", reason: `insufficient assurance: ${acr}` };
      if (!payload.sub) return { status: "failed", reason: "no subject" };
      return { status: "verified", iss: String(payload.iss), sub: String(payload.sub), authTime, acr };
    } catch (e) {
      return { status: "failed", reason: `invalid id_token: ${(e as Error).message}` };
    }
  },
};
