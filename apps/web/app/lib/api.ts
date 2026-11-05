"use client";
import { useEffect, useRef, useState } from "react";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
  return j as T;
}

/** Merchant calls go through the Next.js server proxy (holds the secret key). */
export async function merchant<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/merchant/${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
  return j as T;
}

export type ObEvent = { type: string; ref?: string; at: number; data?: any };

/** Live backend events (SSE). Calls `onEvent` for each; returns a tick counter to trigger refetches. */
export function useEvents(ref?: string, onEvent?: (e: ObEvent) => void) {
  const [tick, setTick] = useState(0);
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    const es = new EventSource(`${API}/v1/events${ref ? `?ref=${ref}` : ""}`);
    es.addEventListener("ob", (m) => {
      const e = JSON.parse((m as MessageEvent).data) as ObEvent;
      cb.current?.(e);
      setTick((t) => t + 1);
    });
    return () => es.close();
  }, [ref]);
  return tick;
}

export function usePoll<T>(fn: () => Promise<T>, deps: unknown[], ms = 0): [T | undefined, () => void, string | undefined] {
  const [v, setV] = useState<T>();
  const [err, setErr] = useState<string>();
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const run = () => fn().then((x) => live && (setV(x), setErr(undefined))).catch((e) => live && setErr(e.message));
    run();
    const t = ms ? setInterval(run, ms) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return [v, () => setN((x) => x + 1), err];
}

export const short = (a?: string | null, n = 6) => (a ? `${a.slice(0, n)}…${a.slice(-4)}` : "—");
export const usd = (v?: string | number | null) => (v == null ? "—" : `${Number(v).toFixed(2)}`);
export const isLocal = (u?: string) => !u || u.startsWith("local://");
