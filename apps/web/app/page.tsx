import Link from "next/link";
import { Top } from "./components/Top";

export default function Home() {
  return (
    <>
      <Top title="pay on proof" />
      <div className="wrap">
        <div className="card" style={{ maxWidth: 760 }}>
          <h1 style={{ fontSize: 26, marginBottom: 6 }}>Checkout with verified release</h1>
          <p className="muted">The courier is paid when the doorbell verifies the handover; the seller is paid only when the box holds what was ordered. USDT on Whitechain, between any two countries.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <a className="btn primary" href={process.env.NEXT_PUBLIC_STORE_URL} target="_blank" rel="noreferrer">1 · Demo store (20-line SDK)</a>
            <Link className="btn" href="/merchant">2 · Merchant dashboard</Link>
            <Link className="btn" href="/kiosk">3 · Doorbell kiosk</Link>
            <Link className="btn" href="/demo">Split-screen demo</Link>
          </div>
        </div>
      </div>
    </>
  );
}
