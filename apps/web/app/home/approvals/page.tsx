"use client";
import Link from "next/link";
import { Top } from "../../components/Top";
import { Badge, Callout, Card, EmptyState, Icon, Money, PageHeader, Skeleton, Timestamp, fmtAmount } from "../../components/ui";
import { IdentityShield, Inbox, Offline, ProductArt } from "../../components/art";
import { APPROVAL_LABEL, APPROVAL_OPEN, approvalTone } from "../../components/approval";
import { api, useEvents, usePoll } from "../../lib/api";
import { OwnerBadge, RuleNote, householdSub, type Owner } from "../shared";

type Approval = {
  id: string; status: string; reason: string | null; mode: string; simulated: boolean; startedAt: number; expiresAt: number; txHash: string | null;
  approvedVia: "world_id" | "simulated_fallback" | "simulated_world_id" | null;
  timeline: { at: number; status: string; note?: string }[];
  order: { ref: string; product: string | null; amount: string; status: string; refundBps: number; refund: string | null; decisionDeadline: number | null } | null;
};
type Data = { household: { name: string; door: string }; owner: Owner; approvals: Approval[] };

/** How the approval was given. Simulated approvals are never labelled as World ID. */
function Via({ a }: { a: Approval }) {
  if (a.status === "wrong_person") return <span className="small text-2">World ID, not the owner</span>;
  if (a.approvedVia === "world_id") return <Badge tone="proof" dot={false}><Icon name="shield-check" /> World ID Agent Pass</Badge>;
  if (a.approvedVia === "simulated_fallback") return <Badge tone="neutral" dot={false}><Icon name="flask" /> Simulated approval · demo only</Badge>;
  if (a.approvedVia === "simulated_world_id") return <Badge tone="neutral" dot={false}><Icon name="flask" /> Simulated World ID</Badge>;
  return <span className="muted">—</span>;
}
const title = (a: Approval) =>
  a.approvedVia === "simulated_fallback" && a.status === "refunded" ? "Refund settled (simulated approval, no World ID proof)" : APPROVAL_LABEL[a.status] ?? a.status;

