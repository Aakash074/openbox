/**
 * Live World ID check with your phone, using the real backend adapter (src/world/idkit.ts).
 *   Step 1 (dispatch): scan the QR with your phone camera → World ID (Sandbox) app → approve. Creates a session.
 *   Step 2 (door):     scan the second QR → approve again. Must prove the SAME session.
 *   Optional:          at step 2 let a DIFFERENT person scan → expect a denial.
 * Prints time-to-first-success for WORLD_DEBRIEF.md.
 * Usage (repo root): set -a; . ./.env.testnet; set +a; pnpm --filter @openbox/backend exec tsx scripts/world-check.ts
 */
import qrcode from "qrcode-terminal";
import { idkitVerifier } from "../src/world/idkit";
import type { PollResult } from "../src/world/verifier";

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);

async function run(id: string, purpose: "dispatch" | "handover", sessionId?: string) {
  const startedAt = Math.floor(Date.now() / 1000);
  const s = await idkitVerifier.start(id, purpose, { sessionId });
  console.log(`\n=== ${purpose === "dispatch" ? "STEP 1 · courier assignment (create session)" : "STEP 2 · at the door (prove same session)"} ===`);
  qrcode.generate(s.verificationUri, { small: true });
  console.log(`Or open on the phone: ${s.verificationUri}\nWaiting for approval in World App…`);
  for (;;) {
    const r: PollResult = await idkitVerifier.poll({ id, device_code: null, started_at: startedAt });
    if (r.status !== "pending") return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
}

const short = (s: string) => `${s.slice(0, 16)}…${s.slice(-6)}`;

const a = await run("probe-dispatch", "dispatch");
if (a.status !== "verified") { console.log(`\n✘ Step 1 ${a.status}: ${a.reason}`); process.exit(1); }
console.log(`\n✔ Step 1 verified by World (server-side verify API) after ${secs()}s. Courier ID = ${short(a.sub)}`);
console.log(`TIME TO FIRST SUCCESS: ${secs()}s`);

const b = await run("probe-handover", "handover", a.sub);
if (b.status !== "verified") {
  console.log(`\n✘ Step 2 ${b.status}: ${b.reason}`);
  console.log("(If a different person scanned step 2, this denial is the expected result.)");
  process.exit(0);
}
console.log(b.sub === a.sub ? `\n✔ Step 2: SAME courier (${short(b.sub)}). Handover would be released.` : `\n✘ Step 2: different courier → denied.`);
process.exit(0);
