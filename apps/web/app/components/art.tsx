"use client";
/**
 * OpenBox illustration library: hand-authored inline SVG, no image requests.
 *
 * Style: 2-tone 3/4 view, 1.5px strokes, soft ground shadow, gloss on screens. Every colour is a CSS variable
 * (--art-*, defined in globals.css) with a hard-coded fallback, so the art re-themes inside `.theme-dark` / `.kiosk`
 * and still renders outside the app. Decorative by default (aria-hidden); pass `title` to expose it as role="img".
 *
 * Common props (ArtProps): size (px width; height follows the aspect ratio; default per component),
 * className, title (accessible label → role="img"), style.
 */
import { useId, type CSSProperties, type ReactNode } from "react";

/* ─── palette (CSS var + fallback) ───────────────────────────────────────────────────────── */
const v = (name: string, fallback: string) => `var(--art-${name}, ${fallback})`;
export const ART = {
  ink: v("ink", "#0B1220"), line: v("line", "#1E293B"), body: v("body", "#1E2A44"), body2: v("body-2", "#2C3B5C"),
  paper: v("paper", "#FFFFFF"), fill: v("fill", "#E8EDF3"), fill2: v("fill-2", "#CBD5E1"), fill3: v("fill-3", "#94A3B8"),
  brand: v("brand", "#0D9488"), brand2: v("brand-2", "#5EEAD4"), brand3: v("brand-3", "#0F766E"), brand50: v("brand-50", "#CCFBF1"),
  proof: v("proof", "#6366F1"), proof2: v("proof-2", "#C7D2FE"), accent: v("accent", "#F5B544"), info: v("info", "#2E90FA"), danger: v("danger", "#E5484D"),
  kraft: v("kraft", "#DDA86B"), kraft2: v("kraft-2", "#C88D4E"), kraft3: v("kraft-3", "#EDC48F"), kraftIn: v("kraft-in", "#A87038"),
  screenA: v("screen-a", "#0F766E"), screenB: v("screen-b", "#4338CA"), glow: v("glow", "#5EEAD4"),
  shadow: v("shadow", "rgb(11 18 32 / .14)"), tile: v("tile", "#FFFFFF"), tileBd: v("tile-bd", "#E4E7EC"), disc: v("disc", "#EEF2F6"),
  text: v("text", "#344054"), text2: v("text-2", "#667085"), path: v("path", "#0D9488"), skin: v("skin", "#D9A07A"),
  soap: v("soap", "#F6C9D8"), soap2: v("soap-2", "#E7A3BC"),
};
const C = ART;
const MONO = "var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
const SANS = "var(--font, Inter, system-ui, sans-serif)";

export type ArtProps = { size?: number | string; className?: string; title?: string; style?: CSSProperties };

