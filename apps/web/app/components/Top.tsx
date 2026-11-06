"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, Brand, Icon, Logo } from "./ui";

const NAV: [string, string][] = [["/merchant", "Orders"], ["/lender", "Receivables"], ["/kiosk", "Doorbell"], ["/demo", "Demo view"]];

/** Operator app bar: logo, nav with active state, environment badge, account. Hidden in ?embed=1 panes. */
export function Top({ account = "Northwind Gadgets", variant = "app" }: { account?: string; variant?: "app" | "marketing" } = {}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const store = process.env.NEXT_PUBLIC_STORE_URL;
  if (variant === "marketing") {
    return (
      <header className="app-top">
        <div className="app-top-in">
          <Brand />
          <div className="market-right">
            <a className="btn ghost sm hide-sm" href={store} target="_blank" rel="noreferrer">Demo store <Icon name="external" /></a>
            <Link className="btn sm" href="/merchant">Open dashboard</Link>
          </div>
        </div>
      </header>
    );
  }
  const links = (
    <>
      {NAV.map(([href, label]) => <Link key={href} href={href} aria-current={path?.startsWith(href) ? "page" : undefined}>{label}</Link>)}
      <a href={store} target="_blank" rel="noreferrer">Demo store <Icon name="external" /></a>
    </>
  );
  return (
    <header className="app-top">
      <div className="app-top-in">
        <Brand />
        <nav className="nav" aria-label="Main">{links}</nav>
        <div className="top-right">
          <Badge tone="neutral" title="Whitechain testnet · World ID · Hedera testnet">Testnet</Badge>
          <span className="account" title="Signed in as this merchant"><span className="avatar">{account.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>{account}</span>
          <button type="button" className="btn ghost sm menu-btn" aria-expanded={open} aria-controls="mobile-nav" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? "x" : "menu"} />
          </button>
        </div>
      </div>
      {open && <nav id="mobile-nav" className="mobile-nav" aria-label="Main">{links}</nav>}
    </header>
  );
}

/** Buyer/courier header: store or product context on the left, "Secured by OpenBox" on the right. No operator nav.
 *  `width`: the page's max-width in px (same padding), so the header lines up with the content (default 880). */
export function MiniTop({ left, width }: { left: ReactNode; width?: number }) {
  return (
    <header className="mini-top">
      <div className="mini-top-in" style={width ? { maxWidth: width } : undefined}>
        <div className="grow truncate">{left}</div>
        <span className="secured"><Icon name="lock" /> Secured by <Logo /><b>OpenBox</b></span>
      </div>
    </header>
  );
}
