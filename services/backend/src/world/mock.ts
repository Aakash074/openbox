import { cfg } from "../config";
import type { HumanVerifier, PollResult } from "./verifier";

/**
 * Mock World check. Each persona has a stable subject, so "same person -> same courier id" holds and the
 * wrong-courier denial is demonstrable. The courier phone page records the decision via /v1/world/mock/complete.
 */
export const MOCK_ISS = "https://auth.world.org#mock";
export const PERSONAS: Record<string, { name: string; sub: string }> = {
  alice: { name: "Alice (assigned courier)", sub: "pairwise-mock-alice-7f3a" },
  mallory: { name: "Mallory (not the courier)", sub: "pairwise-mock-mallory-91c2" },
  bob: { name: "Bob (another courier)", sub: "pairwise-mock-bob-44d0" },
  owner: { name: "Household owner", sub: "pairwise-mock-owner-2b19" },
};

const decisions = new Map<string, PollResult>();

export function mockComplete(requestId: string, persona: string, decision: "approve" | "deny") {
  const p = PERSONAS[persona];
  if (!p) throw new Error("unknown persona");
  decisions.set(
    requestId,
    decision === "approve"
      ? { status: "verified", iss: MOCK_ISS, sub: p.sub, authTime: Math.floor(Date.now() / 1000), acr: "https://world.org/oidc/acr/orb" }
      : { status: "denied", reason: "access_denied: the person declined (simulated World ID)" },
  );
}

export const mockVerifier: HumanVerifier = {
  kind: "mock",
  async start(requestId) {
    return { verificationUri: `${cfg.webUrl}/courier?req=${requestId}`, interval: 1, expiresIn: cfg.world.requestTtlS };
  },
  async poll(row) {
    const d = decisions.get(row.id);
    if (!d) return { status: "pending" };
    decisions.delete(row.id);
    return d;
  },
};
