/**
 * A "fresh human check" provider. Two adapters:
 *  - agentpass: World ID Agent Pass, the OIDC IdP at auth.world.org (device authorization grant).
 *  - idkit: World ID 4.0 session proofs via IDKit (developer.world.org app_id / rp_id / signing key).
 *  - mock: same state machine with fixed personas, so the demo runs without portal access.
 * The backend is the only party that talks to the IdP and validates the result.
 */
export type StartResult = {
  deviceCode?: string;
  userCode?: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
};

export type PollResult =
  | { status: "pending"; slowDown?: boolean }
  | { status: "verified"; iss: string; sub: string; authTime: number; acr?: string }
  | { status: "denied" | "expired" | "failed"; reason: string };

/** Extra context: for a handover, the World ID (session) bound to the order at dispatch. */
export type StartContext = { sessionId?: string };

export interface HumanVerifier {
  readonly kind: "mock" | "agentpass" | "idkit";
  start(requestId: string, purpose: string, ctx?: StartContext): Promise<StartResult>;
  poll(row: { id: string; device_code: string | null; started_at: number }): Promise<PollResult>;
}
