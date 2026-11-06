import type { Metadata } from "next";
import { Logo } from "../../components/ui";
import { IdentityShield } from "../../components/art";

export const metadata: Metadata = { title: "World ID sign-in", robots: { index: false } };

/**
 * Registered redirect URI for the World ID Agent Pass client (auth.world.org).
 * OpenBox uses the OIDC device flow, which never redirects here; World requires an exact HTTPS callback anyway.
 * The OpenBox backend receives and validates the result directly, so this page never claims a result: it only
 * reflects an `error` the provider put on the redirect (e.g. access_denied) and otherwise says the page can be closed.
 */
export default async function WorldCallback({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const error = typeof q.error === "string" ? q.error : undefined;
  const denied = error === "access_denied";
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 440, width: "100%", display: "grid", gap: 24, justifyItems: "center", textAlign: "center" }}>
        <div className="row" style={{ gap: 10 }}>
          <Logo size={40} label="OpenBox" />
          <span className="t-h2">OpenBox</span>
        </div>
        <section className="card rise" style={{ width: "100%", padding: "32px 28px", display: "grid", justifyItems: "center", gap: 12 }}>
          <IdentityShield size={120} state={error ? "error" : "neutral"} />
          <span className="badge nodot">World ID</span>
          {error ? (
            <>
              <h1 className="t-h2">{denied ? "World ID access wasn't allowed" : "World ID check didn't finish"}</h1>
              <p className="text-2" style={{ margin: 0 }}>
                Nothing was approved. You can close this page and start the check again from OpenBox.
              </p>
              {!denied && <p className="xs muted" style={{ margin: 0 }}>Error: <span className="mono">{error.slice(0, 80)}</span></p>}
            </>
          ) : (
            <>
              <h1 className="t-h2">You can close this page</h1>
              <p className="text-2" style={{ margin: 0 }}>
                Return to OpenBox to see the result. World sends your response to OpenBox directly; nothing is processed here.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
