import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "OpenBox: pay on proof. Checkout with verified release.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const svg = async (name: string) =>
  `data:image/svg+xml;base64,${(await readFile(join(process.cwd(), "public/art", `${name}.svg`))).toString("base64")}`;

export default async function Image() {
  const [parcel, phone] = await Promise.all([svg("parcel"), svg("aurora-x1")]);
  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", padding: "72px 80px", color: "#F2F4F7", fontFamily: "sans-serif",
        backgroundColor: "#0B1220",
        backgroundImage: "radial-gradient(circle at 12% 0%, rgba(13,148,136,.38), transparent 55%), radial-gradient(circle at 92% 25%, rgba(99,102,241,.28), transparent 50%)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width="56" height="56" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="8" fill="#0D9488" />
              <path d="M16 6.5 25 11v10l-9 4.5L7 21V11z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
              <path d="m12 16 3 3 5.5-6" fill="none" stroke="#CCFBF1" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>OpenBox</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: "#5EEAD4", letterSpacing: 2, textTransform: "uppercase" }}>Checkout with verified release</div>
            <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3, lineHeight: 1.02, marginTop: 16 }}>Pay on proof.</div>
            <div style={{ fontSize: 30, color: "#CBD5E1", marginTop: 20, maxWidth: 620, lineHeight: 1.35 }}>
              Payment is held until the right box is verified at the door. Settled in USDT.
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 20, color: "#98A2B3" }}>
            <span>World ID approvals</span><span>·</span><span>Inspected at the door</span><span>·</span><span>Agent pays via x402 on Hedera</span>
          </div>
        </div>
        <div style={{ display: "flex", position: "relative", width: 380, alignItems: "center", justifyContent: "center" }}>
          <img src={phone} width={250} height={250} style={{ position: "absolute", top: 40, right: 0 }} />
          <img src={parcel} width={300} height={300} style={{ position: "absolute", bottom: 10, left: 0 }} />
        </div>
      </div>
    ),
    { ...size },
  );
}
