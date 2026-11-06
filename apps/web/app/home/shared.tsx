"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Icon, Skeleton, Timestamp, fmtAmount } from "../components/ui";
import { HOUSEHOLD_NAME, HOUSEHOLD_OWNER } from "../components/roles";

/** World ID Agent Pass owner link, as the backend reports it (no identifiers ever reach the browser). */
export type Owner = { name: string; linked: boolean; linkedAt: number | null; via: "world_id" | "simulated" | null; mode: string; simulatedFallback: boolean };

export const householdSub = (door = "Front door") => <span className="m-sub">{HOUSEHOLD_NAME}<span className="dot-sep" aria-hidden="true" />{door}</span>;

/** "Linked with World ID" / "Demo owner (simulated World ID)" / "Links on first approval". */
export function OwnerBadge({ o }: { o?: Owner }) {
  if (!o) return <Skeleton w={120} />;
  if (o.via === "world_id") return <Badge tone="proof" dot={false}><Icon name="shield-check" /> Linked with World ID</Badge>;
  if (o.via === "simulated") return <Badge tone="neutral" dot={false}><Icon name="flask" /> Demo owner · simulated World ID</Badge>;
  return <Badge tone="warning">Not linked yet</Badge>;
}

/** Three-cell status strip shared by the household pages: agent spend today, owner link, pending approvals. */
export function StatusStrip({ policy, owner, pending, loading }: { policy?: any; owner?: Owner; pending?: number; loading?: boolean }) {
  const pct = policy?.dailyBudget ? Math.min(100, (policy.spentToday / policy.dailyBudget) * 100) : 0;
  return (
    <div className="card h-strip">
      <Link href="/home/agent" className="h-cell">
        <span className="ic agent" aria-hidden="true"><Icon name="sparkle" /></span>
        <span className="grow">
          <span className="lbl">Doorbell agent</span>
          {policy ? (
            <>
              <span className="val">{fmtAmount(policy.spentToday)} <span className="cur">of {fmtAmount(policy.dailyBudget)} USDC today</span></span>
              <span className="h-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
            </>
          ) : loading ? <Skeleton w={140} /> : <span className="val muted">Unavailable</span>}
        </span>
        <Icon name="chevron-right" />
      </Link>
      <Link href="/home/approvals" className="h-cell">
        <span className="ic owner" aria-hidden="true"><Icon name="shield-check" /></span>
        <span className="grow">
          <span className="lbl">Owner approval · {owner?.name ?? HOUSEHOLD_OWNER}</span>
          {owner ? <span className="val"><OwnerBadge o={owner} /></span> : loading ? <Skeleton w={140} /> : <span className="val muted">Unavailable</span>}
        </span>
        <Icon name="chevron-right" />
      </Link>
      <Link href="/home/approvals" className="h-cell">
        <span className={`ic ${pending ? "attn" : ""}`} aria-hidden="true"><Icon name="bell" /></span>
        <span className="grow">
          <span className="lbl">Waiting for you</span>
          {pending === undefined ? (loading ? <Skeleton w={100} /> : <span className="val muted">—</span>)
            : <span className="val">{pending ? `${pending} refund approval${pending === 1 ? "" : "s"}` : "Nothing to approve"}</span>}
        </span>
        <Icon name="chevron-right" />
      </Link>
    </div>
  );
}

/** Small "the rule" panel: the agent can't accept a partial refund without the owner's World ID approval. */
export function RuleNote({ children, action }: { children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="h-rule">
      <span className="ic" aria-hidden="true"><Icon name="shield-check" /></span>
      <div className="grow">
        <b>Your agent can&apos;t accept a partial refund without your World ID approval.</b>
        <p>{children ?? "It can pay inspectors within your budget on its own, but taking money back for a damaged parcel (and keeping the item) needs a fresh World ID check from the household owner."}</p>
      </div>
      {action}
    </div>
  );
}

export const when = (ts?: number | null) => (ts ? <Timestamp ts={ts} /> : <span className="muted">—</span>);
