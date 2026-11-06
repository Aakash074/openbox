"use client";
/**
 * Motion utilities. Durations/easings live in globals.css (--dur-1…5, --ease-standard/decel/accel);
 * everything here respects prefers-reduced-motion.
 *
 *   usePrefersReducedMotion()                → boolean (live)
 *   useReveal<T>(opts?)                      → [ref, shown]   fade-up once when scrolled into view (.reveal/.is-in)
 *   <Reveal as? delay? className?>           → wrapper that does the same
 *   useCountUp(value, { duration?, from? })  → animated number (600ms ease-out; instant under reduced motion)
 *   <CountUp value decimals? prefix? suffix? → tabular span; formats like fmtAmount by default
 *            format? from? duration?>
 *   useFlash(value, ms?)                     → true for 1.2s after `value` changes (add className "flash")
 */
import { createElement, useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode, type RefObject } from "react";

const RM = "(prefers-reduced-motion: reduce)";
export const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.(RM).matches;

export function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.(RM);
    if (!mq) return;
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** Reveal once when the element scrolls into view. Elements already in view on mount reveal immediately (with the fade). */
export function useReveal<T extends HTMLElement = HTMLDivElement>({ threshold = 0.15, rootMargin = "0px 0px -8% 0px" }: { threshold?: number; rootMargin?: string } = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold, rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, rootMargin]);
  return [ref, shown];
}

/** <Reveal>: fade-up 12px on scroll into view. `delay` (ms) staggers siblings. `as` picks the element (default div). */
/** `eager`: reveal as soon as any pixel is on screen (use for the section right below the fold). */
export function Reveal({ children, as = "div", delay = 0, className = "", style, eager, ...rest }: { children: ReactNode; as?: ElementType; delay?: number; className?: string; style?: CSSProperties; id?: string; eager?: boolean }) {
  const [ref, shown] = useReveal<HTMLElement>(eager ? { threshold: 0, rootMargin: "0px 0px 0px 0px" } : undefined);
  return createElement(as, {
    ref, className: `reveal${shown ? " is-in" : ""} ${className}`.trim(),
    style: delay ? { ...style, ["--reveal-delay" as string]: `${delay}ms` } : style, ...rest,
  }, children);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Animate a number toward `value`. First render counts from `from` (default 0); later changes count from the previous value. */
export function useCountUp(value: number | null | undefined, { duration = 600, from = 0 }: { duration?: number; from?: number } = {}) {
  const target = value == null || Number.isNaN(value) ? null : value;
  const [shown, setShown] = useState<number | null>(target == null ? null : from);
  const cur = useRef<number>(from);
  useEffect(() => {
    if (target == null) { setShown(null); return; }
    const start = cur.current;
    if (prefersReducedMotion() || start === target) { cur.current = target; setShown(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const v = start + (target - start) * easeOutCubic(t);
      cur.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
      else cur.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return shown;
}

const fmt2 = (v: number, decimals: number) => {
  const s = v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return s.startsWith("-") ? `−${s.slice(1)}` : s;
};

/** Counting number for KPIs and balances. Renders "—" for null. Screen readers get the final value (aria-label). */
export function CountUp({ value, decimals = 2, prefix = "", suffix, format, from, duration, className = "" }: {
  value?: number | string | null; decimals?: number; prefix?: string; suffix?: ReactNode; format?: (v: number) => string; from?: number; duration?: number; className?: string;
}) {
  const n = value == null || value === "" ? null : Number(value);
  const v = useCountUp(n, { from, duration });
  if (n == null || Number.isNaN(n)) return <span className={`countup ${className}`}>—</span>;
  const f = (x: number) => (format ? format(x) : fmt2(x, decimals));
  return (
    <span className={`countup tnum ${className}`}>
      <span className="sr-only">{prefix}{f(n)}</span><span aria-hidden="true">{prefix}{f(v ?? n)}</span>{suffix}
    </span>
  );
}

/** True for `ms` after `value` changes (not on first render). Use: className={useFlash(order.status) ? "flash" : ""}. */
export function useFlash(value: unknown, ms = 1200) {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  const prev = useRef(value);
  useEffect(() => {
    if (first.current) { first.current = false; prev.current = value; return; }
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    setOn(false);
    const r = requestAnimationFrame(() => setOn(true)); // re-trigger if already flashing
    const t = setTimeout(() => setOn(false), ms);
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, [value, ms]);
  return on;
}
