import Link from "next/link";
import type { ReactNode } from "react";
import "./styles/landing.css";
import { Icon, Logo, type IconName } from "./components/ui";
import { Reveal } from "./components/motion";
import { CHECKOUT_SNIPPET_HTML } from "./lib/snippets";
import { Courier, Inspection, MoneySplit, Parcel, ProofPath, RoleTile, type Role } from "./components/art";

const STEPS: { title: string; body: string; art: ReactNode; tag: string; note?: string }[] = [
  { tag: "Checkout", title: "Buyer pays, the money is held", body: "One signature in USDT. No wallet popup, no gas. The payment is held for that one order, not sent to the seller.", art: <Parcel variant="closed" size={112} /> },
  { tag: "Dispatch", title: "A verified courier carries it", body: "The courier is bound to the order with World ID at pickup, and the same person must check in again at the door.", note: "Simulated in the hosted demo", art: <Courier verified size={112} /> },
  { tag: "At the door", title: "The box is opened on camera", body: "The doorbell reads the parcel QR. An independent AI inspector checks the serial, and the verdict is logged on Hedera.", art: <Inspection size={148} /> },
  { tag: "Settlement", title: "Everyone is paid in one call", body: "Right item: seller and courier are paid. Wrong item: the buyer is refunded and the courier still gets their fee.", art: <Parcel variant="open" size={112} /> },
];

const ROLES: { role: Role; title: string; body: string; href: string; cta: string; external?: boolean }[] = [
  { role: "merchant", title: "Merchants", body: "Pack, dispatch and track every order, see each verdict, and get paid early on orders in transit.", href: "/merchant", cta: "Open the merchant app" },
  { role: "buyer", title: "Households", body: "Your doorbell agent checks every parcel and pays the inspector. Refunds for damage wait for your World ID approval.", href: "/home", cta: "Open the household app" },
  { role: "courier", title: "Couriers", body: "Get paid for an honest handover, even when the seller shipped the wrong item.", href: "/courier", cta: "Open the courier app" },
  { role: "lender", title: "Lenders", body: "Buy paid orders as receivable notes. Repaid automatically at verified delivery.", href: "/lender", cta: "Open the lender desk" },
];

const TRUST: [IconName, string][] = [["coins", "USDT on Whitechain"], ["user-check", "World ID"], ["shield-check", "Audit log on Hedera"]];

/** Tiny static highlighter for the integration snippet: comments, strings, the SDK global and calls. */
function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\/\/[^\n]*)|("[^"\n]*")|\b(OpenBox)\b|\b(mount|markPaid|onPaid)\b/g;
  let last = 0, k = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : "f";
    out.push(<span key={k++} className={cls}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}

