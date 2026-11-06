import Link from "next/link";
import { Top } from "./components/Top";
import { Icon, type IconName } from "./components/ui";

const HOW: [IconName, string, string][] = [
  ["lock", "Buyer pays", "The payment is held, not sent to the seller. No crypto wallet or fees to set up."],
  ["truck", "Courier verified", "The same World ID-verified courier must collect and deliver the parcel."],
  ["camera", "Box inspected", "At the door, an independent inspector checks the item against the order."],
  ["check-circle", "Settled", "Seller and courier are paid, or the buyer is refunded, in one step."],
];

export default function Home() {
  const store = process.env.NEXT_PUBLIC_STORE_URL;
  return (
    <>
      <Top variant="marketing" />
      <main>
        <section className="hero">
          <span className="badge brand nodot">Checkout with verified release</span>
          <h1 style={{ marginTop: 16 }}>Get paid when the right box arrives</h1>
          <p>OpenBox holds the buyer&apos;s payment until delivery is verified at the door. Sellers get paid for what they ship, couriers for honest handovers, and buyers get their money back if it isn&apos;t what they ordered.</p>
          <div className="cta">
            <a className="btn primary lg" href={store} target="_blank" rel="noreferrer">Try the demo store <Icon name="external" /></a>
            <Link className="btn lg" href="/merchant">Open merchant dashboard</Link>
          </div>
          <div className="row" style={{ justifyContent: "center", marginTop: 16, gap: 16 }}>
            <Link href="/kiosk" className="small">Doorbell screen</Link>
            <Link href="/demo" className="small">Split-screen demo</Link>
            <Link href="/lender" className="small">Receivables for lenders</Link>
          </div>
        </section>
        <section aria-labelledby="how">
          <h2 id="how" className="sr-only">How it works</h2>
          <div className="how">
            {HOW.map(([icon, title, body], i) => (
              <div key={title} className="card">
                <div className="n"><Icon name={icon} /></div>
                <div className="xs muted">Step {i + 1}</div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </section>
        <footer className="foot">
          <span>Settled in USDT on Whitechain · Couriers verified with World ID · Inspections logged on Hedera</span>
          <span>Testnet demo</span>
        </footer>
      </main>
    </>
  );
}
