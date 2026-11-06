"use client";
import { useState } from "react";
import { Top } from "../components/Top";
import {
  Badge, Callout, Card, Dialog, EmptyState, ExtLink, Hash, Icon, KpiTile, Money, PageHeader, Skeleton, SkeletonRows, Timestamp, fmtAmount,
} from "../components/ui";
import { DeliveryBadge, timeLeft } from "../components/finance";
import { lender, useEvents, usePoll } from "../lib/api";

type Offer = {
  id: number; ref: string; orderId: string; status: string; product: string | null; merchant: string;
  orderStatus: string; orderOutcome: string | null;
  face: string; advance: string; holdback: string; bond: string; sellerToday: string; lenderReturn: string; returnPct: number; discountPct: number;
  deadline: number; createdAt: number; fundedAt: number | null; closedAt: number | null;
  lender: string | null; fundTx: string | null; fundTxUrl?: string; closeTx: string | null; closeTxUrl?: string;
  toHolder: string | null; toSeller: string | null; outcome: string | null; tokenId: string; tokenUrl?: string; noteAddress: string;
};
type Market = {
  enabled: boolean; noteAddress: string | null; noteUrl: string | null; lender: string | null; lenderUrl: string | null;
  lenderAllowlisted: boolean; canFund: boolean;
  kpis: { available: string | null; gas: string | null; deployed: string; outstanding: string; repaid: string; earned: string; losses: string; openCount: number; activeCount: number; closedCount: number; shortfallCount: number };
  offers: Offer[]; active: Offer[]; closed: Offer[];
};

const pct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
const noteNo = (id: string) => (id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
/** Plain-language error copy; the raw message stays in a tooltip. */
const friendly = (e?: string) =>
  !e ? "" : /not found|404/i.test(e) ? "Receivables aren't enabled on this server yet."
    : /HTTP 5\d\d|unreachable|isn't reachable|fetch|network/i.test(e) ? "Receivables aren't responding right now."
    : /[.!?]$/.test(e) ? e : `${e}.`;
/** "Northwind Gadgets'" / "Acme's". */
const possessive = (n: string) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);

