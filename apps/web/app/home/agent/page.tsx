"use client";
import Link from "next/link";
import { Top } from "../../components/Top";
import { Badge, Callout, Card, EmptyState, ExtLink, Icon, Money, PageHeader, Skeleton, SkeletonRows, StatusBadge, Timestamp, fmtAmount, hashscan } from "../../components/ui";
import { AuditLog, InspectorSearch, Offline } from "../../components/art";
import { api, useEvents, usePoll } from "../../lib/api";
import { RuleNote, householdSub } from "../shared";

/** HCS log entry → what it means for the household. */
const LOG_LABEL: Record<string, [string, "success" | "warning" | "info" | "neutral"]> = {
  "agent.payment": ["Agent paid inspector", "success"],
  "inspection.verdict": ["Inspection verdict", "info"],
  "agent.refusal": ["Agent refused: over limit", "warning"],
  "inspector.register": ["Inspector listed", "neutral"],
};
const PAY_STATUS: Record<string, [string, "success" | "warning" | "danger"]> = { settled: ["Paid", "success"], refused: ["Refused", "warning"], failed: ["Failed", "danger"] };

/** "verdict key not registered…" / "0.25 USD is above the 0.1 USD no-human threshold" → short reason for the directory. */
function refusal(reason?: string, threshold?: number) {
  if (!reason) return "Not allowed by your policy";
  if (/threshold|exceeds|max/i.test(reason)) return `Asks more than your ${fmtAmount(threshold)} USDC auto-approve limit`;
  if (/allowlist/i.test(reason)) return "Not on your inspector allowlist";
  if (/budget/i.test(reason)) return "Would go over today's budget";
  if (/not registered/i.test(reason)) return "Verdict key isn't registered on Whitechain";
  return reason;
}

