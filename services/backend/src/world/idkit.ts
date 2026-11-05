import { IDKit, CredentialRequest, any, signRequest, type IDKitRequest, type IDKitResult } from "@worldcoin/idkit-core";
import { cfg } from "../config";
import type { HumanVerifier, PollResult, StartContext } from "./verifier";

/**
 * World ID 4.0 via IDKit, run entirely on the backend (the courier's phone only ever sees the connector link/QR).
 *
 *  - dispatch: IDKit.createSession → the courier creates a World ID session; its session_id is the courier's ID.
 *  - handover: IDKit.proveSession(saved session_id) with a user-presence check → only the same human can complete it,
 *    so a borrowed phone or a rented login fails at the door.
 *
 * Every result is re-verified server-side with the Developer Portal verify API (POST /api/v4/verify/{rp_id}),
 * and the RP-signed nonce is checked, so a replayed or forged result cannot pass. The RP signing key never
 * leaves this process.
 */
const ISS = () => `world-idkit:${cfg.world.rpId}`;
const open = new Map<string, { req: IDKitRequest; nonce: string; purpose: string; sessionId?: string }>();

function rpContext() {
  if (!cfg.world.appId || !cfg.world.rpId || !cfg.world.signingKey) throw new Error("WORLD_APP_ID / WORLD_RP_ID / WORLD_SIGNING_KEY not set");
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: cfg.world.signingKey, ttl: cfg.world.requestTtlS });
  return { rp_id: cfg.world.rpId, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig };
}

async function verifyWithPortal(result: IDKitResult) {
  const r = await fetch(`${cfg.world.verifyBase.replace(/\/$/, "")}/api/v4/verify/${cfg.world.rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result), // forwarded unchanged, as the verify API requires
  });
  const j = (await r.json().catch(() => ({}))) as { success?: boolean; code?: string; detail?: string; session_id?: string };
  return { ok: r.ok && j.success === true, code: j.code, detail: j.detail, sessionId: j.session_id };
}

const DENIED = new Set(["user_rejected", "cancelled"]);
const EXPIRED = new Set(["timeout", "rp_signature_expired", "timestamp_too_old"]);

export const idkitVerifier: HumanVerifier = {
  kind: "idkit",
  async start(requestId, purpose, ctx?: StartContext) {
    const rp_context = rpContext();
    const base = {
      app_id: cfg.world.appId as `app_${string}`,
      rp_context,
      environment: cfg.world.environment,
      action_description: purpose === "dispatch" ? "OpenBox: confirm you are the courier for this parcel" : "OpenBox: confirm you are at the door",
    };
    // WORLD_CREDENTIAL="proof_of_human,selfie" → either is accepted (Orb proof of human, or Selfie Check for riders without an Orb)
    const creds = cfg.world.credentials.map((c) => CredentialRequest(c));
    const credential = creds.length === 1 ? creds[0] : any(...creds);
    let req: IDKitRequest;
    if (purpose === "dispatch") {
      req = await IDKit.createSession(base).constraints(credential);
    } else {
      if (!ctx?.sessionId?.startsWith("session_")) throw new Error("order has no World session bound at dispatch");
      req = await IDKit.proveSession(ctx.sessionId as `session_${string}`, { ...base, require_user_presence: cfg.world.requirePresence })
        .constraints(credential);
    }
    open.set(requestId, { req, nonce: rp_context.nonce, purpose, sessionId: ctx?.sessionId });
    return { verificationUri: req.connectorURI, interval: 2, expiresIn: cfg.world.requestTtlS };
  },

  async poll(row): Promise<PollResult> {
    const o = open.get(row.id);
    if (!o) return { status: "failed", reason: "request lost (backend restarted); start a new check" };
    const s = await o.req.pollOnce();
    if (s.type === "waiting_for_connection" || s.type === "awaiting_confirmation") return { status: "pending" };
    open.delete(row.id);
    if (s.type === "failed" || !s.result) {
      const code = String(s.error ?? "failed");
      if (DENIED.has(code)) return { status: "denied", reason: `${code}: declined in World App` };
      if (EXPIRED.has(code)) return { status: "expired", reason: code };
      if (o.purpose === "handover") return { status: "failed", reason: `${code}: could not prove the courier's World session` };
      return { status: "failed", reason: code };
    }
    const result = s.result;
    // Freshness + binding: the proof must answer OUR signed request.
    if (result.nonce !== o.nonce) return { status: "failed", reason: "nonce mismatch: proof was not made for this request" };
    if (!("session_id" in result) || !result.session_id) return { status: "failed", reason: "no session in result" };
    const v = await verifyWithPortal(result);
    if (!v.ok) return { status: "failed", reason: `World verify rejected: ${v.code ?? ""} ${v.detail ?? ""}`.trim() };
    const sessionId = v.sessionId ?? result.session_id;
    return { status: "verified", iss: ISS(), sub: sessionId, authTime: Math.floor(Date.now() / 1000) };
  },
};