/** Stable, CSS-safe ids for gradients (one set per instance, so hidden copies never break visible ones). */
function useUid() {
  return "a" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

function Svg({ w, h, size, className = "", title, style, children, defaultSize }: ArtProps & { w: number; h: number; children: ReactNode; defaultSize: number }) {
  const s = size ?? defaultSize;
  const a11y = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const, focusable: "false" as const };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={s} height={typeof s === "number" ? Math.round((s * h) / w) : undefined}
      className={`art ${className}`} style={style} fill="none" strokeLinecap="round" strokeLinejoin="round" {...a11y}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/** Soft elliptical ground shadow. */
function Ground({ id, cx, cy, rx, ry }: { id: string; cx: number; cy: number; rx: number; ry: number }) {
  return (
    <>
      <defs>
        <radialGradient id={`${id}-gs`}>
          <stop offset="0" stopColor={C.shadow} />
          <stop offset="1" stopColor={C.shadow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id}-gs)`} />
    </>
  );
}

/** Screen gradient + gloss defs. Use fill={`url(#${id}-scr)`} and `url(#${id}-gl)`. */
function ScreenDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-scr`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={C.screenA} />
        <stop offset="1" stopColor={C.screenB} />
      </linearGradient>
      <linearGradient id={`${id}-gl`} x1="0" y1="0" x2=".7" y2=".8">
        <stop offset="0" stopColor="#fff" stopOpacity=".34" />
        <stop offset=".5" stopColor="#fff" stopOpacity=".06" />
        <stop offset=".5" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id={`${id}-au`} cx=".3" cy=".75" r=".7">
        <stop offset="0" stopColor={C.glow} stopOpacity=".75" />
        <stop offset="1" stopColor={C.glow} stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/* ═══ 1 · Products ═══════════════════════════════════════════════════════════════════════════ */
export type ProductKind = "aurora-x1" | "pixelbuds" | "lumen-tab";

/** Map a SKU or product name ("Aurora X1 Smartphone", "PixelBuds Pro", "Lumen Tab 11", "pixelbuds" …) to an art kind. */
export function productArt(skuOrName?: string | null): ProductKind | null {
  const s = (skuOrName ?? "").toLowerCase();
  if (!s) return null;
  if (/aurora|x1|phone/.test(s)) return "aurora-x1";
  if (/pixel ?buds|buds|earbud|audio/.test(s)) return "pixelbuds";
  if (/lumen|tab|tablet/.test(s)) return "lumen-tab";
  return null;
}

function PhoneArt({ id }: { id: string }) {
  return (
    <>
      <ScreenDefs id={id} />
      <defs>
        <linearGradient id={`${id}-bk`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={C.body2} />
          <stop offset="1" stopColor={C.body} />
        </linearGradient>
      </defs>
      <Ground id={id} cx={62} cy={106} rx={42} ry={6} />
      {/* back of a second phone: camera bump */}
      <g transform="rotate(-14 44 60)">
        <rect x="22" y="16" width="40" height="84" rx="9" fill={C.ink} />
        <rect x="20" y="15" width="40" height="84" rx="9" fill={`url(#${id}-bk)`} />
        <rect x="25" y="20" width="19" height="20" rx="6" fill={C.body} stroke={C.fill3} strokeOpacity=".35" strokeWidth="1" />
        <circle cx="31" cy="26" r="3.6" fill={C.ink} stroke={C.fill3} strokeWidth="1.2" />
        <circle cx="31" cy="34.2" r="3.6" fill={C.ink} stroke={C.fill3} strokeWidth="1.2" />
        <circle cx="38.6" cy="30" r="2.6" fill={C.ink} stroke={C.fill3} strokeWidth="1" />
        <circle cx="39" cy="23.6" r="1.1" fill={C.accent} />
        <circle cx="31" cy="26" r="1.2" fill={C.screenB} opacity=".9" />
        <circle cx="31" cy="34.2" r="1.2" fill={C.screenB} opacity=".9" />
      </g>
      {/* front phone */}
      <rect x="51" y="14" width="44" height="90" rx="10" fill={C.ink} />
      <rect x="48" y="13" width="44" height="90" rx="10" fill={C.body} />
      <rect x="51" y="16" width="38" height="84" rx="7.5" fill={`url(#${id}-scr)`} />
      <rect x="51" y="16" width="38" height="84" rx="7.5" fill={`url(#${id}-au)`} />
      <path d="M51 74c9-6 17-4 24-9s9-12 14-13v34a7.5 7.5 0 0 1-7.5 7.5H58.5A7.5 7.5 0 0 1 51 92z" fill={C.glow} opacity=".22" />
      <path d="M51 84c10-5 20-2 28-7 4-2.5 7-5 10-5v20.5a7.5 7.5 0 0 1-7.5 7.5H58.5A7.5 7.5 0 0 1 51 92.5z" fill={C.glow} opacity=".28" />
      <rect x="51" y="16" width="38" height="84" rx="7.5" fill={`url(#${id}-gl)`} />
      <rect x="63.5" y="19.5" width="13" height="3.6" rx="1.8" fill={C.ink} />
      <rect x="58" y="31" width="14" height="3" rx="1.5" fill="#fff" opacity=".85" />
      <rect x="58" y="37" width="22" height="2" rx="1" fill="#fff" opacity=".45" />
      <rect x="62" y="94" width="16" height="1.6" rx=".8" fill="#fff" opacity=".7" />
      <path d="M92 32v10" stroke={C.fill3} strokeWidth="1.5" />
    </>
  );
}

function Bud({ x, y, r = 0, s = 1 }: { x: number; y: number; r?: number; s?: number }) {
  // One earbud in 3/4: rounded body with a light touch-pad and a short stem; eartip in the same light tone.
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      <path d="M-2 4c0 6 1 11 3 14 1.6 2.2 4.6 1.4 4.8-1.2.2-3-.4-8-.8-12.8z" fill={C.paper} stroke={C.fill3} strokeOpacity=".7" strokeWidth="1.2" />
      <ellipse cx="0" cy="0" rx="9" ry="7.6" fill={C.paper} stroke={C.fill3} strokeOpacity=".7" strokeWidth="1.2" />
      <ellipse cx="-1" cy="-.6" rx="5.6" ry="4.4" fill={C.brand50} />
      <ellipse cx="-2.4" cy="-2.2" rx="2.2" ry="1.2" fill="#fff" />
      <path d="M7.6 3.4c2.6.4 4.4 2.4 4 4.8-.4 2-2.6 3-4.8 2.4" fill={C.fill} stroke={C.fill3} strokeOpacity=".7" strokeWidth="1.2" />
    </g>
  );
}

function BudsArt({ id }: { id: string }) {
  // Open charging case, lid hinged back, one bud seated and one lying outside in front: deliberately asymmetric
  // so it never reads as a face.
  return (
    <>
      <defs>
        <linearGradient id={`${id}-case`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={C.paper} />
          <stop offset=".6" stopColor={C.paper} />
          <stop offset="1" stopColor={C.fill2} />
        </linearGradient>
        <linearGradient id={`${id}-lid`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.fill} />
          <stop offset="1" stopColor={C.fill2} />
        </linearGradient>
      </defs>
      <Ground id={id} cx={58} cy={103} rx={48} ry={6} />
      {/* lid, opened back */}
      <path d="M20 58c0-14 16-26 36-26s36 12 36 26z" fill={C.paper} stroke={C.fill3} strokeOpacity=".7" strokeWidth="1.5" />
      <path d="M26 57c1-10 14-19 30-19s29 9 30 19z" fill={`url(#${id}-lid)`} />
      <path d="M33 50c4-5 10-8 17-9" stroke="#fff" strokeOpacity=".8" strokeWidth="2" />
      {/* tray with one empty cradle and one occupied */}
      <ellipse cx="56" cy="60" rx="36" ry="10" fill={C.fill} stroke={C.fill3} strokeOpacity=".7" strokeWidth="1.5" />
      <ellipse cx="42" cy="60.5" rx="10" ry="4.6" fill={C.fill2} />
      <ellipse cx="69" cy="60.5" rx="10" ry="4.6" fill={C.fill2} />
      <ellipse cx="69" cy="61" rx="6" ry="2.4" fill={C.fill3} opacity=".5" />
      <Bud x={41} y={55} r={-24} s={0.85} />
      {/* case body over the seated stem */}
      <path d="M20 60c0 5.5 16 10 36 10s36-4.5 36-10v12c0 15-15 24-36 24S20 87 20 72z" fill={`url(#${id}-case)`} stroke={C.fill3} strokeOpacity=".7" strokeWidth="1.5" />
      <path d="M20 60c0 5.5 16 10 36 10s36-4.5 36-10" stroke={C.fill3} strokeOpacity=".5" strokeWidth="1.5" />
      <path d="M27 77c4 7 13 11 24 11.5" stroke="#fff" strokeWidth="2.2" opacity=".9" />
      <circle cx="56" cy="80" r="1.6" fill={C.brand2} />
      {/* second bud lying outside, front right */}
      <Bud x={96} y={88} r={62} s={1} />
    </>
  );
}

function TabletArt({ id }: { id: string }) {
  return (
    <>
      <ScreenDefs id={id} />
      <Ground id={id} cx={60} cy={102} rx={50} ry={6} />
      <g transform="translate(0 6) skewY(-9) translate(0 9)">
        <rect x="15" y="30" width="90" height="62" rx="8" fill={C.ink} />
        <rect x="12" y="27" width="90" height="62" rx="8" fill={C.body} />
        <rect x="16.5" y="31.5" width="81" height="53" rx="4.5" fill={`url(#${id}-scr)`} />
        <rect x="16.5" y="31.5" width="81" height="53" rx="4.5" fill={`url(#${id}-au)`} />
        <path d="M16.5 72c14-8 26-2 40-9s24-14 41-10v27a4.5 4.5 0 0 1-4.5 4.5H21A4.5 4.5 0 0 1 16.5 80z" fill={C.glow} opacity=".22" />
        <rect x="23" y="38" width="22" height="3" rx="1.5" fill="#fff" opacity=".85" />
        <rect x="23" y="44" width="34" height="2" rx="1" fill="#fff" opacity=".45" />
        <rect x="23" y="49" width="28" height="2" rx="1" fill="#fff" opacity=".45" />
        <rect x="70" y="38" width="20" height="14" rx="2.5" fill="#fff" opacity=".18" />
        <rect x="16.5" y="31.5" width="81" height="53" rx="4.5" fill={`url(#${id}-gl)`} />
        <circle cx="57" cy="29.2" r="1" fill={C.fill3} />
      </g>
      {/* stylus */}
      <g transform="rotate(-24 82 96)">
        <rect x="52" y="93" width="56" height="5.4" rx="2.7" fill={C.paper} stroke={C.fill2} strokeWidth="1.2" />
        <path d="M108 93.2 116 95.7 108 98.2z" fill={C.fill2} />
        <rect x="58" y="93" width="4" height="5.4" fill={C.brand} />
        <path d="M66 94.6h30" stroke="#fff" strokeWidth="1.2" />
      </g>
    </>
  );
}

/** Product illustration. `product`: SKU or name (see productArt). variant "hero" (transparent, ground shadow) or
 *  "thumb" (rounded gradient tile, for table rows / lists at 28–56px). Unknown products fall back to a parcel. */
export function ProductArt({ product, variant = "hero", ...p }: ArtProps & { product?: string | null; variant?: "hero" | "thumb" }) {
  const id = useUid();
  const kind = productArt(product);
  const art = kind === "aurora-x1" ? <PhoneArt id={id} /> : kind === "pixelbuds" ? <BudsArt id={id} /> : kind === "lumen-tab" ? <TabletArt id={id} /> : <BoxScene id={id} variant="closed" />;
  if (variant === "thumb") {
    const s = p.size ?? 32;
    return (
      <span className={`product-tile ${p.className ?? ""}`} style={{ width: s, height: s, borderRadius: typeof s === "number" ? Math.max(6, Math.round(s * 0.22)) : 10, ...p.style }}
        {...(p.title ? { role: "img", "aria-label": p.title } : { "aria-hidden": true })}>
        <Svg w={120} h={120} size="88%" defaultSize={32}>{art}</Svg>
      </span>
    );
  }
  return <Svg w={120} h={120} defaultSize={96} {...p}>{art}</Svg>;
}

/* ═══ 3 · Parcel ═════════════════════════════════════════════════════════════════════════════ */
export type ParcelVariant = "closed" | "open" | "damaged" | "wrong";

/* Isometric box geometry (120 grid): top T(60,28) R(98,44) F(60,60) L(22,44); height 40. */
const LEFT_FACE = "M22 44 60 60 60 100 22 84Z";
const RIGHT_FACE = "M60 60 98 44 98 84 60 100Z";
const TOP_FACE = "M60 28 98 44 60 60 22 44Z";
const SILHOUETTE = "M60 28 98 44 98 84 60 100 22 84 22 44Z";

function Tick({ x, y }: { x: number; y: number }) {
  return <path d={`M${x - 2.2} ${y + 0.2}l1.6 1.5 3-3`} stroke="#fff" strokeWidth="1.3" />;
}

function QrLabel() {
  // drawn in left-face space (shear y += .421x): face spans x 22–60, y 34.7–74.7
  return (
    <g transform="matrix(1 .421 0 1 0 0)">
      <rect x="27" y="46" width="24" height="17" rx="1.5" fill="#fff" />
      <rect x="29" y="48" width="5" height="5" fill="none" stroke={C.ink} strokeWidth="1.3" strokeLinecap="square" />
      <rect x="29" y="56" width="5" height="5" fill="none" stroke={C.ink} strokeWidth="1.3" strokeLinecap="square" />
      <rect x="36" y="48" width="5" height="5" fill="none" stroke={C.ink} strokeWidth="1.3" strokeLinecap="square" />
      <path d="M36.5 56.5h1.5v1.5h-1.5zM39.5 58.5h1.5v2.5h-1.5zM36.5 59.5h1.5v1.5h-1.5z" fill={C.ink} />
      <path d="M44 49h5M44 52h4M44 55h5M44 58h3" stroke={C.fill3} strokeWidth="1.2" />
    </g>
  );
}

function ClosedBox({ tape = true, label = true }: { tape?: boolean; label?: boolean }) {
  return (
    <>
      <path d={LEFT_FACE} fill={C.kraft} />
      <path d={RIGHT_FACE} fill={C.kraft2} />
      <path d={TOP_FACE} fill={C.kraft3} />
      {tape && (
        <>
          <path d="M36.4 37.9 45.6 34.1 83.6 50.1 74.4 53.9Z" fill={C.brand} />
          <path d="M74.4 53.9 83.6 50.1 83.6 66 74.4 69.8Z" fill={C.brand3} />
          <path d="M41.5 35.9 79.5 51.9" stroke="#fff" strokeOpacity=".25" strokeWidth="1" />
          <Tick x={52} y={40.6} /><Tick x={66} y={46.4} />
        </>
      )}
      {label && <QrLabel />}
      <path d="M22 44 60 60 98 44M60 60v40" stroke={C.kraftIn} strokeOpacity=".45" strokeWidth="1.5" />
      <path d={SILHOUETTE} stroke={C.kraftIn} strokeWidth="1.5" />
    </>
  );
}

function OpenBox({ item }: { item: "product" | "soap" | "none" }) {
  // interior first, then the item, then front faces + flaps over it
  return (
    <>
      {/* back flaps */}
      <path d="M22 44 60 28 50 10 13 26Z" fill={C.kraft2} stroke={C.kraftIn} strokeWidth="1.5" />
      <path d="M60 28 98 44 108 27 70 11Z" fill={C.kraft3} stroke={C.kraftIn} strokeWidth="1.5" />
      {/* opening */}
      <path d={TOP_FACE} fill={C.kraftIn} />
      <path d="M22 44 60 28 60 46 22 62Z" fill={C.kraft2} />
      <path d="M60 28 98 44 98 62 60 46Z" fill={C.kraft} />
      {item === "product" && (
        <g transform="rotate(14 60 40)">
          <rect x="49" y="18" width="22" height="42" rx="5" fill={C.body} />
          <rect x="51" y="20" width="18" height="38" rx="3.5" fill={C.screenA} />
          <path d="M51 20h18v18L51 52z" fill="#fff" opacity=".18" />
          <rect x="57" y="21.5" width="6" height="1.8" rx=".9" fill={C.ink} />
        </g>
      )}
      {item === "soap" && (
        <g>
          <path d="M42 46 62 38 80 45 60 53Z" fill={C.soap} />
          <path d="M42 46v6l18 7v-6zM60 53v6l20-8v-6z" fill={C.soap2} />
          <path d="M49 45.5c4-2 9-3.5 14-3" stroke="#fff" strokeOpacity=".8" strokeWidth="1.5" />
          <circle cx="70" cy="34" r="3" fill="#fff" stroke={C.fill3} strokeWidth="1.2" />
          <circle cx="77" cy="28" r="2" fill="#fff" stroke={C.fill3} strokeWidth="1.2" />
          <circle cx="64" cy="27" r="1.6" fill="#fff" stroke={C.fill3} strokeWidth="1.2" />
        </g>
      )}
      {/* front faces */}
      <path d={LEFT_FACE} fill={C.kraft} />
      <path d={RIGHT_FACE} fill={C.kraft2} />
      {/* front flaps folded out */}
      <path d="M22 44 60 60 52 76 13 59Z" fill={C.kraft3} stroke={C.kraftIn} strokeWidth="1.5" />
      <path d="M60 60 98 44 107 59 68 76Z" fill={C.kraft} stroke={C.kraftIn} strokeWidth="1.5" />
      <path d="M60 76v24" stroke={C.kraftIn} strokeOpacity=".45" strokeWidth="1.5" />
      <path d="M22 59v25l38 16 38-16V59" stroke={C.kraftIn} strokeWidth="1.5" />
    </>
  );
}

function DamagedBox() {
  return (
    <>
      <ClosedBox label={false} />
      {/* crushed front corner */}
      <path d="M60 60 52 56.6 54 66 60 71 66 66 68 56.6Z" fill={C.kraftIn} opacity=".55" />
      <path d="M52 56.6 54 66 60 71 66 66 68 56.6" stroke={C.kraftIn} strokeWidth="1.5" />
      {/* cracks */}
      <path d="M30 60l5 4-2 5 6 3-1 6" stroke={C.ink} strokeOpacity=".55" strokeWidth="1.5" />
      <path d="M86 58l-4 6 3 4-5 5 2 6" stroke={C.ink} strokeOpacity=".55" strokeWidth="1.5" />
      {/* torn tape flap */}
      <path d="M74.4 69.8 83.6 66 86 72 77 74Z" fill={C.brand3} />
      {/* debris */}
      <path d="M102 88l4 1M100 94l5 3M16 90l-4 2" stroke={C.kraftIn} strokeWidth="1.5" />
      <g transform="translate(92 22)">
        <circle r="9" fill={C.accent} />
        <path d="M0-4.2v4.6M0 3.4v.1" stroke={C.ink} strokeWidth="2" />
      </g>
    </>
  );
}

function BoxScene({ id, variant }: { id: string; variant: ParcelVariant }) {
  return (
    <>
      <Ground id={id} cx={60} cy={102} rx={46} ry={7} />
      {variant === "closed" && <ClosedBox />}
      {variant === "open" && <OpenBox item="product" />}
      {variant === "wrong" && (
        <>
          <OpenBox item="soap" />
          <g transform="translate(96 22)">
            <circle r="9" fill={C.danger} />
            <path d="M-3 -3 3 3M3 -3-3 3" stroke="#fff" strokeWidth="2" />
          </g>
        </>
      )}
      {variant === "damaged" && <DamagedBox />}
    </>
  );
}

/** Parcel: kraft box with OpenBox tape + QR label. closed · open (item inside) · damaged (crushed, cracks) · wrong (soap bar). */
export function Parcel({ variant = "closed", ...p }: ArtProps & { variant?: ParcelVariant }) {
  const id = useUid();
  return <Svg w={120} h={120} defaultSize={96} {...p}><BoxScene id={id} variant={variant} /></Svg>;
}

/* ═══ 4 · Courier ════════════════════════════════════════════════════════════════════════════ */
/** World ID-style verified badge (indigo disc + tick). */
function VerifiedBadge({ x, y, r = 9 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r + 2.5} fill={C.proof2} opacity=".7" />
      <circle r={r} fill={C.proof} />
      <path d={`M${-r * 0.42} 0l${r * 0.3} ${r * 0.3} ${r * 0.56} ${-r * 0.6}`} stroke="#fff" strokeWidth={Math.max(1.6, r * 0.2)} />
    </g>
  );
}

/** Courier carrying a parcel, with a World ID verified badge. */
export function Courier({ verified = true, ...p }: ArtProps & { verified?: boolean }) {
  const id = useUid();
  return (
    <Svg w={120} h={120} defaultSize={96} {...p}>
      <Ground id={id} cx={58} cy={108} rx={34} ry={5} />
      {/* legs */}
      <path d="M46 78h10l-1 28h-8z" fill={C.body} />
      <path d="M58 78h10l1 28h-8z" fill={C.body2} />
      <path d="M44 106h12v3H43zM60 106h12l1 3H60z" fill={C.ink} />
      {/* torso: jacket */}
      <path d="M40 52c0-6 5-10 11-10h12c6 0 11 4 11 10v30H40z" fill={C.brand} />
      <path d="M57 42v40h17V52c0-6-5-10-11-10z" fill={C.brand3} />
      <path d="M52 42l5 6 5-6" stroke={C.paper} strokeWidth="1.5" />
      <rect x="44" y="58" width="7" height="2" rx="1" fill={C.brand2} />
      {/* head + cap */}
      <rect x="54" y="35" width="6" height="7" rx="2" fill={C.skin} />
      <circle cx="57" cy="28" r="9" fill={C.skin} />
      <path d="M48 27c0-6 4-10 9-10s9 4 9 9z" fill={C.brand3} />
      <path d="M58 26h12c1 0 1 2 0 2H58z" fill={C.brand3} />
      <circle cx="61" cy="20.5" r="1.6" fill={C.brand2} />
      {/* arms + parcel */}
      <path d="M41 54c-4 4-5 12-3 18" stroke={C.brand} strokeWidth="7" />
      <path d="M73 54c4 4 4 11 2 17" stroke={C.brand3} strokeWidth="7" />
      <g transform="translate(36 54) scale(.4)">
        <ClosedBox label={false} />
      </g>
      <circle cx="40" cy="74" r="3.6" fill={C.skin} />
      <circle cx="74" cy="73" r="3.6" fill={C.skin} />
      {verified && <VerifiedBadge x={86} y={30} r={9} />}
    </Svg>
  );
}

/* ═══ 5 · Inspection ═════════════════════════════════════════════════════════════════════════ */
/** 4-point AI sparkle. */
function Sparkle({ x, y, r = 6, fill = C.accent }: { x: number; y: number; r?: number; fill?: string }) {
  const k = r * 0.28;
  return <path d={`M${x} ${y - r}C${x + k} ${y - k} ${x + k} ${y - k} ${x + r} ${y}C${x + k} ${y + k} ${x + k} ${y + k} ${x} ${y + r}C${x - k} ${y + k} ${x - k} ${y + k} ${x - r} ${y}C${x - k} ${y - k} ${x - k} ${y - k} ${x} ${y - r}Z`} fill={fill} />;
}

/** Doorbell camera framing the item: serial highlighted, AI sparkle, Hedera receipt chip. */
export function Inspection({ serial = "SN-AX1-7731-0042", product, ...p }: ArtProps & { serial?: string; product?: string | null }) {
  const id = useUid();
  const kind = productArt(product) ?? "aurora-x1";
  return (
    <Svg w={160} h={120} defaultSize={160} {...p}>
      <defs>
        <linearGradient id={`${id}-vf`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.fill} />
          <stop offset="1" stopColor={C.fill2} />
        </linearGradient>
        <clipPath id={`${id}-clip`}><rect x="10" y="8" width="140" height="100" rx="12" /></clipPath>
      </defs>
      <rect x="10" y="8" width="140" height="100" rx="12" fill={`url(#${id}-vf)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <ellipse cx="80" cy="104" rx="70" ry="14" fill={C.fill3} opacity=".35" />
        {/* the ordered item (back) lying in its open box: phone, tablet or earbuds case */}
        <g transform="translate(26 18) scale(.72)">
          <OpenBox item="none" />
        </g>
        <g transform="rotate(-8 80 56)">
          {kind === "lumen-tab" ? (
            <>
              <rect x="46" y="26" width="72" height="54" rx="7" fill={C.body} />
              <rect x="50" y="30" width="10" height="10" rx="3.5" fill={C.ink} />
              <circle cx="55" cy="35" r="2.2" fill={C.body2} stroke={C.fill3} strokeWidth=".8" />
            </>
          ) : kind === "pixelbuds" ? (
            <>
              <rect x="54" y="32" width="54" height="44" rx="20" fill={C.paper} stroke={C.fill2} strokeWidth="1.5" />
              <path d="M56 48h50" stroke={C.fill2} strokeWidth="1.3" />
              <circle cx="81" cy="42" r="1.8" fill={C.brand2} />
            </>
          ) : (
            <>
              <rect x="62" y="22" width="38" height="66" rx="8" fill={C.body} />
              <rect x="66" y="26" width="14" height="15" rx="4.5" fill={C.ink} />
              <circle cx="70.5" cy="30.5" r="2.4" fill={C.body2} stroke={C.fill3} strokeWidth=".8" />
              <circle cx="70.5" cy="36.6" r="2.4" fill={C.body2} stroke={C.fill3} strokeWidth=".8" />
            </>
          )}
          {/* serial sticker */}
          <rect x="64" y="58" width="34" height="13" rx="2" fill="#fff" />
          <path d="M66.5 61h12M66.5 64h7" stroke={C.fill3} strokeWidth="1.2" />
          <path d="M83 60.5v8M85 60.5v8M86.5 60.5v8M88.5 60.5v8M91 60.5v8M92.5 60.5v8M94.5 60.5v8" stroke={C.ink} strokeWidth=".9" strokeLinecap="butt" />
        </g>
      </g>
      {/* focus box around the serial */}
      <g transform="rotate(-8 80 56)">
        <rect x="61" y="55" width="40" height="19" rx="3" stroke={C.brand2} strokeWidth="1.5" fill={C.brand2} fillOpacity=".12" />
      </g>
      {/* readout chip */}
      <g transform="translate(16 84)">
        <rect width="92" height="17" rx="8.5" fill="#0B1220" opacity=".9" />
        <circle cx="9.5" cy="8.5" r="4.6" fill={C.brand} />
        <path d="M7.4 8.6l1.5 1.5 2.8-3" stroke="#fff" strokeWidth="1.3" />
        <text x="18" y="11.5" fontSize="7" fontFamily={MONO} fill="#fff" fontWeight="500" textLength={serial.length > 16 ? 70 : undefined}>{serial.length > 18 ? serial.slice(0, 18) : serial}</text>
      </g>
      {/* brackets */}
      <path d="M10 30V18A10 10 0 0 1 20 8h12M128 8h12a10 10 0 0 1 10 10v12M150 86v12a10 10 0 0 1-10 10h-12M32 108H20a10 10 0 0 1-10-10V86" stroke={C.brand} strokeWidth="3" />
      {/* rec dot */}
      <circle cx="22" cy="20" r="2.6" fill={C.danger} />
      <Sparkle x={118} y={26} r={7} />
      <Sparkle x={130} y={38} r={3.6} fill={C.brand2} />
      {/* Hedera receipt chip */}
      <g transform="translate(112 84)">
        <rect width="34" height="17" rx="8.5" fill={C.proof} />
        <path d="M7 8.6l1.8 1.8 3.6-3.8" stroke="#fff" strokeWidth="1.5" />
        <text x="15" y="11.6" fontSize="7" fontFamily={SANS} fontWeight="700" fill="#fff">HCS</text>
      </g>
    </Svg>
  );
}

/* ═══ Verdict check (animated) ═══════════════════════════════════════════════════════════════ */
/** Animated success (ring + tick draw) or failure (ring + cross). Static under reduced motion via the global CSS rule. */
export function VerdictCheck({ tone = "success", ...p }: ArtProps & { tone?: "success" | "refund" | "danger" }) {
  const col = tone === "success" ? v("ok", "#0D9488") : tone === "refund" ? C.info : C.danger; // ok: brand-600 on light, brand-300 on dark
  return (
    <Svg w={56} h={56} defaultSize={56} {...p}>
      <circle cx="28" cy="28" r="25" fill={col} opacity=".14" />
      <circle className="draw-ring" cx="28" cy="28" r="25" stroke={col} strokeWidth="3" pathLength={160} transform="rotate(-90 28 28)" />
      {tone === "danger"
        ? <path className="draw-tick" d="M20 20l16 16M36 20 20 36" stroke={col} strokeWidth="3.5" pathLength={48} />
        : <path className="draw-tick" d="M17 29l7.5 7.5L40 21" stroke={col} strokeWidth="3.5" pathLength={48} />}
    </Svg>
  );
}

/* ═══ 2 · ProofPath ══════════════════════════════════════════════════════════════════════════ */
function NodeTile({ x, y, children, d }: { x: number; y: number; children: ReactNode; d: number }) {
  return (
    <g className="pp-node" style={{ ["--d" as string]: `${d}ms` }}>
      <g transform={`translate(${x - 28} ${y - 28})`}>
        <rect x="0" y="2" width="56" height="56" rx="14" fill={C.shadow} opacity=".6" />
        <rect width="56" height="56" rx="14" fill={C.tile} stroke={C.tileBd} strokeWidth="1.5" />
        {children}
      </g>
    </g>
  );
}
const GlyphPay = () => (
  <g transform="translate(17 9)">
    <rect width="22" height="38" rx="5" fill={C.body} />
    <rect x="2" y="2" width="18" height="34" rx="3.5" fill={C.screenA} />
    <path d="M2 2h18v12L2 26z" fill="#fff" opacity=".15" />
    <rect x="4.5" y="25" width="13" height="6" rx="3" fill={C.brand2} />
    <text x="11" y="29.6" textAnchor="middle" fontSize="4.6" fontWeight="700" fontFamily={SANS} fill={C.ink}>Pay</text>
  </g>
);
const GlyphHeld = () => (
  <g>
    <g transform="translate(2 3) scale(.42)"><ClosedBox label={false} /></g>
    <g transform="translate(34 30)">
      <path d="M3 5V2.5a4 4 0 0 1 8 0V5" stroke={C.text} strokeWidth="1.8" />
      <rect x="0" y="5" width="14" height="11" rx="2.5" fill={C.accent} />
      <circle cx="7" cy="10.5" r="1.6" fill={C.ink} />
    </g>
  </g>
);
const GlyphCourier = () => (
  <g>
    <circle cx="25" cy="21" r="7.5" fill={C.skin} />
    <path d="M17.5 20c0-5 3.4-8.5 7.5-8.5s7.5 3.5 7.5 7.5z" fill={C.brand3} />
    <path d="M12 46c0-8 5.6-13 13-13s13 5 13 13z" fill={C.brand} />
    <VerifiedBadge x={40} y={16} r={7} />
  </g>
);
const GlyphDoor = () => (
  <g>
    <rect x="18" y="9" width="20" height="38" rx="7" fill={C.body} />
    <circle cx="28" cy="20" r="5.5" fill={C.ink} stroke={C.fill3} strokeWidth="1" />
    <circle cx="28" cy="20" r="2" fill={C.screenB} />
    <circle cx="28" cy="36" r="3.6" fill={C.brand2} />
    <path d="M9 14V9h5M47 14V9h-5M9 42v5h5M47 42v5h-5" stroke={C.brand} strokeWidth="2" />
  </g>
);
function Coin({ x, y, tone, glyph, d, dashed }: { x: number; y: number; tone: "brand" | "info"; glyph: "store" | "truck" | "return"; d: number; dashed?: boolean }) {
  const fill = tone === "brand" ? C.brand : C.info;
  return (
    <g className={dashed ? "pp-refund" : "pp-node"} style={{ ["--d" as string]: `${d}ms` }}>
      <g transform={`translate(${x} ${y})`}>
        <circle r="21" fill={fill} opacity=".16" />
        <circle r="16" fill={fill} />
        <circle r="12.5" stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" />
        {glyph === "store" && <path d="M-7-2v7h14v-7M-8.5-2l2-5h13l2 5c0 1.6-1.4 2.6-3 2.6S-.9-.6-1.2-2c-.3 1.4-1.5 2.6-3 2.6s-2.8-1-3-2.6z" stroke="#fff" strokeWidth="1.6" />}
        {glyph === "truck" && <path d="M-8-5h9v9h-9zM1-2h4l3 3v3H1M-5 7a1.8 1.8 0 1 0 0-.1M4 7a1.8 1.8 0 1 0 0-.1" stroke="#fff" strokeWidth="1.6" />}
        {glyph === "return" && <path d="M-6-1a6.5 6.5 0 1 1 1.8 5.8M-6-6v5h5" stroke="#fff" strokeWidth="1.8" />}
      </g>
    </g>
  );
}
function PPLabel({ x, y, title, sub, note, anchor = "middle" }: { x: number; y: number; title: string; sub?: string; note?: string; anchor?: "middle" | "start" }) {
  return (
    <g className="pp-node" style={{ ["--d" as string]: "0ms" }}>
      <text x={x} y={y} textAnchor={anchor} fontFamily={SANS} fontSize="13" fontWeight="600" fill={C.text}>{title}</text>
      {sub && <text x={x} y={y + 16} textAnchor={anchor} fontFamily={SANS} fontSize="11.5" fill={C.text2}>{sub}</text>}
      {note && <text x={x} y={y + 31} textAnchor={anchor} fontFamily={SANS} fontSize="10.5" fontStyle="italic" fill={C.text2}>{note}</text>}
    </g>
  );
}
const MiniParcel = () => (
  <g transform="translate(-15 -16) scale(.26)"><ClosedBox label={false} /></g>
);

/** The OpenBox story in one line: Buyer pays → held → courier verified → checked at the door → seller + courier paid
 *  (dashed refund branch to the buyer). Draws itself once, then a parcel travels the route. `orientation`
 *  "horizontal" (≥1024px) or "vertical" (mobile). `animate={false}` renders static (reduced motion is automatic). */
export function ProofPath({ orientation = "horizontal", animate = true, ...p }: ArtProps & { orientation?: "horizontal" | "vertical"; animate?: boolean }) {
  const H = orientation === "horizontal";
  const label = p.title ?? "Buyer pays; payment is held; a World ID-verified courier delivers (the courier check is simulated in the hosted demo); the parcel is checked at the door; then the seller and courier are paid, or the buyer is refunded.";
  const cls = `proof-path ${animate ? "" : "static"} ${p.className ?? ""}`;
  if (H) {
    const xs = [60, 200, 340, 480];
    const y = 96;
    const main = `M${xs[0]} ${y}H${xs[3]}`;
    const toSeller = `M${xs[3]} ${y}C560 ${y} 570 40 640 40`;
    const toCourier = `M${xs[3]} ${y}C560 ${y} 570 118 640 118`;
    const toBuyer = `M${xs[3]} ${y}C550 ${y} 560 196 640 196`;
    const route = `${main}${toSeller.slice(toSeller.indexOf("C"))}`;
    return (
      <Svg w={800} h={232} defaultSize={800} {...p} title={label} className={cls}>
        <path className="pp-line" d={main} stroke={C.path} strokeWidth="2.5" pathLength={1} />
        <path className="pp-branch" d={toSeller} stroke={C.path} strokeWidth="2.5" pathLength={1} />
        <path className="pp-branch" d={toCourier} stroke={C.path} strokeWidth="2.5" pathLength={1} />
        <g className="pp-refund"><path d={toBuyer} stroke={C.info} strokeWidth="2" strokeDasharray="5 6" /></g>
        <NodeTile x={xs[0]} y={y} d={100}><GlyphPay /></NodeTile>
        <NodeTile x={xs[1]} y={y} d={300}><GlyphHeld /></NodeTile>
        <NodeTile x={xs[2]} y={y} d={500}><GlyphCourier /></NodeTile>
        <NodeTile x={xs[3]} y={y} d={700}><GlyphDoor /></NodeTile>
        <PPLabel x={xs[0]} y={y + 52} title="Buyer pays" sub="USDT checkout" />
        <PPLabel x={xs[1]} y={y + 52} title="Payment held" sub="not sent yet" />
        <PPLabel x={xs[2]} y={y + 52} title="Courier verified" sub="World ID" note="simulated in demo" />
        <PPLabel x={xs[3]} y={y + 52} title="Checked at door" sub="logged on Hedera" />
        <Coin x={656} y={40} tone="brand" glyph="store" d={1100} />
        <Coin x={656} y={118} tone="brand" glyph="truck" d={1200} />
        <Coin x={656} y={196} tone="info" glyph="return" d={0} dashed />
        <PPLabel x={684} y={36} title="Seller paid" anchor="start" />
        <PPLabel x={684} y={114} title="Courier paid" anchor="start" />
        <g className="pp-refund"><text x={684} y={192} fontFamily={SANS} fontSize="13" fontWeight="600" fill={C.text}>Refund</text><text x={684} y={208} fontFamily={SANS} fontSize="11.5" fill={C.text2}>if it&apos;s wrong</text></g>
        {animate && <g className="pp-parcel" style={{ offsetPath: `path("${route}")` }}><MiniParcel /></g>}
      </Svg>
    );
  }
  const ys = [40, 136, 232, 328];
  const x = 44;
  const main = `M${x} ${ys[0]}V${ys[3]}`;
  const toSeller = `M${x} ${ys[3]}V420`;
  const toCourier = `M${x} ${ys[3]}C${x} 380 150 376 150 420`;
  const toBuyer = `M${x} ${ys[3]}C${x} 384 256 370 256 420`;
  const route = `${main}V420`;
  return (
    <Svg w={320} h={500} defaultSize={320} {...p} title={label} className={cls}>
      <path className="pp-line" d={main} stroke={C.path} strokeWidth="2.5" pathLength={1} />
      <path className="pp-branch" d={toSeller} stroke={C.path} strokeWidth="2.5" pathLength={1} />
      <path className="pp-branch" d={toCourier} stroke={C.path} strokeWidth="2.5" pathLength={1} />
      <g className="pp-refund"><path d={toBuyer} stroke={C.info} strokeWidth="2" strokeDasharray="5 6" /></g>
      <NodeTile x={x} y={ys[0]} d={100}><GlyphPay /></NodeTile>
      <NodeTile x={x} y={ys[1]} d={300}><GlyphHeld /></NodeTile>
      <NodeTile x={x} y={ys[2]} d={500}><GlyphCourier /></NodeTile>
      <NodeTile x={x} y={ys[3]} d={700}><GlyphDoor /></NodeTile>
      <PPLabel x={88} y={ys[0] - 2} title="Buyer pays" sub="USDT checkout" anchor="start" />
      <PPLabel x={88} y={ys[1] - 2} title="Payment held" sub="not sent yet" anchor="start" />
      <PPLabel x={88} y={ys[2] - 2} title="Courier verified" sub="World ID" note="simulated in demo" anchor="start" />
      <PPLabel x={88} y={ys[3] - 2} title="Checked at door" sub="logged on Hedera" anchor="start" />
      <Coin x={x} y={440} tone="brand" glyph="store" d={1100} />
      <Coin x={150} y={440} tone="brand" glyph="truck" d={1200} />
      <Coin x={256} y={440} tone="info" glyph="return" d={0} dashed />
      <PPLabel x={x} y={480} title="Seller paid" />
      <PPLabel x={150} y={480} title="Courier paid" />
      <g className="pp-refund"><text x={256} y={480} textAnchor="middle" fontFamily={SANS} fontSize="13" fontWeight="600" fill={C.text}>Refund</text><text x={256} y={496} textAnchor="middle" fontFamily={SANS} fontSize="11.5" fill={C.text2}>if it&apos;s wrong</text></g>
      {animate && <g className="pp-parcel" style={{ offsetPath: `path("${route}")` }}><MiniParcel /></g>}
    </Svg>
  );
}

/* ═══ 6 · MoneySplit ═════════════════════════════════════════════════════════════════════════ */
function Chip({ x, y, w, label, tone }: { x: number; y: number; w: number; label: string; tone: "success" | "danger" | "warning" }) {
  const col = tone === "success" ? C.brand : tone === "danger" ? C.danger : C.accent;
  return (
    <g transform={`translate(${x} ${y - 12})`}>
      <rect width={w} height="24" rx="12" fill={C.tile} stroke={col} strokeWidth="1.5" />
      <circle cx="13" cy="12" r="4" fill={col} />
      <text x="23" y="16.2" fontFamily={SANS} fontSize="12" fontWeight="600" fill={C.text}>{label}</text>
    </g>
  );
}
function Payee({ x, y, who, sub, tone }: { x: number; y: number; who: string; sub: string; tone: "brand" | "info" | "proof" }) {
  const col = tone === "brand" ? C.brand : tone === "info" ? C.info : C.proof;
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="10" fill={col} />
      <circle r="6.5" stroke="#fff" strokeOpacity=".45" strokeWidth="1.2" />
      <text x="18" y="-1" fontFamily={SANS} fontSize="12.5" fontWeight="600" fill={C.text}>{who}</text>
      <text x="18" y="13" fontFamily={SANS} fontSize="11" fill={C.text2}>{sub}</text>
    </g>
  );
}

/** Where the money goes: held → verified at the door → Match (seller + courier) / Wrong item (buyer refund + courier) /
 *  Damaged (partial refund, buyer approves with World ID). Meaningful: role="img" with a full description. */
export function MoneySplit(p: ArtProps) {
  const label = p.title ?? "The payment is held until the parcel is checked at the door. Match: seller and courier are paid. Wrong item: the buyer is refunded and the courier is paid. Damaged: a partial refund the buyer approves with World ID; the seller gets the rest.";
  const rows = [
    { y: 44, chip: "Match", tone: "success" as const, a: { who: "Seller", sub: "paid in full", tone: "brand" as const }, b: { who: "Courier", sub: "delivery fee", tone: "brand" as const } },
    { y: 132, chip: "Wrong item", tone: "danger" as const, a: { who: "Buyer", sub: "full refund", tone: "info" as const }, b: { who: "Courier", sub: "delivery fee", tone: "brand" as const } },
    { y: 220, chip: "Damaged", tone: "warning" as const, a: { who: "Buyer", sub: "partial refund", tone: "info" as const }, b: { who: "Seller", sub: "the rest", tone: "brand" as const } },
  ];
  return (
    <Svg w={720} h={264} defaultSize={720} {...p} title={label}>
      {/* held */}
      <g transform="translate(24 100)">
        <rect width="120" height="64" rx="14" fill={C.tile} stroke={C.tileBd} strokeWidth="1.5" />
        <g transform="translate(16 18)">
          <path d="M4 9V6a6 6 0 0 1 12 0v3" stroke={C.text} strokeWidth="2" />
          <rect x="0" y="9" width="20" height="16" rx="4" fill={C.accent} />
          <circle cx="10" cy="17" r="2.2" fill={C.ink} />
        </g>
        <text x="46" y="29" fontFamily={SANS} fontSize="13" fontWeight="600" fill={C.text}>Held</text>
        <text x="46" y="45" fontFamily={SANS} fontSize="11" fill={C.text2}>in USDT</text>
      </g>
      <path d="M144 132h40" stroke={C.path} strokeWidth="2.5" />
      {/* decision */}
      <g transform="translate(222 132)">
        <rect x="-26" y="-26" width="52" height="52" rx="10" transform="rotate(45)" fill={C.tile} stroke={C.path} strokeWidth="2" />
        <path d="M-12-6V-11h5M12-6V-11H7M-12 6v5h5M12 6v5H7" stroke={C.brand} strokeWidth="1.8" />
        <circle r="4" fill={C.brand2} />
      </g>
      <text x="222" y="190" textAnchor="middle" fontFamily={SANS} fontSize="12" fontWeight="600" fill={C.text}>Checked at</text>
      <text x="222" y="205" textAnchor="middle" fontFamily={SANS} fontSize="12" fontWeight="600" fill={C.text}>the door</text>
      {rows.map((r) => (
        <g key={r.y}>
          <path d={`M259 132C300 132 300 ${r.y} 340 ${r.y}`} stroke={C.path} strokeWidth="2" strokeOpacity={r.y === 132 ? 1 : 0.85} />
          <Chip x={340} y={r.y} w={r.chip.length * 7.2 + 34} label={r.chip} tone={r.tone} />
          <path d={`M${340 + r.chip.length * 7.2 + 34} ${r.y}H476`} stroke={C.fill2} strokeWidth="1.5" strokeDasharray="2 4" />
          <Payee x={490} y={r.y} {...r.a} />
          <Payee x={606} y={r.y} {...r.b} />
        </g>
      ))}
      {/* Agent Pass gate on the damaged row */}
      <g transform="translate(476 238)">
        <rect width="196" height="20" rx="10" fill={C.proof} fillOpacity=".12" stroke={C.proof} strokeOpacity=".5" />
        <g transform="translate(10 4)"><path d="M6 0 12 2.4V7c0 3.6-2.6 5.6-6 6.6C2.6 12.6 0 10.6 0 7V2.4z" fill={C.proof} /><path d="M3.4 6.6l1.8 1.8 3.6-3.6" stroke="#fff" strokeWidth="1.4" /></g>
        <text x="28" y="13.8" fontFamily={SANS} fontSize="10.5" fontWeight="600" fill={C.proof}>Buyer approves with World ID</text>
      </g>
    </Svg>
  );
}

/* ═══ 7 · ReceivableFlow ═════════════════════════════════════════════════════════════════════ */
/** Invoice advance: seller's paid order → ReceivableNote token → lender advances cash now → repaid automatically at
 *  verified delivery; the seller's bond backs the note. role="img". */
export function ReceivableFlow({ orientation = "auto", ...p }: ArtProps & { orientation?: "auto" | "horizontal" | "vertical" }) {
  if (orientation === "auto") {
    // Both drawn; CSS (.rf-h / .rf-v in globals.css) shows the vertical one on phones. The hidden one is display:none,
    // so assistive tech only ever meets one image.
    return <><ReceivableFlowH {...p} className={`rf-h ${p.className ?? ""}`} /><ReceivableFlowV {...p} className={`rf-v ${p.className ?? ""}`} /></>;
  }
  return orientation === "vertical" ? <ReceivableFlowV {...p} /> : <ReceivableFlowH {...p} />;
}
const RF_LABEL = "The seller's paid order becomes a receivable note. A lender buys it and advances cash now. When delivery is verified, the payout repays the lender automatically. The seller's bond backs the note.";

/** Phone layout: the asset flows down the left column; the cash advance and the repayment run along the right. */
function ReceivableFlowV(p: ArtProps) {
  const id = useUid();
  const cx = 90;
  return (
    <Svg w={360} h={444} defaultSize={320} {...p} title={p.title ?? RF_LABEL}>
      <defs>
        <linearGradient id={`${id}-hex`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={C.brand} />
          <stop offset="1" stopColor={C.proof} />
        </linearGradient>
        <marker id={`${id}-ar`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1l8 4-8 4" stroke={C.path} strokeWidth="1.8" fill="none" />
        </marker>
      </defs>
      {/* seller */}
      <g transform="translate(24 16)">
        <rect width="132" height="56" rx="14" fill={C.tile} stroke={C.tileBd} strokeWidth="1.5" />
        <path d="M18 24v14h20V24M16 24l3-8h18l3 8c0 2.4-2 3.6-4 3.6s-3.6-1.4-4-3.6c-.4 2.2-2 3.6-4 3.6s-3.6-1.4-4-3.6c-.4 2.2-2 3.6-4 3.6s-4-1.2-4-3.6z" stroke={C.brand} strokeWidth="1.8" />
        <text x="50" y="25" fontFamily={SANS} fontSize="13" fontWeight="600" fill={C.text}>Seller</text>
        <text x="50" y="40" fontFamily={SANS} fontSize="11" fill={C.text2}>ships order</text>
      </g>
      <path d={`M${cx} 74v22`} stroke={C.path} strokeWidth="2" markerEnd={`url(#${id}-ar)`} />
      {/* invoice */}
      <g transform={`translate(${cx - 30} 102)`}>
        <path d="M0 6a6 6 0 0 1 6-6h40l14 14v58a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6z" fill={C.paper} stroke={C.fill2} strokeWidth="1.5" />
        <path d="M46 0v8a6 6 0 0 0 6 6h8" fill={C.fill} stroke={C.fill2} strokeWidth="1.5" />
        <path d="M10 22h24M10 30h32M10 38h18" stroke={C.fill2} strokeWidth="2.2" />
        <rect x="10" y="50" width="40" height="16" rx="4" fill={C.brand50} />
        <text x="30" y="61.6" textAnchor="middle" fontFamily={MONO} fontSize="9" fontWeight="600" fill={C.brand3}>120.00</text>
      </g>
      <text x={cx + 44} y="146" fontFamily={SANS} fontSize="12" fontWeight="600" fill={C.text}>Paid order</text>
      <path d={`M${cx} 184v24`} stroke={C.path} strokeWidth="2" markerEnd={`url(#${id}-ar)`} />
      {/* note token */}
      <g transform={`translate(${cx} 256)`}>
        <path d="M0-40 34.6-20v40L0 40-34.6 20v-40z" fill={`url(#${id}-hex)`} />
        <path d="M0-31 26.8-15.5v31L0 31-26.8 15.5v-31z" stroke="#fff" strokeOpacity=".4" strokeWidth="1.5" />
        <path d="M-34.6-20 0-40l34.6 20" stroke="#fff" strokeOpacity=".35" strokeWidth="1.5" />
        <text x="0" y="5" textAnchor="middle" fontFamily={SANS} fontSize="15" fontWeight="700" fill="#fff">RN</text>
      </g>
      <text x={cx + 46} y="250" fontFamily={SANS} fontSize="12" fontWeight="600" fill={C.text}>Receivable note</text>
      <path d={`M${cx} 300v22`} stroke={C.path} strokeWidth="2" markerEnd={`url(#${id}-ar)`} />
      {/* lender */}
      <g transform="translate(24 330)">
        <rect width="132" height="56" rx="14" fill={C.tile} stroke={C.tileBd} strokeWidth="1.5" />
        <g transform="translate(14 17)">
          <rect width="26" height="22" rx="5" fill={C.brand} />
          <rect x="16" y="7" width="12" height="8" rx="3" fill={C.brand2} />
          <circle cx="21" cy="11" r="1.6" fill={C.ink} />
        </g>
        <text x="50" y="25" fontFamily={SANS} fontSize="13" fontWeight="600" fill={C.text}>Lender</text>
        <text x="50" y="40" fontFamily={SANS} fontSize="11" fill={C.text2}>buys the note</text>
      </g>
      {/* advance back to the seller (outer lane) */}
      <path d="M156 344H326Q338 344 338 332V56Q338 44 326 44H162" stroke={C.brand} strokeWidth="2" markerEnd={`url(#${id}-ar)`} />
      <g transform="translate(176 32)">
        <rect width="128" height="24" rx="12" fill={C.tile} stroke={C.brand} strokeWidth="1.5" />
        <text x="64" y="16.2" textAnchor="middle" fontFamily={SANS} fontSize="11.5" fontWeight="600" fill={C.text}>Cash advance now</text>
      </g>
      {/* repaid at verified delivery (inner lane) */}
      <path d="M126 268C196 268 226 274 226 296" stroke={C.info} strokeWidth="2" strokeDasharray="5 6" />
      <path d="M226 320V360Q226 372 214 372H162" stroke={C.info} strokeWidth="2" strokeDasharray="5 6" markerEnd={`url(#${id}-ar)`} />
      <g transform="translate(138 296)">
        <rect width="176" height="24" rx="12" fill={C.tile} stroke={C.info} strokeWidth="1.5" />
        <path d="M12 12.4l3 3 6-6" stroke={C.info} strokeWidth="2" />
        <text x="27" y="16.2" fontFamily={SANS} fontSize="11" fontWeight="600" fill={C.text}>Repaid at verified delivery</text>
      </g>
      {/* bond */}
      <path d={`M${cx} 386v12`} stroke={C.fill2} strokeWidth="1.5" strokeDasharray="2 4" />
      <g transform="translate(40 402)">
        <path d="M12 0 24 4.8V13.7c0 7.2-5.1 11.1-12 13.2C5.1 24.9 0 20.9 0 13.7V4.8z" fill={C.proof} fillOpacity=".14" stroke={C.proof} strokeWidth="1.5" />
        <path d="M7 13.2l3.6 3.6 6.8-6.8" stroke={C.proof} strokeWidth="2" />
        <text x="34" y="12" fontFamily={SANS} fontSize="12" fontWeight="600" fill={C.text}>Seller&apos;s bond</text>
        <text x="34" y="26" fontFamily={SANS} fontSize="11" fill={C.text2}>backs the note</text>
      </g>
    </Svg>
  );
}

function ReceivableFlowH(p: ArtProps) {
  const id = useUid();
  const label = p.title ?? RF_LABEL;
  return (
    <Svg w={640} h={236} defaultSize={640} {...p} title={label}>
      <defs>
        <linearGradient id={`${id}-hex`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={C.brand} />
          <stop offset="1" stopColor={C.proof} />
        </linearGradient>
        <marker id={`${id}-ar`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1l8 4-8 4" stroke={C.path} strokeWidth="1.8" fill="none" />
        </marker>
      </defs>
      {/* seller */}
      <g transform="translate(26 92)">
        <rect width="120" height="60" rx="14" fill={C.tile} stroke={C.tileBd} strokeWidth="1.5" />
        <path d="M18 26v14h20V26M16 26l3-8h18l3 8c0 2.4-2 3.6-4 3.6s-3.6-1.4-4-3.6c-.4 2.2-2 3.6-4 3.6s-3.6-1.4-4-3.6c-.4 2.2-2 3.6-4 3.6s-4-1.2-4-3.6z" stroke={C.brand} strokeWidth="1.8" />
        <text x="48" y="27" fontFamily={SANS} fontSize="13" fontWeight="600" fill={C.text}>Seller</text>
        <text x="48" y="42" fontFamily={SANS} fontSize="11" fill={C.text2}>ships order</text>
      </g>
      {/* bond under seller */}
      <g transform="translate(48 178)">
        <path d="M14 0 28 5.6V16c0 8.4-6 13-14 15.4C6 29 0 24.4 0 16V5.6z" fill={C.proof} fillOpacity=".14" stroke={C.proof} strokeWidth="1.5" />
        <path d="M8 15.4l4.2 4.2 8-8" stroke={C.proof} strokeWidth="2" />
        <text x="36" y="13" fontFamily={SANS} fontSize="12" fontWeight="600" fill={C.text}>Bond</text>
        <text x="36" y="27" fontFamily={SANS} fontSize="11" fill={C.text2}>backs the note</text>
      </g>
      <path d="M78 152v22" stroke={C.fill2} strokeWidth="1.5" strokeDasharray="2 4" />
      {/* invoice */}
      <path d="M146 122h30" stroke={C.path} strokeWidth="2" markerEnd={`url(#${id}-ar)`} />
      <g transform="translate(186 82)">
        <path d="M0 6a6 6 0 0 1 6-6h40l14 14v58a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6z" fill={C.paper} stroke={C.fill2} strokeWidth="1.5" />
        <path d="M46 0v8a6 6 0 0 0 6 6h8" fill={C.fill} stroke={C.fill2} strokeWidth="1.5" />
        <path d="M10 22h24M10 30h32M10 38h18" stroke={C.fill2} strokeWidth="2.2" />
        <rect x="10" y="50" width="40" height="16" rx="4" fill={C.brand50} />
        <text x="30" y="61.6" textAnchor="middle" fontFamily={MONO} fontSize="9" fontWeight="600" fill={C.brand3}>120.00</text>
      </g>
      <text x="216" y="182" textAnchor="middle" fontFamily={SANS} fontSize="12" fontWeight="600" fill={C.text}>Paid order</text>
      {/* note token */}
      <path d="M248 122h44" stroke={C.path} strokeWidth="2" markerEnd={`url(#${id}-ar)`} />
      <g transform="translate(340 122)">
        <path d="M0-40 34.6-20v40L0 40-34.6 20v-40z" fill={`url(#${id}-hex)`} />
        <path d="M0-31 26.8-15.5v31L0 31-26.8 15.5v-31z" stroke="#fff" strokeOpacity=".4" strokeWidth="1.5" />
        <path d="M-34.6-20 0-40l34.6 20" stroke="#fff" strokeOpacity=".35" strokeWidth="1.5" />
        <text x="0" y="5" textAnchor="middle" fontFamily={SANS} fontSize="15" fontWeight="700" fill="#fff">RN</text>
      </g>
      <text x="340" y="182" textAnchor="middle" fontFamily={SANS} fontSize="12" fontWeight="600" fill={C.text}>Receivable note</text>
      {/* lender */}
      <path d="M386 122h44" stroke={C.path} strokeWidth="2" markerEnd={`url(#${id}-ar)`} />
      <g transform="translate(442 92)">
        <rect width="130" height="60" rx="14" fill={C.tile} stroke={C.tileBd} strokeWidth="1.5" />
        <g transform="translate(14 18)">
          <rect width="26" height="22" rx="5" fill={C.brand} />
          <rect x="16" y="7" width="12" height="8" rx="3" fill={C.brand2} />
          <circle cx="21" cy="11" r="1.6" fill={C.ink} />
        </g>
        <text x="50" y="27" fontFamily={SANS} fontSize="13" fontWeight="600" fill={C.text}>Lender</text>
        <text x="50" y="42" fontFamily={SANS} fontSize="11" fill={C.text2}>buys the note</text>
      </g>
      {/* advance back to seller (top) */}
      <path d="M498 90C498 40 470 30 400 30H150C100 30 78 50 78 88" stroke={C.brand} strokeWidth="2" markerEnd={`url(#${id}-ar)`} />
      <g transform="translate(272 18)">
        <rect width="128" height="24" rx="12" fill={C.tile} stroke={C.brand} strokeWidth="1.5" />
        <text x="64" y="16.2" textAnchor="middle" fontFamily={SANS} fontSize="11.5" fontWeight="600" fill={C.text}>Cash advance now</text>
      </g>
      {/* repaid at verified delivery (bottom) */}
      <path d="M340 192c0 14 12 22 34 22h96c22 0 28-20 28-58" stroke={C.info} strokeWidth="2" strokeDasharray="5 6" markerEnd={`url(#${id}-ar)`} />
      <g transform="translate(358 202)">
        <rect width="190" height="24" rx="12" fill={C.tile} stroke={C.info} strokeWidth="1.5" />
        <path d="M14 12.4l3 3 6-6" stroke={C.info} strokeWidth="2" />
        <text x="30" y="16.2" fontFamily={SANS} fontSize="11.5" fontWeight="600" fill={C.text}>Repaid at verified delivery</text>
      </g>
    </Svg>
  );
}

/* ═══ 8 · Spot illustrations (empty / error states, 80–96px) ═══════════════════════════════ */
function Spot({ children, ...p }: ArtProps & { children: ReactNode }) {
  return (
    <Svg w={96} h={96} defaultSize={96} {...p}>
      <circle cx="48" cy="50" r="40" fill={C.disc} />
      {children}
    </Svg>
  );
}

/** Open, empty box (no orders yet). */
export function EmptyBox(p: ArtProps) {
  return (
    <Spot {...p}>
      <g transform="translate(14 14) scale(.58)"><OpenBox item="none" /></g>
      <Sparkle x={74} y={22} r={5} fill={C.brand2} />
      <Sparkle x={20} y={30} r={3.4} fill={C.accent} />
    </Spot>
  );
}
/** Inbox tray with a letter (no messages / receipts yet). */
export function Inbox(p: ArtProps) {
  return (
    <Spot {...p}>
      <g transform="translate(30 18) rotate(-6)">
        <rect width="36" height="26" rx="4" fill={C.paper} stroke={C.fill2} strokeWidth="1.5" />
        <path d="M2 3l16 11L34 3" stroke={C.brand} strokeWidth="1.8" />
      </g>
      <path d="M20 52h14l4 7h20l4-7h14v16a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6z" fill={C.paper} stroke={C.fill3} strokeWidth="1.5" />
      <path d="M20 52l8-14h40l8 14" stroke={C.fill3} strokeWidth="1.5" />
      <path d="M38 59h20" stroke={C.brand2} strokeWidth="2" />
    </Spot>
  );
}
/** Two endpoints and a signed event in flight (no webhook deliveries yet). */
export function Webhook(p: ArtProps) {
  return (
    <Spot {...p}>
      <rect x="12" y="34" width="26" height="30" rx="6" fill={C.paper} stroke={C.fill2} strokeWidth="1.5" />
      <path d="M18 42h14M18 48h10M18 54h12" stroke={C.fill2} strokeWidth="2" />
      <rect x="58" y="34" width="26" height="30" rx="6" fill={C.body} />
      <path d="M64 42h14" stroke={C.brand2} strokeWidth="2" />
      <path d="M64 48h9M64 54h12" stroke={C.fill3} strokeWidth="2" />
      <path d="M38 49c6-12 14-12 20 0" stroke={C.brand} strokeWidth="1.8" strokeDasharray="3 4" />
      <circle cx="48" cy="40" r="6" fill={C.brand} />
      <path d="M45.4 40l1.8 1.8 3.4-3.6" stroke="#fff" strokeWidth="1.5" />
    </Spot>
  );
}
/** Parcel under a magnifier (order not found / search). */
export function SearchParcel(p: ArtProps) {
  return (
    <Spot {...p}>
      <g transform="translate(8 16) scale(.56)"><ClosedBox /></g>
      <circle cx="62" cy="44" r="14" fill={C.brand50} fillOpacity=".55" stroke={C.line} strokeWidth="3" />
      <path d="M57 38a7 7 0 0 1 7-3" stroke="#fff" strokeWidth="2" />
      <path d="M72 55l10 10" stroke={C.line} strokeWidth="5" />
    </Spot>
  );
}
/** Cloud with a broken link (service unavailable / offline). */
export function Offline(p: ArtProps) {
  return (
    <Spot {...p}>
      <path d="M30 62a12 12 0 0 1-1-24 16 16 0 0 1 30-4 11 11 0 0 1 9 28z" fill={C.paper} stroke={C.fill3} strokeWidth="1.5" />
      <path d="M38 52h20" stroke={C.fill2} strokeWidth="2.4" />
      <path d="M26 74l44-44" stroke={C.accent} strokeWidth="2.4" />
    </Spot>
  );
}

/** Shield with a person (identity check: World ID callback). `state` "neutral" draws no tick, "error" a muted slash. */
export function IdentityShield({ state = "neutral", ...p }: ArtProps & { state?: "neutral" | "error" }) {
  return (
    <Spot {...p}>
      <path d="M48 16 72 25.6V45c0 16.8-10.2 26-24 30.8C34.2 71 24 61.8 24 45V25.6z" fill={C.paper} stroke={C.proof} strokeWidth="2" />
      <path d="M48 22.5 66 29.7V45c0 13-7.6 20.4-18 24.4-10.4-4-18-11.4-18-24.4V29.7z" fill={C.proof} fillOpacity=".1" />
      <circle cx="48" cy="40" r="7" stroke={C.proof} strokeWidth="2" />
      <path d="M36 60c2.4-6 6.8-9 12-9s9.6 3 12 9" stroke={C.proof} strokeWidth="2" />
      {state === "error" && <path d="M28 70 68 22" stroke={C.fill3} strokeWidth="3" />}
      <Sparkle x={78} y={24} r={4} fill={C.brand2} />
    </Spot>
  );
}

/** Log sheet with a Hedera receipt chip (audit trail empty). */
export function AuditLog(p: ArtProps) {
  return (
    <Spot {...p}>
      <rect x="26" y="18" width="44" height="58" rx="6" fill={C.paper} stroke={C.fill2} strokeWidth="1.5" />
      <path d="M34 30h22M34 39h28M34 48h18M34 57h24" stroke={C.fill2} strokeWidth="2.2" />
      <g transform="translate(52 62)">
        <rect width="34" height="17" rx="8.5" fill={C.proof} />
        <path d="M7 8.6l1.8 1.8 3.6-3.8" stroke="#fff" strokeWidth="1.5" />
        <text x="15" y="11.6" fontSize="7" fontFamily={SANS} fontWeight="700" fill="#fff">HCS</text>
      </g>
      <Sparkle x={20} y={26} r={3.4} fill={C.accent} />
    </Spot>
  );
}
/** Magnifier over a serial label (no inspectors listed). */
export function InspectorSearch(p: ArtProps) {
  return (
    <Spot {...p}>
      <rect x="16" y="34" width="44" height="26" rx="4" fill={C.paper} stroke={C.fill2} strokeWidth="1.5" />
      <path d="M21 41h14M21 46h9" stroke={C.fill3} strokeWidth="1.6" />
      <path d="M40 40v14M42.5 40v14M44.5 40v14M47 40v14M50 40v14M52 40v14M54.5 40v14" stroke={C.ink} strokeWidth="1.1" strokeLinecap="butt" />
      <circle cx="60" cy="54" r="14" fill={C.brand50} fillOpacity=".55" stroke={C.line} strokeWidth="3" />
      <path d="M55 48a7 7 0 0 1 7-3" stroke="#fff" strokeWidth="2" />
      <path d="M70 65l10 10" stroke={C.line} strokeWidth="5" />
      <Sparkle x={76} y={24} r={4} fill={C.brand2} />
    </Spot>
  );
}

/* ═══ 9 · RoleTiles (mini UI mocks) ═════════════════════════════════════════════════════════ */
export type Role = "merchant" | "buyer" | "courier" | "lender";

/** Mini product mock for each party (landing "Built for every party"). 200×128. */
export function RoleTile({ role, ...p }: ArtProps & { role: Role }) {
  const id = useUid();
  return (
    <Svg w={200} h={128} defaultSize={200} {...p}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={C.disc} />
          <stop offset="1" stopColor={C.fill} />
        </linearGradient>
        <clipPath id={`${id}-clip`}><rect width="200" height="128" rx="12" /></clipPath>
      </defs>
      <rect width="200" height="128" rx="12" fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>
      {role === "merchant" && (
        <g>
          <rect x="18" y="16" width="164" height="112" rx="8" fill={C.tile} stroke={C.tileBd} />
          <circle cx="28" cy="26" r="2.4" fill={C.fill2} /><circle cx="36" cy="26" r="2.4" fill={C.fill2} />
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${28 + i * 50} 38)`}>
              <rect width="44" height="28" rx="5" fill={C.disc} />
              <rect x="6" y="6" width="18" height="3" rx="1.5" fill={C.fill3} />
              <rect x="6" y="13" width={i === 0 ? 26 : 20} height="5" rx="2" fill={C.text} />
              {i === 0 && <path d="M26 24l4-3 4 1 6-6" stroke={C.brand} strokeWidth="1.6" />}
            </g>
          ))}
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(28 ${76 + i * 14})`}>
              <rect width="8" height="8" rx="2" fill={C.fill2} />
              <rect x="14" y="2" width="40" height="4" rx="2" fill={C.fill2} />
              <rect x="80" y="0" width="30" height="8" rx="4" fill={i === 1 ? C.info : C.brand} fillOpacity=".22" />
              <rect x="122" y="2" width="22" height="4" rx="2" fill={C.text} opacity=".7" />
            </g>
          ))}
        </g>
      )}
      {role === "buyer" && (
        <g>
          <rect x="66" y="12" width="68" height="124" rx="12" fill={C.body} />
          <rect x="70" y="16" width="60" height="116" rx="9" fill={C.tile} />
          <g transform="translate(76 26)">
            <rect width="20" height="20" rx="5" fill={C.disc} />
            <g transform="translate(2 2) scale(.14)"><PhoneArt id={`${id}-p`} /></g>
            <rect x="26" y="4" width="22" height="4" rx="2" fill={C.text} />
            <rect x="26" y="12" width="16" height="3" rx="1.5" fill={C.fill3} />
          </g>
          <g transform="translate(80 60)">
            <path d="M4 4H40" stroke={C.brand} strokeWidth="2" />
            <path d="M28 4h12" stroke={C.fill2} strokeWidth="2" />
            <circle cx="4" cy="4" r="4" fill={C.brand} /><circle cx="16" cy="4" r="4" fill={C.brand} />
            <circle cx="28" cy="4" r="4" fill={C.tile} stroke={C.brand} strokeWidth="2" />
            <circle cx="40" cy="4" r="4" fill={C.tile} stroke={C.fill2} strokeWidth="2" />
          </g>
          <rect x="76" y="76" width="48" height="12" rx="6" fill={C.info} fillOpacity=".18" />
          <rect x="82" y="80" width="30" height="4" rx="2" fill={C.info} />
          <rect x="76" y="96" width="48" height="4" rx="2" fill={C.fill2} />
          <rect x="76" y="104" width="34" height="4" rx="2" fill={C.fill2} />
        </g>
      )}
      {role === "courier" && (
        <g>
          <rect x="66" y="12" width="68" height="124" rx="12" fill={C.body} />
          <rect x="70" y="16" width="60" height="116" rx="9" fill={C.tile} />
          <g transform="translate(82 30)">
            <rect width="36" height="36" rx="4" fill="#fff" stroke={C.fill2} />
            <path d="M5 5h8v8H5zM23 5h8v8h-8zM5 23h8v8H5z" fill={C.ink} />
            <path d="M18 18h3v3h-3zM24 24h3v3h-3zM18 26h3v3h-3zM26 18h3v3h-3z" fill={C.ink} />
            <path d="M-4 4v-8h8M40 4v-8h-8M-4 32v8h8M40 32v8h-8" stroke={C.brand} strokeWidth="2" />
          </g>
          <VerifiedBadge x={100} y={90} r={10} />
          <rect x="80" y="110" width="40" height="10" rx="5" fill={C.brand} />
        </g>
      )}
      {role === "lender" && (
        <g>
          <rect x="24" y="20" width="152" height="96" rx="10" fill={C.tile} stroke={C.tileBd} />
          <g transform="translate(46 50)">
            <path d="M0-16 13.9-8v16L0 16-13.9 8V-8z" fill={C.brand} />
            <path d="M0-16 13.9-8v16L0 16z" fill={C.proof} opacity=".6" />
          </g>
          <rect x="70" y="36" width="50" height="5" rx="2.5" fill={C.text} />
          <rect x="70" y="46" width="34" height="4" rx="2" fill={C.fill3} />
          <g transform="translate(126 32)">
            <rect width="38" height="16" rx="8" fill={C.brand} fillOpacity=".16" />
            <text x="19" y="11.4" textAnchor="middle" fontFamily={SANS} fontSize="9" fontWeight="700" fill={C.brand3}>+5.3%</text>
          </g>
          <rect x="36" y="80" width="128" height="6" rx="3" fill={C.disc} />
          <rect x="36" y="80" width="84" height="6" rx="3" fill={C.brand} />
          <rect x="36" y="94" width="48" height="4" rx="2" fill={C.fill2} />
          <rect x="128" y="94" width="36" height="4" rx="2" fill={C.text} opacity=".7" />
        </g>
      )}
      </g>
    </Svg>
  );
}

/** All four role tiles in a responsive grid (2×2 on mobile, 4 across on desktop) with labels. */
export function RoleTiles({ labels = { merchant: "Merchants", buyer: "Buyers", courier: "Couriers", lender: "Lenders" } }: { labels?: Record<Role, string> }) {
  const roles: Role[] = ["merchant", "buyer", "courier", "lender"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
      {roles.map((r) => (
        <figure key={r} style={{ margin: 0 }}>
          <RoleTile role={r} size="100%" />
          <figcaption className="t-h3" style={{ marginTop: 8 }}>{labels[r]}</figcaption>
        </figure>
      ))}
    </div>
  );
}
