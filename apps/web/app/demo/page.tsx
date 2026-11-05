"use client";
import { BalanceStrip } from "../components/ui";

/** Split screen for the video: store/SDK · doorbell (courier + household) · merchant, with the live balance strip. */
export default function Demo() {
  const store = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:5174";
  const pane = { border: 0, width: "100%", height: "100%", background: "#fff", borderRadius: 10 } as const;
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <BalanceStrip />
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1.25fr 1.25fr", gap: 8, padding: 8, background: "#0f172a" }}>
        <iframe src={store} style={pane} title="store" />
        <iframe src="/kiosk" style={pane} title="doorbell" allow="camera" />
        <iframe src="/merchant" style={pane} title="merchant" />
      </div>
    </div>
  );
}