export default function Home() {
  const store = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:5174";
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">Skip to content</a>
      <section className="lp-hero surface-hero theme-dark">
        <header className="lp-nav">
          <Link href="/" className="lp-brand" aria-label="OpenBox home"><Logo size={28} variant="dark" /><span>OpenBox</span></Link>
          <nav aria-label="Sections" className="lp-links">
            <a href="#how">How it works</a>
            <a href="#money">Where the money goes</a>
            <a href="#developers">Developers</a>
          </nav>
          <div className="lp-nav-right">
            <a className="lp-ghost hide-sm" href={store} target="_blank" rel="noreferrer">Demo store <Icon name="external" /></a>
            <Link className="btn sm lp-btn-glass" href="/merchant">Open the apps</Link>
          </div>
        </header>

        <div className="lp-hero-in" id="main">
          <div className="lp-copy">
            <span className="lp-pill"><span className="lp-pill-dot" aria-hidden="true" />Checkout with verified release</span>
            <h1 className="t-display lp-h1">Get paid when the right box arrives</h1>
            <p className="lp-lede">OpenBox holds the buyer&apos;s payment until the parcel is checked at the door. Sellers are paid for what they ship, couriers for honest handovers, and buyers get their money back if it isn&apos;t what they ordered.</p>
            <div className="lp-cta">
              <Link className="btn primary lg lp-primary" href="/demo"><Icon name="eye" /> Watch the live demo</Link>
              <a className="btn lg lp-secondary" href={store} target="_blank" rel="noreferrer">Try the demo store <Icon name="external" /></a>
            </div>
            <p className="lp-cta-note only-mobile">The live demo is a split screen: open it on a laptop.</p>
            <ul className="lp-trust" aria-label="Built on">
              {TRUST.map(([icon, label]) => <li key={label}><Icon name={icon} />{label}</li>)}
            </ul>
          </div>
          <div className="lp-visual">
            <div className="lp-visual-card">
              <div className="lp-visual-bar"><span className="lp-dot" /><span>Order OB-7A31C2</span><span className="lp-visual-amt">5.80 USDT</span></div>
              <ProofPath orientation="horizontal" size="100%" className="lp-pp-h" />
              <ProofPath orientation="vertical" size="100%" className="lp-pp-v" />
            </div>
          </div>
        </div>
      </section>

      <main>
        <section className="lp-section" aria-labelledby="how">
          <Reveal eager className="lp-head">
            <span className="eyebrow">How it works</span>
            <h2 id="how" className="lp-h2">Cash on delivery, without the cash</h2>
            <p className="lp-sub">Four steps between &ldquo;Pay&rdquo; and &ldquo;Paid&rdquo;. Each one leaves a receipt anyone can check.</p>
          </Reveal>
          <ol className="lp-steps">
            {STEPS.map((s, i) => (
              <Reveal eager as="li" key={s.title} delay={i * 80} className="lp-step">
                <div className="lp-step-art" aria-hidden="true">{s.art}</div>
                <div className="lp-step-n" aria-hidden="true">{i + 1}</div>
                <div className="lp-step-body">
                  <div className="lp-step-tag">{s.tag}</div>
                  <h3 className="t-h3">{s.title}</h3>
                  <p>{s.body}</p>
                  {s.note && <p className="lp-step-note"><Icon name="flask" />{s.note}</p>}
                </div>
              </Reveal>
            ))}
          </ol>
        </section>

        <section className="lp-section lp-money" aria-labelledby="money">
          <div className="lp-money-in">
            <Reveal className="lp-head lp-head-left">
              <span className="eyebrow">Where the money goes</span>
              <h2 id="money" className="lp-h2">The verdict decides who gets paid</h2>
              <p className="lp-sub">One <code>settle</code> call on Whitechain splits the held payment by what the inspector saw. Nobody has to trust the other side.</p>
              <ul className="lp-outcomes">
                <li><span className="lp-o lp-o-ok" />Match: seller paid in full, courier gets the delivery fee</li>
                <li><span className="lp-o lp-o-bad" />Wrong item: buyer refunded, courier still paid for an honest delivery</li>
                <li><span className="lp-o lp-o-warn" />Damaged: a partial refund, approved by the buyer with World ID</li>
              </ul>
            </Reveal>
            <Reveal className="lp-split" delay={120}>
              <div className="lp-split-scroll" tabIndex={0} aria-label="Settlement diagram (scrolls sideways)">
                <MoneySplit size="100%" />
              </div>
              <p className="lp-split-hint only-mobile"><Icon name="arrow-right" /> Swipe to see all three outcomes</p>
            </Reveal>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="parties">
          <Reveal className="lp-head">
            <span className="eyebrow">Built for every party</span>
            <h2 id="parties" className="lp-h2">One order, four people who need to trust it</h2>
          </Reveal>
          <div className="lp-roles">
            {ROLES.map((r, i) => {
              const href = r.href === "STORE" ? store : r.href;
              const inner = (
                <>
                  <RoleTile role={r.role} size="100%" />
                  <div className="lp-role-body">
                    <h3 className="t-h3">{r.title}</h3>
                    <p>{r.body}</p>
                    <span className="lp-role-cta">{r.cta} <Icon name={r.external ? "external" : "arrow-right"} /></span>
                  </div>
                </>
              );
              return (
                <Reveal key={r.role} delay={i * 80} className="lp-role-wrap">
                  {r.external
                    ? <a className="lp-role" href={href} target="_blank" rel="noreferrer">{inner}</a>
                    : <Link className="lp-role" href={href}>{inner}</Link>}
                </Reveal>
              );
            })}
          </div>
        </section>

        <section className="lp-dev surface-hero" aria-labelledby="developers">
          <div className="lp-dev-in">
            <Reveal className="lp-dev-copy">
              <span className="eyebrow lp-eyebrow-dark">For developers</span>
              <h2 id="developers" className="lp-h2">Drop it into any store in about 20 lines</h2>
              <p>Northwind Gadgets, our demo store, is a separate site. Its OpenBox integration is one script, one element and one call. Signed webhooks tell your backend when to ship and when you&apos;ve been paid.</p>
              <ul className="lp-dev-list">
                <li><Icon name="check" /><span>Prices come from your catalogue, never the browser</span></li>
                <li><Icon name="check" /><span>HMAC-signed webhooks: <code>order.paid</code>, <code>order.settled</code>, <code>buyer.refunded</code></span></li>
                <li><Icon name="check" /><span>On-chain receipt for every payout</span></li>
              </ul>
              <a className="btn lg lp-secondary" href={`${store}/?dev=1`} target="_blank" rel="noreferrer"><Icon name="code" /> See it live in the store</a>
            </Reveal>
            <Reveal className="lp-code" delay={120}>
              <div className="lp-code-bar"><span className="lp-code-dots" aria-hidden="true"><i /><i /><i /></span><span>checkout.html</span></div>
              <pre tabIndex={0} role="region" aria-label="Example integration code (scrolls sideways)"><code>{highlight(CHECKOUT_SNIPPET_HTML)}</code></pre>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-foot-in">
          <div className="lp-foot-brand">
            <Link href="/" className="lp-brand lp-brand-light"><Logo size={24} /><span>OpenBox</span></Link>
            <p>Checkout with verified release. Settled in USDT on Whitechain, refunds approved with World ID, inspections logged on Hedera.</p>
          </div>
          <nav className="lp-foot-cols" aria-label="Footer">
            <div><h4>Try it</h4><Link href="/demo">Live demo</Link><a href={store} target="_blank" rel="noreferrer">Demo store</a><Link href="/kiosk">Doorbell screen</Link></div>
            <div><h4>Role apps</h4><Link href="/merchant">Merchant</Link><Link href="/home">Household</Link><Link href="/courier">Courier</Link><Link href="/lender">Lender</Link></div>
          </nav>
        </div>
        <div className="lp-foot-base">
          <span>Testnet demo · no real funds. In this demo the courier World ID check runs in simulation; buyer approvals use World ID Agent Pass.</span>
        </div>
      </footer>
    </div>
  );
}
