/**
 * Gate 3: World ID Agent Pass.
 *  - Always: fetches auth.world.org discovery and checks device flow + pairwise subjects + auth_time are offered.
 *  - With WORLD_CLIENT_ID/SECRET: starts a device authorization, prints the code/link, polls, validates the ID token,
 *    then runs a SECOND check and asserts the subject is identical (stable per-person ID => wrong-courier denial works).
 * Usage: pnpm tsx scripts/hour1/world-probe.ts
 */
import "dotenv/config";
import { createRemoteJWKSet, jwtVerify } from "jose";

const issuer = process.env.WORLD_ISSUER ?? "https://auth.world.org";
const d = await (await fetch(`${issuer}/.well-known/openid-configuration`)).json();
console.log("issuer:", d.issuer);
console.log("device flow:", d.grant_types_supported?.includes("urn:ietf:params:oauth:grant-type:device_code") ? "yes" : "NO");
console.log("subject types:", d.subject_types_supported, "· auth_time claim:", d.claims_supported?.includes("auth_time"));
console.log("acr values:", d.acr_values_supported);

const id = process.env.WORLD_CLIENT_ID, secret = process.env.WORLD_CLIENT_SECRET;
if (!id || !secret) {
  console.log("\nNo WORLD_CLIENT_ID/SECRET: discovery only. Fallback if portal access fails: World IDKit track.");
  process.exit(0);
}
const jwks = createRemoteJWKSet(new URL(d.jwks_uri));
const t0 = Date.now();

async function oneCheck(label: string) {
  const started = Math.floor(Date.now() / 1000);
  const r = await fetch(d.device_authorization_endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id!, client_secret: secret!, scope: "openid" }),
  });
  const a = await r.json();
  if (!r.ok) throw new Error(`device_authorization: ${JSON.stringify(a)}`);
  console.log(`\n[${label}] open ${a.verification_uri_complete ?? a.verification_uri}  code ${a.user_code ?? "-"}`);
  let interval = Number(a.interval ?? 5);
  for (;;) {
    await new Promise((res) => setTimeout(res, interval * 1000));
    const tr = await fetch(d.token_endpoint, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id!, client_secret: secret!, grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: a.device_code }),
    });
    const tj = await tr.json();
    if (tr.ok) {
      const { payload } = await jwtVerify(tj.id_token, jwks, { issuer: d.issuer, audience: id });
      console.log(`[${label}] sub=${payload.sub} acr=${payload.acr} auth_time=${payload.auth_time} fresh=${Number(payload.auth_time) >= started - 5}`);
      return String(payload.sub);
    }
    if (tj.error === "slow_down") interval += 5;
    else if (tj.error !== "authorization_pending") throw new Error(`${label}: ${tj.error} ${tj.error_description ?? ""}`);
  }
}

const s1 = await oneCheck("check 1 (dispatch)");
console.log(`time to first success: ${((Date.now() - t0) / 1000).toFixed(1)}s (record in WORLD_DEBRIEF.md)`);
const s2 = await oneCheck("check 2 (door, same person)");
console.log(s1 === s2 ? "\n✔ stable per-person ID: wrong-courier denial will work" : "\n✘ subject changed between checks: switch to IDKit fallback");
