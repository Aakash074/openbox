/**
 * Presenter-only overrides injected into the same-origin /kiosk and /merchant panes of /demo (see demo/page.tsx).
 * Panes are ~470–560px wide, so they'd otherwise get the phone layouts. Everything is scoped to html[data-embed],
 * which layout.tsx sets before paint for ?embed=1.
 */
export const EMBED_CSS = `
/* Doorbell: keep the stepper horizontal and the camera 16:10 so it sits above the fold. */
html[data-embed] .stepper.responsive { flex-direction: row; }
html[data-embed] .stepper.responsive li { display: block; text-align: center; padding-bottom: 0; }
html[data-embed] .stepper.responsive li::before, html[data-embed] .stepper.responsive li::after { top: 13px; bottom: auto; left: calc(-50% + 18px); right: calc(50% + 18px); width: auto; height: 2px; }
html[data-embed] .stepper.responsive li::after { transform: scaleX(0); transform-origin: left center; }
html[data-embed] .stepper.responsive li.done::after, html[data-embed] .stepper.responsive li.current::after,
html[data-embed] .stepper.responsive li.failed::after, html[data-embed] .stepper.responsive li.warn::after { transform: scaleX(1); }
html[data-embed] .stepper.responsive .step-dot { margin: 0 auto; }
html[data-embed] .stepper.responsive .step-label { margin-top: 6px; padding: 0 2px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
html[data-embed] .cam { aspect-ratio: 16 / 10; }
html[data-embed] .kiosk-main { padding: 12px 14px 20px; }
html[data-embed] .kiosk-top { padding: 10px 14px; }
html[data-embed] .kiosk-main > .card.card-b:first-child { padding: 12px 8px; }
html[data-embed] .kiosk-grid { margin-top: 12px; gap: 12px; }
html[data-embed] .cam .hint { font-size: 16px; padding: 10px 12px; }

/* Merchant: the balance strip already shows the money, so KPIs shrink to one compact row of three. */
html[data-embed] .kpis, html[data-embed] .kpis.six { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 8px; margin-bottom: 16px; }
html[data-embed] .kpis > :nth-child(n+4) { display: none !important; }
html[data-embed] .kpis > * { grid-column: auto !important; }
html[data-embed] .kpis .kpi, html[data-embed] .kpi-group > .kpi { padding: 10px 12px; }
html[data-embed] .kpis .kpi-label { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
html[data-embed] .kpis .kpi-label .icon { display: none; }
html[data-embed] .kpis .kpi-value { font-size: 18px; line-height: 24px; margin-top: 2px; }
html[data-embed] .kpis .kpi-value .cur { font-size: 11px; }
html[data-embed] .kpis .kpi-sub, html[data-embed] .kpis svg.spark { display: none; }
/* Current merchant layout (.m-kpis scroll strip + .m-secondary card): same idea. */
html[data-embed] .m-kpis { display: grid !important; grid-auto-flow: column !important; grid-auto-columns: minmax(0, 1fr) !important; grid-template-columns: none !important; overflow: hidden !important; scroll-snap-type: none !important; }
html[data-embed] .m-kpis > .kpi { min-width: 0 !important; width: auto !important; padding: 10px 12px !important; border-top: 0 !important; }
html[data-embed] .m-kpis > .kpi:nth-child(n+4) { display: none !important; }
html[data-embed] .m-kpis > .kpi + .kpi { border-left: 1px solid var(--border) !important; }
html[data-embed] .m-kpis .kpi-label { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
html[data-embed] .m-kpis .kpi-value { font-size: 18px; line-height: 24px; margin-top: 2px; }
html[data-embed] .m-kpis .kpi-value .cur { font-size: 11px; }
html[data-embed] .m-kpis .kpi-sub, html[data-embed] .m-kpis svg, html[data-embed] .m-strip-hint, html[data-embed] .m-secondary { display: none !important; }
html[data-embed] .m-kpis + .m-strip-hint + .m-secondary + * { margin-top: 16px; }
`;