export default function HouseholdAgent() {
  const tick = useEvents();
  const [agent, reload, err] = usePoll<any>(() => api("GET", "/v1/agent/status"), [tick]);
  const [hcs, reloadHcs, hcsErr] = usePoll<any>(() => api("GET", "/v1/hcs/log"), [tick]);
  const [ov] = usePoll<any>(() => api("GET", "/v1/household/overview"), [tick]);
  const p = agent?.policy;
  const live = p?.mode === "live";
  const inspectors: any[] = Array.isArray(agent?.inspectors) ? agent.inspectors : [];
  const dirErr: string | undefined = agent && !Array.isArray(agent.inspectors) ? agent.inspectors?.error : undefined;
  const payments: any[] = agent?.payments ?? [];
  const nameFor = (url: string) => inspectors.find((c) => c.url?.replace(/\/$/, "") === url?.replace(/\/$/, ""))?.name ?? url?.replace(/^https?:\/\//, "");
  const refByOrderId: Record<string, string> = Object.fromEntries((ov?.deliveries ?? []).map((d: any) => [String(d.orderId ?? "").toLowerCase(), d.ref]));
  const pct = p?.dailyBudget ? Math.min(100, (p.spentToday / p.dailyBudget) * 100) : 0;
  const allowlist: string[] = Array.isArray(p?.allowlist) ? p.allowlist : [];

  return (
    <>
      <Top role="household" />
      <main className="page">
        <PageHeader title="Household agent" sub={householdSub()}
          badges={p ? <Badge tone={live ? "proof" : "neutral"} dot={live}>{live ? "Hedera testnet" : "Simulated network"}</Badge> : undefined} />

        {agent === undefined && err ? (
          <div className="card">
            <EmptyState art={<Offline />} title="Agent unavailable" action={<button type="button" className="btn primary" onClick={reload}><Icon name="return" /> Try again</button>}>
              We couldn&apos;t reach your doorbell agent ({err}). Nothing is paid while it&apos;s offline.
            </EmptyState>
          </div>
        ) : (
          <div className="stack-24">
            <section className="card h-agent-hero" aria-labelledby="agent-what">
              <div>
                <span className="eyebrow">How your agent works</span>
                <h2 id="agent-what">It hires an independent inspector for every parcel</h2>
                <p>When a parcel is opened at your door, the agent reads the inspector directory on Hedera, picks the cheapest inspector within your policy and pays per inspection over x402, in USDC. Every payment, refusal and verdict is logged publicly.</p>
              </div>
              <ol className="h-flow" aria-label="Agent steps">
                <li><span className="n">1</span><span><b>Discover</b>Inspector directory on Hedera</span></li>
                <li><span className="n">2</span><span><b>Check policy</b>Budget, price limit, allowlist</span></li>
                <li><span className="n">3</span><span><b>Pay over x402</b>USDC on Hedera, per inspection</span></li>
                <li><span className="n">4</span><span><b>Settle</b>Signed verdict to Whitechain</span></li>
              </ol>
            </section>

            <div className="grid-2">
              <Card title="Spending policy" desc="The guard rails your agent follows with no human in the loop.">
                {!p ? <div className="stack-8"><Skeleton /><Skeleton w="80%" /><Skeleton w="60%" /></div> : (
                  <div className="stack-16">
                    <div>
                      <div className="row between small"><span className="text-2">Inspections today</span><span className="tnum">{fmtAmount(p.spentToday)} of {fmtAmount(p.dailyBudget)} USDC</span></div>
                      <div className={`progress mt-8 ${pct > 80 ? "warn" : ""}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Daily inspection budget used"><span style={{ width: `${pct}%` }} /></div>
                    </div>
                    <dl className="dl">
                      <dt>Daily budget</dt><dd><Money v={p.dailyBudget} cur="USDC" /></dd>
                      <dt>Auto-approve up to</dt><dd><Money v={p.approvalThreshold} cur="USDC" /> per inspection</dd>
                      <dt>Preferred price</dt><dd>up to <Money v={p.maxPricePerCall} cur="USDC" /></dd>
                      <dt>Allowed inspectors</dt><dd>{allowlist.length === 1 && allowlist[0].startsWith("(") ? <span className="text-2">Any inspector registered on-chain</span> : <span className="text-2">{allowlist.length} on your allowlist</span>}</dd>
                      <dt>Pays in</dt><dd><span className="text-2">USDC on {String(p.network ?? "hedera:testnet").replace("hedera:", "Hedera ")}</span></dd>
                    </dl>
                    <div className="xs muted">Above the auto-approve limit the agent refuses rather than pay: it never spends more without you.</div>
                  </div>
                )}
              </Card>

              <Card title="Inspector directory" desc="Read from the public Hedera directory before each inspection."
                actions={agent?.topics?.live ? <ExtLink href={hashscan(p?.network, "topic", agent.topics.inspectors)}>Directory</ExtLink> : undefined}>
                {!agent ? <div className="stack-8"><Skeleton h={48} /><Skeleton h={48} /></div>
                  : dirErr ? <Callout tone="neutral" title="Directory unavailable">{dirErr}</Callout>
                  : inspectors.length === 0 ? <EmptyState small art={<InspectorSearch />} title="No inspectors listed yet">Inspectors appear here once they register in the Hedera directory.</EmptyState>
                  : (
                    <ul className="h-insp">
                      {inspectors.map((c) => (
                        <li key={c.evmAddress} className={c.allowed ? "" : "off"}>
                          <span className={`avatar ${c.allowed ? "" : "muted-av"}`} style={c.allowed ? { background: "var(--brand)" } : undefined} aria-hidden="true">{String(c.name).slice(0, 2).toUpperCase()}</span>
                          <div className="grow" style={{ minWidth: 0 }}>
                            <div className="row" style={{ gap: 8 }}><b className="truncate">{c.name}</b></div>
                            <div className="xs muted"><Money v={c.priceUsd} cur="USDC" /> per inspection{c.allowed ? "" : <> · {refusal(c.reason, p?.approvalThreshold)}</>}</div>
                          </div>
                          {c.allowed ? <Badge tone="success">Within policy</Badge> : <Badge tone="warning" title={c.reason}>Refused</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
              </Card>
            </div>

            <Card flush title="Inspector payments" desc="x402 payments your agent made, newest first.">
              {!agent ? <div className="card-b"><div className="stack-8"><Skeleton /><Skeleton w="70%" /></div></div>
                : payments.length === 0 ? <EmptyState small art={<AuditLog />} title="No payments yet">Your agent pays an inspector the first time a parcel is opened at your door.</EmptyState>
                : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead><tr><th className="hide-sm">Time</th><th>Parcel</th><th className="hide-sm">Inspector</th><th>Status</th><th className="num">Amount</th><th className="num">Proof</th></tr></thead>
                      <tbody>
                        {payments.map((x) => {
                          const [label, tone] = PAY_STATUS[x.status] ?? [x.status, "warning" as const];
                          return (
                            <tr key={x.id}>
                              <td className="xs muted nowrap hide-sm"><Timestamp ts={x.ts} /></td>
                              <td className="nowrap">{x.order_ref ? <Link className="mono" href={`/buyer/${x.order_ref}`}>{x.order_ref}</Link> : <span className="muted">—</span>}</td>
                              <td className="hide-sm text-2">{nameFor(x.inspector)}</td>
                              <td><Badge tone={tone} title={x.status === "refused" ? x.detail : undefined}>{label}</Badge></td>
                              <td className="num"><Money v={x.amount_usd} cur="USDC" /></td>
                              <td className="num">{x.hedera_tx && live ? <ExtLink href={hashscan(x.network ?? p?.network, "transaction", x.hedera_tx)}>HashScan</ExtLink> : <span className="muted xs">{x.status === "settled" ? "Simulated" : "No payment"}</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
            </Card>

            <Card flush title="Agent log" desc="Every payment, refusal and verdict, written to a public Hedera topic."
              actions={hcs?.topicId ? <ExtLink href={hcs.live ? hashscan(p?.network, "topic", hcs.topicId) : undefined}>View log on HashScan</ExtLink> : undefined}>
              {!hcs && hcsErr ? (
                <div className="card-b"><Callout tone="danger" title="Log unavailable" action={<button type="button" className="btn sm" onClick={reloadHcs}>Retry</button>}>We couldn&apos;t read the Hedera log ({hcsErr}). Entries already written stay public.</Callout></div>
              ) : hcs && !hcs.messages?.length ? (
                <EmptyState small art={<AuditLog />} title="Nothing logged yet">Entries appear as parcels are inspected at your door.</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Time</th><th>Event</th><th className="hide-sm">Parcel</th><th className="hide-sm">Detail</th><th className="num">Entry</th></tr></thead>
                    <tbody>
                      {!hcs && <SkeletonRows rows={4} cols={5} />}
                      {(hcs?.messages ?? []).slice(0, 25).map((m: any) => {
                        const [label, tone] = LOG_LABEL[m.message.type] ?? [m.message.type, "neutral"];
                        const ts = m.consensusTimestamp ? Number(m.consensusTimestamp.split(".")[0]) : m.message.at;
                        const ref = refByOrderId[String(m.message.orderId ?? "").toLowerCase()];
                        return (
                          <tr key={m.sequence}>
                            <td className="xs muted nowrap"><Timestamp ts={ts} /></td>
                            <td className="nowrap"><Badge tone={tone}>{label}</Badge></td>
                            <td className="mono nowrap hide-sm">{ref ?? <span className="muted">—</span>}</td>
                            <td className="text-2 hide-sm">
                              {m.message.outcome && <StatusBadge s={m.message.outcome} />}
                              {m.message.amountUsd != null && <Money v={m.message.amountUsd} cur="USDC" />}
                              {m.message.priceUsd != null && <>Asked <Money v={m.message.priceUsd} cur="USDC" />, limit {fmtAmount(p?.approvalThreshold)} USDC</>}
                              {m.message.name && <>{m.message.name}</>}
                            </td>
                            <td className="num mono xs">#{m.sequence}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <RuleNote action={<Link className="btn sm" href="/home/approvals">Approvals</Link>} />
          </div>
        )}
      </main>
    </>
  );
}
