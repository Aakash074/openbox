"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Badge, Brand, Icon, Logo } from "./ui";
import { ROLE_APPS, ROLE_ORDER, type Role, type RoleApp } from "./roles";

export type { Role } from "./roles";

const initials = (name: string) => name.replace(/·.*$/, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** Demo "Viewing as…" switcher in the account chip: hop between the four role apps (sample accounts, no sign-in). */
function RoleSwitcher({ app }: { app: RoleApp }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className="role-switch" ref={wrap}>
      <button ref={btn} type="button" className="account" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        aria-label={`${app.account}, ${app.label} demo account. Switch role`}>
        <span className={`avatar role-av ${app.role}`} aria-hidden="true">{initials(app.account)}</span>
        <span className="acct-text"><span className="acct-name">{app.account}</span></span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div className="role-pop" id={id}>
          <div className="role-pop-h"><span>Viewing as</span><Badge tone="neutral" dot={false}>Demo accounts</Badge></div>
          <RoleLinks current={app.role} onPick={() => setOpen(false)} />
          <div className="role-pop-f">
            <Link href="/demo" onClick={() => setOpen(false)}><Icon name="eye" /> Presenter view</Link>
            {process.env.NEXT_PUBLIC_STORE_URL && <a href={process.env.NEXT_PUBLIC_STORE_URL} target="_blank" rel="noreferrer"><Icon name="store" /> Demo store <Icon name="external" /></a>}
          </div>
        </div>
      )}
    </div>
  );
}

function RoleLinks({ current, onPick }: { current: Role; onPick?: () => void }) {
  return (
    <ul className="role-list">
      {ROLE_ORDER.map((r) => {
        const a = ROLE_APPS[r];
        return (
          <li key={r}>
            <Link href={a.home} onClick={onPick} aria-current={r === current ? "true" : undefined} className={r === current ? "on" : ""}>
              <span className={`role-ic ${r}`} aria-hidden="true"><Icon name={a.icon} /></span>
              <span className="grow"><b>{a.label}</b><small>{a.account}</small></span>
              {r === current && <Icon name="check" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Role app bar: logo + role, that role's own nav, environment badge, account chip with the demo role switcher.
 *  `current`: href of the active nav item when the path alone can't tell (e.g. /lender?view=active). Hidden in ?embed=1 panes. */
export function Top({ role = "merchant", account, current, variant = "app" }: { role?: Role; account?: string; current?: string; variant?: "app" | "marketing" } = {}) {
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
  const base = ROLE_APPS[role];
  const app = { ...base, account: account ?? base.account };
  const isOn = (href: string) => current ? current === href : href === app.home ? path === href : !!path?.startsWith(href);
  const links = app.nav.map((n) => n.external
    ? <a key={n.href} href={n.href} target="_blank" rel="noreferrer">{n.label} <Icon name="external" /></a>
    : <Link key={n.href} href={n.href} aria-current={isOn(n.href) ? "page" : undefined}>{n.label}</Link>);
  return (
    <header className="app-top">
      <div className="app-top-in">
        <span className="brand-wrap"><Brand /><span className={`app-role ${role}`}>{app.label}</span></span>
        <nav className="nav" aria-label={`${app.label} navigation`}>{links}</nav>
        <div className="top-right">
          <Badge tone="neutral" title="Whitechain testnet · World ID · Hedera testnet">Testnet</Badge>
          <RoleSwitcher app={app} />
          <button type="button" className="btn ghost sm menu-btn" aria-expanded={open} aria-controls="mobile-nav" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? "x" : "menu"} />
          </button>
        </div>
      </div>
      {open && (
        <div id="mobile-nav" className="mobile-nav">
          <nav aria-label={`${app.label} navigation`}>{links}</nav>
          <div className="mobile-roles">
            <div className="role-pop-h"><span>Viewing as</span><Badge tone="neutral" dot={false}>Demo accounts</Badge></div>
            <RoleLinks current={role} onPick={() => setOpen(false)} />
          </div>
        </div>
      )}
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