export default function Approvals() {
  const tick = useEvents();
  const [d, reload, err] = usePoll<Data>(() => api("GET", "/v1/household/approvals"), [tick]);
  const loading = d === undefined && !err;
  const open = (d?.approvals ?? []).filter((a) => APPROVAL_OPEN.includes(a.status));
  const past = (d?.approvals ?? []).filter((a) => !APPROVAL_OPEN.includes(a.status));
  const o = d?.owner;
  const real = o?.mode === "agentpass";

  return (
    <>
      <Top role="household" />
      <main className="page">
        <PageHeader title="Approvals" sub={householdSub(d?.household.door)}
          badges={o ? (real ? <Badge tone="proof" dot={false}>World ID Agent Pass</Badge> : <Badge tone="neutral" dot={false}><Icon name="flask" /> Simulated World ID</Badge>) : undefined} />

        {d === undefined && err ? (
          <div className="card">
            <EmptyState art={<Offline />} title="Approvals unavailable" action={<button type="button" className="btn primary" onClick={reload}><Icon name="return" /> Try again</button>}>
              We couldn&apos;t load your approvals ({err}). Your agent does nothing that needs your approval while you can&apos;t see it.
            </EmptyState>
          </div>
        ) : (
          <div className="stack-24">
            <RuleNote>
              Your doorbell agent pays inspectors within your budget on its own. But when a parcel arrives damaged, accepting a partial refund (and keeping the item) needs a fresh World ID check from {o?.name ?? "the household owner"} through World ID Agent Pass. If nobody approves in time, the seller is paid in full and you keep the usual return window.
            </RuleNote>

            <div className="grid-main">
              <Card flush title="Waiting for you" desc="Refunds your agent wants to accept, paused until you approve.">
                {loading ? <div className="card-b"><div className="stack-8"><Skeleton h={56} /><Skeleton h={56} /></div></div>
                  : open.length === 0 ? <EmptyState small art={<Inbox />} title="Nothing to approve">When a parcel arrives damaged and you choose a partial refund, the approval waits here.</EmptyState>
                  : (
                    <ul className="list h-appr">
                      {open.map((a) => (
                        <li key={a.id}>
                          <div className="h-appr-row">
                            <ProductArt product={a.order?.product} variant="thumb" size={40} />
                            <div className="grow" style={{ minWidth: 0 }}>
                              <div className="h-appr-t"><b className="truncate">{a.order?.product ?? "Order"}</b><span className="mono xs muted">{a.order?.ref}</span></div>
                              <div className="small text-2">
                                Partial refund {a.order?.refund ? <b className="tnum" style={{ color: "var(--text)" }}>{fmtAmount(a.order.refund)} USDT</b> : null}
                                {a.order?.refundBps ? ` (${a.order.refundBps / 100}%)` : ""}
                                {a.order?.decisionDeadline ? <> · decide by <Timestamp ts={a.order.decisionDeadline} mode="time" /></> : null}
                              </div>
                              <div className="badges mt-8"><Badge tone="info" live>{a.status === "validating" ? "Checking your World ID approval" : "Waiting for your World ID approval"}</Badge></div>
                            </div>
                            {a.order && <Link className="btn sm primary" href={`/buyer/${a.order.ref}`}>Review</Link>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
              </Card>

              <Card title="Household owner" desc="The person who approves for this household's agent.">
                {!o ? <div className="stack-8"><Skeleton /><Skeleton w="70%" /></div> : (
                  <div className="stack-16">
                    <div className="h-owner">
                      <div className="h-owner-art"><IdentityShield size={64} /></div>
                      <div style={{ minWidth: 0 }}>
                        <b>{o.name}</b>
                        <div className="mt-4"><OwnerBadge o={o} /></div>
                      </div>
                    </div>
                    <dl className="dl">
                      <dt>Status</dt><dd>{o.via === "world_id" ? <>Linked {o.linkedAt ? <Timestamp ts={o.linkedAt} /> : null}</> : o.via === "simulated" ? "Demo owner" : "Links on the first approval"}</dd>
                      <dt>Approves with</dt><dd>{real ? "World ID Agent Pass" : <span className="text-2">Simulated World ID</span>}</dd>
                      <dt>Demo fallback</dt><dd>{o.simulatedFallback ? <span className="text-2">On, labelled &ldquo;simulated&rdquo;</span> : "Off"}</dd>
                    </dl>
                    <p className="xs muted" style={{ margin: 0 }}>
                      {real
                        ? "The first approval links the owner's World ID to this household. After that World only accepts the same person, so nobody else can approve refunds for your agent."
                        : "This server runs World ID in simulation, so approvals here carry no World ID proof."}
                      {o.simulatedFallback && " For judges without World App, the hosted demo also offers a simulated approval; it is always labelled as simulated."}
                    </p>
                  </div>
                )}
              </Card>
            </div>

            <Card flush title="Past approvals" desc="Every refund approval your agent asked for, and how it ended.">
              {loading ? <div className="card-b"><div className="stack-8"><Skeleton /><Skeleton w="70%" /></div></div>
                : past.length === 0 ? <EmptyState small art={<Inbox />} title="No approvals yet">They&apos;re listed here once your agent has asked for one.</EmptyState>
                : (
                  <>
                  <ul className="list only-mobile h-past">
                    {past.map((a) => (
                      <li key={a.id}>
                        <div className="h-appr-row">
                          <ProductArt product={a.order?.product} variant="thumb" size={40} />
                          <div className="grow" style={{ minWidth: 0 }}>
                            <div className="h-appr-t">
                              {a.order ? <Link className="mono small nowrap" href={`/buyer/${a.order.ref}`}>{a.order.ref}</Link> : <span className="muted">—</span>}
                              <span className="xs muted truncate">{a.order?.product}</span>
                              <span className="xs muted nowrap" style={{ marginLeft: "auto" }}><Timestamp ts={a.timeline?.[a.timeline.length - 1]?.at ?? a.startedAt} /></span>
                            </div>
                            <div className="small mt-4">{title(a)}{a.status === "refunded" && a.order?.refund ? <> · <b className="tnum">{fmtAmount(a.order.refund)} USDT</b></> : null}</div>
                            {(a.approvedVia || a.status === "wrong_person") && <div className="mt-8"><Via a={a} /></div>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="table-wrap only-desktop">
                    <table className="data">
                      <thead><tr><th>Parcel</th><th>Result</th><th>Checked with</th><th className="num">Refund</th><th className="num">When</th></tr></thead>
                      <tbody>
                        {past.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <div className="m-item">
                                <ProductArt product={a.order?.product} variant="thumb" size={32} />
                                <div style={{ minWidth: 0 }}>
                                  {a.order ? <Link className="mono small" href={`/buyer/${a.order.ref}`}>{a.order.ref}</Link> : <span className="muted">—</span>}
                                  <div className="cell-sub truncate" style={{ maxWidth: 200 }}>{a.order?.product}</div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <Badge tone={(a.approvedVia === "simulated_fallback" && approvalTone(a.status) === "success" ? "neutral" : approvalTone(a.status)) as "success" | "danger" | "neutral" | "info"} title={a.reason ?? undefined}>{title(a)}</Badge>
                            </td>
                            <td><Via a={a} /></td>
                            <td className="num">{a.status === "refunded" && a.order?.refund ? <Money v={a.order.refund} cur={null} strong /> : <span className="muted">—</span>}</td>
                            <td className="num xs muted nowrap"><Timestamp ts={a.timeline?.[a.timeline.length - 1]?.at ?? a.startedAt} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
            </Card>
            {err && d && <Callout tone="danger" title="Can't refresh approvals" action={<button type="button" className="btn sm" onClick={reload}>Retry</button>}>{err}</Callout>}
          </div>
        )}
      </main>
    </>
  );
}

