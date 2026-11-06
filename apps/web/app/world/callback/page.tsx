import type { Metadata } from "next";
import { Card, Logo } from "../../components/ui";

export const metadata: Metadata = { title: "World ID sign-in", robots: { index: false } };

/**
 * Registered redirect URI for the World ID Agent Pass client (auth.world.org).
 * OpenBox uses the OIDC device flow, which never redirects here; World requires an exact HTTPS callback anyway.
 * The OpenBox backend receives and validates the result directly.
 */
export default function WorldCallback() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, width: "100%", display: "grid", gap: 16, justifyItems: "center" }}>
        <Logo />
        <Card title="World ID check complete">
          <p className="muted" style={{ margin: 0 }}>
            You can close this page and return to OpenBox. Your approval is sent to OpenBox directly; nothing is processed here.
          </p>
        </Card>
      </div>
    </main>
  );
}
