"use client";
import { BalanceStrip, Brand } from "../components/ui";

/** Split screen for the video: store/SDK · doorbell · merchant, with one live balance strip on top. */
export default function Demo() {
  const store = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:5174";
  const panes: [string, string, string, string?][] = [
    ["Shop", "Buyer · Northwind Gadgets", `${store}/?embed=1`],
    ["Doorbell", "Buyer's front door", "/kiosk?embed=1", "camera"],
    ["Merchant", "OpenBox dashboard", "/merchant?embed=1"],
  ];
  return (
    <>
    <main className="demo-narrow page" style={{ maxWidth: 520 }}>
      <div className="card card-b stack-16" style={{ marginTop: 24 }}>
        <Brand href="/" />
        <h1>Demo view needs a wide screen</h1>
        <p className="text-2">It shows the shop, the doorbell and the merchant dashboard side by side, and needs a window at least 1280px wide. Or open each one on its own:</p>
        <div className="stack-8">
          <a className="btn block" href={store} target="_blank" rel="noreferrer">Shop</a>
          <a className="btn block" href="/kiosk">Doorbell</a>
          <a className="btn block" href="/merchant">Merchant dashboard</a>
        </div>
      </div>
    </main>
    <div className="demo">
      <div className="presenter" aria-label="Live balances">
        <Brand href="/" />
        <BalanceStrip />
      </div>
      <div className="panes">
        {panes.map(([title, role, src, allow]) => (
          <div key={title} className="pane">
            <div className="pane-bar"><span className="dots"><i /><i /><i /></span><b>{title}</b><span style={{ color: "#98A2B3" }}>{role}</span><span className="url">{src.replace(/\?embed=1$/, "").replace(/^https?:\/\//, "")}</span></div>
            <iframe src={src} title={title} allow={allow} />
          </div>
        ))}
      </div>
    </div>
    </>
  );
}
