import Link from "next/link";

export function Top({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="top">
      <div className="row"><h1>📦 OpenBox</h1><span className="muted">· {title}</span>{sub && <span className="muted small">{sub}</span>}</div>
      <nav>
        <Link href="/merchant">Merchant</Link>
        <Link href="/kiosk">Doorbell</Link>
        <Link href="/demo">Demo view</Link>
        <a href={process.env.NEXT_PUBLIC_STORE_URL} target="_blank" rel="noreferrer">Demo store ↗</a>
      </nav>
    </div>
  );
}