export default function Lender() {
  const tick = useEvents();
  const [m, reload, err] = usePoll<Market>(() => lender("GET", "marketplace"), [tick], 15000);
  const [confirm, setConfirm] = useState<Offer>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [done, setDone] = useState<{ ref: string; txHash: string; explorerUrl?: string; tokenUrl?: string; amount: string }>();
  const loading = m === undefined && !err;
  const k = m?.kpis;
  const avail = Number(k?.available ?? 0);

  const fund = async (o: Offer) => {
    setBusy(true); setMsg(undefined);
    try {
      const r = await lender("POST", `offers/${o.id}/fund`, {});
      setDone({ ref: o.ref, txHash: r.txHash, explorerUrl: r.explorerUrl, tokenUrl: r.tokenUrl, amount: o.advance });
      setConfirm(undefined);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); reload(); }
  };

  const disabled = m && !m.enabled;
  return (
    <>
      <Top account="Demo lender" />
      <main className="page">
        <PageHeader
          title="Receivables"
          sub="Buy merchants' delivery payouts at a discount, repaid automatically when the delivery is verified · amounts in USDT"
          actions={m?.noteUrl ? <ExtLink href={m.noteUrl}>Note contract</ExtLink> : undefined}
        />

        {err && (
          <div className="stack-16" style={{ marginBottom: 24 }}>
            <Callout tone="danger" title="Can't load receivables" action={<button type="button" className="btn sm" onClick={reload}>Retry</button>}>
              <span title={err}>{friendly(err)} Balances and invoices will appear here once the service responds.</span>
            </Callout>
          </div>
        )}
        {done && (
          <div className="stack-16" style={{ marginBottom: 24 }}>
            <Callout tone="success" title={`Funded ${done.ref}: ${fmtAmount(done.amount)} USDT paid`}
              action={<div className="row" style={{ gap: 16 }}><ExtLink href={done.explorerUrl}>Funding transaction</ExtLink><ExtLink href={done.tokenUrl}>Your note</ExtLink><button type="button" className="btn ghost sm" onClick={() => setDone(undefined)}>Dismiss</button></div>}>
              The note is in your wallet. You&apos;re repaid when the delivery is verified.
            </Callout>
          </div>
        )}
        {m && m.enabled && !m.canFund && (
          <div className="stack-16" style={{ marginBottom: 24 }}>
            <Callout tone="warning" title="Funding is turned off for this desk">
              {!m.lender ? "No lender wallet is configured on the server." : !m.lenderAllowlisted ? "This lender wallet isn't approved on the note contract yet." : "The server doesn't hold this lender's key, so it can show invoices but not fund them."}
            </Callout>
          </div>
        )}

        {disabled ? (
          <Card><EmptyState icon="receipt" title="Invoice advances aren't enabled on this network">Deploy the receivable note contract to list merchant invoices here.</EmptyState></Card>
        ) : (
          <>
            <div className="kpis">
              <KpiTile label="Available balance" value={k?.available} loading={loading} error={!!err && !m}
                sub={m?.lender ? <span title={m.lender}>{k?.gas != null ? `${Number(k.gas).toFixed(3)} WBT for gas` : "Lender wallet"}</span> : undefined} />
              <KpiTile label="Capital deployed" value={k?.deployed} loading={loading} error={!!err && !m}
                sub={k ? `${k.activeCount} active note${k.activeCount === 1 ? "" : "s"}` : undefined} />
              <KpiTile label="Outstanding" value={k?.outstanding} loading={loading} error={!!err && !m} sub={k ? "Face value due at delivery" : undefined} />
              <KpiTile label="Repaid" value={k?.repaid} loading={loading} error={!!err && !m}
                sub={k ? <>Earned {fmtAmount(k.earned)} USDT</> : undefined} />
              <KpiTile label="Losses" value={k?.losses} loading={loading} error={!!err && !m}
                sub={k ? (k.shortfallCount ? `${k.shortfallCount} note${k.shortfallCount === 1 ? "" : "s"} closed short` : "Seller bonds cover first") : undefined} />
            </div>

            {err && !m ? (
              <Card><EmptyState icon="receipt" title="Invoices and notes will appear here">Open offers, your active notes and closed notes load as soon as the service responds.</EmptyState></Card>
            ) : (<>
            <Card flush title="Available invoices" desc="Payouts of paid orders, offered by the merchant. The seller's bond absorbs the first loss if a delivery fails.">
              <div className="table-wrap lg-only">
                <table className="data">
                  <thead><tr>
                    <th>Invoice</th><th>Merchant</th><th>Delivery</th>
                    <th className="num">Face value</th><th className="num">Price</th><th className="num">Your return</th><th className="num">Seller bond</th>
                    <th>Offer expires</th><th><span className="sr-only">Action</span></th>
                  </tr></thead>
                  <tbody>
                    {loading && <SkeletonRows rows={2} cols={9} />}
                    {err && !m && <tr><td colSpan={9}><EmptyState small icon="receipt" title="Invoices unavailable">They&apos;ll load when the service responds.</EmptyState></td></tr>}
                    {m && !m.offers.length && <tr><td colSpan={9}><EmptyState small icon="receipt" title="No invoices on offer">When a merchant requests an advance on a paid order, it appears here.</EmptyState></td></tr>}
                    {m?.offers.map((o) => (
                      <tr key={o.id}>
                        <td className="nowrap"><span className="strong mono" style={{ fontSize: 13 }}>{o.ref}</span><div className="cell-sub">{o.product}</div></td>
                        <td>{o.merchant}</td>
                        <td><DeliveryBadge s={o.orderStatus} /></td>
                        <td className="num"><Money v={o.face} cur={null} /></td>
                        <td className="num"><Money v={o.advance} cur={null} strong /><div className="cell-sub">{pct(o.discountPct)} off</div></td>
                        <td className="num"><Money v={o.lenderReturn} cur={null} /><div className="cell-sub">{pct(o.returnPct)}</div></td>
                        <td className="num"><Money v={o.bond} cur={null} /></td>
                        <td className="nowrap small"><Timestamp ts={o.deadline} mode="time" /><div className="cell-sub">{timeLeft(o.deadline)}</div></td>
                        <td className="num"><FundButton o={o} m={m} avail={avail} onClick={() => { setMsg(undefined); setConfirm(o); }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="list lt-lg">
                {loading && [0, 1].map((i) => <li key={i}><Skeleton w="60%" /><div className="mt-8"><Skeleton w="40%" /></div></li>)}
                {err && !m && <li><EmptyState small icon="receipt" title="Invoices unavailable">They&apos;ll load when the service responds.</EmptyState></li>}
                {m && !m.offers.length && <li><EmptyState small icon="receipt" title="No invoices on offer">When a merchant requests an advance on a paid order, it appears here.</EmptyState></li>}
                {m?.offers.map((o) => (
                  <li key={o.id}>
                    <div className="row between"><span className="strong mono" style={{ fontSize: 13 }}>{o.ref}</span><DeliveryBadge s={o.orderStatus} /></div>
                    <div className="small text-2 truncate mt-8">{o.merchant}{o.product ? ` · ${o.product}` : ""}</div>
                    <ul className="lines mt-8">
                      <li><span>Face value</span><Money v={o.face} /></li>
                      <li><span>Price ({pct(o.discountPct)} off)</span><Money v={o.advance} strong /></li>
                      <li><span>Your return</span><span><Money v={o.lenderReturn} /> <span className="xs muted">{pct(o.returnPct)}</span></span></li>
                      <li><span>Seller bond</span><Money v={o.bond} /></li>
                    </ul>
                    <div className="row between mt-8"><span className="xs muted">Expires {timeLeft(o.deadline)}</span><FundButton o={o} m={m} avail={avail} onClick={() => { setMsg(undefined); setConfirm(o); }} /></div>
                  </li>
                ))}
              </ul>
            </Card>

            <div className="mt-24">
              <Card flush title="Your notes" desc="Active notes follow their delivery. Repayment is automatic at settlement.">
                <NotesTable rows={m?.active} loading={loading} err={!!err && !m} kind="active" />
              </Card>
            </div>

            <div className="mt-24">
              <Card flush title="Closed" desc="Settled notes and what they paid back.">
                <NotesTable rows={m?.closed} loading={loading} err={!!err && !m} kind="closed" />
              </Card>
            </div>
            </>)}
          </>
        )}
      </main>

      {confirm && m && (
        <Dialog title={`Fund ${confirm.ref}`} onClose={() => !busy && setConfirm(undefined)}>
          <div className="dialog-b stack-16">
            <p className="text-2" style={{ margin: 0 }}>You buy {possessive(confirm.merchant)} payout for this order. You&apos;re repaid up to the face value when the delivery is verified.</p>
            <ul className="lines">
              <li className="hl"><span>You pay now</span><Money v={confirm.advance} /></li>
              <li><span>Seller receives today</span><Money v={confirm.sellerToday} /></li>
              <li><span>Held as seller bond</span><Money v={confirm.bond} /></li>
              <li><span>Repaid at delivery</span><Money v={confirm.face} /></li>
              <li className="total"><span>Your return</span><span><Money v={confirm.lenderReturn} /> <span className="xs muted">{pct(confirm.returnPct)}</span></span></li>
            </ul>
            <ol className="small text-2" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Your wallet approves USDT for the note contract, if needed.</li>
              <li>The note contract takes {fmtAmount(confirm.advance)} USDT, pays the seller and locks the order&apos;s payout to the note.</li>
              <li>Note #{noteNo(confirm.tokenId)} is minted to your wallet. If the delivery fails, the bond covers you first.</li>
            </ol>
            <div className="xs muted">Your wallet pays the network fee. The offer expires {timeLeft(confirm.deadline)}.</div>
            {msg && <Callout tone="danger" title="Funding didn't go through."><span title={msg}>{friendly(msg)}</span></Callout>}
          </div>
          <div className="dialog-f">
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirm(undefined)}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy || !m.canFund || avail < Number(confirm.advance)} onClick={() => fund(confirm)}>
              {busy ? <><Icon name="loader" className="spin" /> Funding…</> : `Fund ${fmtAmount(confirm.advance)} USDT`}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function FundButton({ o, m, avail, onClick }: { o: Offer; m: Market; avail: number; onClick: () => void }) {
  const short = avail < Number(o.advance);
  const why = !m.canFund ? "Funding is turned off for this desk" : short ? `Needs ${fmtAmount(o.advance)} USDT; you have ${fmtAmount(avail)}` : undefined;
  return (
    <button type="button" className="btn primary sm" onClick={onClick} disabled={!!why} title={why} aria-label={`Fund ${o.ref} for ${fmtAmount(o.advance)} USDT`}>
      Fund
    </button>
  );
}

function NotesTable({ rows, loading, err, kind }: { rows?: Offer[]; loading: boolean; err: boolean; kind: "active" | "closed" }) {
  const empty = kind === "active"
    ? <EmptyState small icon="receipt" title="No active notes">Notes you fund appear here until their delivery settles.</EmptyState>
    : <EmptyState small icon="check-circle" title="Nothing closed yet">Notes close automatically when the delivery is verified.</EmptyState>;
  const outcome = (o: Offer) => o.status === "repaid" ? <Badge tone="success">Repaid</Badge> : <Badge tone="warning" title={o.outcome ?? undefined}>Bond used</Badge>;
  const pl = (o: Offer) => Number(o.toHolder ?? 0) - Number(o.advance);
  const cols = kind === "active" ? 7 : 7;
  return (
    <>
      <div className="table-wrap lg-only">
        <table className="data">
          <thead>
            {kind === "active" ? (
              <tr><th>Note</th><th>Merchant</th><th>Delivery</th><th className="num">Paid</th><th className="num">Due at delivery</th><th className="num">Seller bond</th><th>Funded</th></tr>
            ) : (
              <tr><th>Note</th><th>Merchant</th><th>Outcome</th><th className="num">Paid</th><th className="num">Received</th><th className="num">Profit / loss</th><th>Closed</th></tr>
            )}
          </thead>
          <tbody>
            {loading && <SkeletonRows rows={2} cols={cols} />}
            {err && <tr><td colSpan={cols}><span className="small muted">Unavailable</span></td></tr>}
            {rows && !rows.length && <tr><td colSpan={cols}>{empty}</td></tr>}
            {rows?.map((o) => (
              <tr key={o.id}>
                <td className="nowrap"><span className="strong mono" style={{ fontSize: 13 }}>{o.ref}</span><div className="cell-sub"><ExtLink href={o.tokenUrl}>Note #{noteNo(o.tokenId)}</ExtLink></div></td>
                <td>{o.merchant}<div className="cell-sub">{o.product}</div></td>
                {kind === "active" ? (
                  <>
                    <td><DeliveryBadge s={o.orderStatus} /></td>
                    <td className="num"><Money v={o.advance} cur={null} /></td>
                    <td className="num"><Money v={o.face} cur={null} strong /></td>
                    <td className="num"><Money v={o.bond} cur={null} /></td>
                    <td className="nowrap"><Timestamp ts={o.fundedAt} /><div className="cell-sub"><Hash value={o.fundTx} href={o.fundTxUrl} linkLabel="View funding transaction" /></div></td>
                  </>
                ) : (
                  <>
                    <td>{outcome(o)}</td>
                    <td className="num"><Money v={o.advance} cur={null} /></td>
                    <td className="num"><Money v={o.toHolder} cur={null} strong /></td>
                    <td className="num" style={{ color: pl(o) < 0 ? "var(--danger)" : undefined }}>{pl(o) >= 0 ? "+" : "−"}{fmtAmount(Math.abs(pl(o)))}</td>
                    <td className="nowrap"><Timestamp ts={o.closedAt} /><div className="cell-sub"><Hash value={o.closeTx} href={o.closeTxUrl} linkLabel="View closing transaction" /></div></td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list lt-lg">
        {loading && [0, 1].map((i) => <li key={i}><Skeleton w="60%" /><div className="mt-8"><Skeleton w="40%" /></div></li>)}
        {err && <li><span className="small muted">Unavailable</span></li>}
        {rows && !rows.length && <li>{empty}</li>}
        {rows?.map((o) => (
          <li key={o.id}>
            <div className="row between"><span className="strong mono" style={{ fontSize: 13 }}>{o.ref}</span>{kind === "active" ? <DeliveryBadge s={o.orderStatus} /> : outcome(o)}</div>
            <div className="small text-2 truncate mt-8">{o.merchant}{o.product ? ` · ${o.product}` : ""}</div>
            <ul className="lines mt-8">
              <li><span>Paid</span><Money v={o.advance} /></li>
              {kind === "active"
                ? <><li><span>Due at delivery</span><Money v={o.face} strong /></li><li><span>Seller bond</span><Money v={o.bond} /></li></>
                : <><li><span>Received</span><Money v={o.toHolder} strong /></li><li><span>Profit / loss</span><span className="money" style={{ color: pl(o) < 0 ? "var(--danger)" : undefined }}>{pl(o) >= 0 ? "+" : "−"}{fmtAmount(Math.abs(pl(o)))}<span className="cur">USDT</span></span></li></>}
            </ul>
            <div className="row between mt-8" style={{ gap: 12 }}>
              <ExtLink href={o.tokenUrl}>Note #{noteNo(o.tokenId)}</ExtLink>
              {kind === "active" ? <Hash value={o.fundTx} href={o.fundTxUrl} linkLabel="View funding transaction" /> : <Hash value={o.closeTx} href={o.closeTxUrl} linkLabel="View closing transaction" />}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
