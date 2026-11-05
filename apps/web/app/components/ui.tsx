"use client";
import { useEffect, useState } from "react";
import { api, isLocal, short, useEvents } from "../lib/api";

export function TxLink({ url, hash, label }: { url?: string; hash?: string; label?: string }) {
  if (!hash) return null;
  const text = label ?? short(hash, 8);
  if (isLocal(url)) return <code className="tx" title={hash}>{text}</code>;
  return <a className="tx" href={url} target="_blank" rel="noreferrer" title={hash}>{text} ↗</a>;
}

export function HashscanLink({ txId, url }: { txId?: string; url?: string }) {
  if (!txId) return null;
  if (!url) return <code className="tx" title="mock Hedera settlement (HEDERA_MODE=mock)">{txId}</code>;
  return <a className="tx" href={url} target="_blank" rel="noreferrer">{txId} ↗ HashScan</a>;
}

export function Pill({ s }: { s?: string | null }) {
  return <span className={`pill pill-${(s ?? "none").replace(/[^a-z_]/g, "")}`}>{(s ?? "—").replace(/_/g, " ")}</span>;
}

/** Live balance strip: buyer · courier · seller · lender, refreshed on every on-chain event. */
export function BalanceStrip({ refId }: { refId?: string }) {
  const tick = useEvents(undefined, undefined);
  const [b, setB] = useState<any>();
  const [flash, setFlash] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api("GET", `/v1/demo/balances${refId ? `?ref=${refId}` : ""}`).then((nb) => {
      setB((old: any) => {
        if (old) {
          const f: Record<string, boolean> = {};
          nb.parties.forEach((p: any, i: number) => { if (old.parties[i]?.usdt !== p.usdt) f[p.role] = true; });
          setFlash(f);
          setTimeout(() => setFlash({}), 1200);
        }
        return nb;
      });
    }).catch(() => {});
  }, [tick, refId]);
  if (!b) return <div className="strip">loading balances…</div>;
  return (
    <div className="strip">
      {b.parties.map((p: any) => (
        <div key={p.role} className={`bal ${flash[p.role] ? "flash" : ""}`}>
          <span className="role">{p.role}</span>
          <b>{p.usdt == null ? "—" : Number(p.usdt).toFixed(2)}</b> <small>USDT</small>
          <small className="addr">{short(p.address)}</small>
        </div>
      ))}
      <div className="bal relayer">
        <span className="role">relayer gas</span>
        <b>{Number(b.relayer.balance).toFixed(4)}</b> <small>WBT</small>
        <small className="addr">{b.ref ? `order ${b.ref}` : ""}</small>
      </div>
    </div>
  );
}
