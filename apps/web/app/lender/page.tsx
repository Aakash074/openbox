"use client";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Top } from "../components/Top";
import {
  Badge, Callout, Dialog, EmptyState, ExtLink, Hash, Icon, Money, PageHeader, Skeleton, SkeletonRows, Tabs, Timestamp, fmtAmount, hasAmount,
} from "../components/ui";
import { CountUp } from "../components/motion";
import { Offline, ProductArt, ReceivableFlow, VerdictCheck } from "../components/art";
import { DeliveryBadge, timeLeft } from "../components/finance";
import { lender, useEvents, usePoll } from "../lib/api";
import "../styles/lender.css";

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
type View = "available" | "active" | "closed";

const pct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
const noteNo = (id: string) => (id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
/** Plain-language error copy; the raw message stays in a tooltip. */
const friendly = (e?: string) =>
  !e ? "" : /not found|404/i.test(e) ? "Receivables aren't enabled on this server yet."
    : /HTTP 5\d\d|unreachable|isn't reachable|fetch|network|unavailable/i.test(e) ? "Receivables aren't responding right now."
    : /[.!?]$/.test(e) ? e : `${e}.`;
/** "Northwind Gadgets'" / "Acme's". */
const possessive = (n: string) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const pl = (o: Offer) => Number(o.toHolder ?? 0) - Number(o.advance);
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${fmtAmount(Math.abs(v))}`;

/** Seconds clock that ticks every 30s (offer countdowns). */
function useClock(ms = 30000) {
  const [t, setT] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const i = setInterval(() => setT(Math.floor(Date.now() / 1000)), ms); return () => clearInterval(i); }, [ms]);
  return t;
}

function Lender() {
  const tick = useEvents();
  const [m, reload, err] = usePoll<Market>(() => lender("GET", "marketplace"), [tick], 15000);
  // The view lives in the URL so the lender nav (Marketplace · Active · Closed) and the tabs stay in step.
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const q = params.get("view");
  const view: View = q === "active" || q === "closed" ? q : "available";
  const setView = (v: View) => router.replace(v === "available" ? path : `${path}?view=${v}`, { scroll: false });
  const [confirm, setConfirm] = useState<Offer>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [done, setDone] = useState<{ ref: string; txHash: string; explorerUrl?: string; tokenUrl?: string; amount: string }>();
  const now = useClock();
  const loading = m === undefined && !err;
  const down = m === undefined && !!err;
  const k = m?.kpis;
  const avail = Number(k?.available ?? 0);
  const total = m ? m.offers.length + m.active.length + m.closed.length : 0;

  const fund = async (o: Offer) => {
    setBusy(true); setMsg(undefined);
    try {
      const r = await lender("POST", `offers/${o.id}/fund`, {});
      setDone({ ref: o.ref, txHash: r.txHash, explorerUrl: r.explorerUrl, tokenUrl: r.tokenUrl ?? o.tokenUrl, amount: o.advance });
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); reload(); }
  };
  const closeDialog = () => { if (busy) return; setConfirm(undefined); if (done) { setDone(undefined); setView("active"); } };
  const openFund = (o: Offer) => { setMsg(undefined); setDone(undefined); setConfirm(o); };

  const disabled = m && !m.enabled;
  return (
    <>
      <Top role="lender" current={view === "available" ? "/lender" : `/lender?view=${view}`} />
      <main className="page">
        <PageHeader
          title="Receivables"
          sub="Buy merchants' delivery payouts at a discount. You're repaid automatically when the delivery is verified."
          actions={m?.noteUrl ? <ExtLink href={m.noteUrl}>Note contract</ExtLink> : undefined}
        />

        {err && m && (
          <div style={{ marginBottom: 24 }}>
            <Callout tone="danger" title="Can't refresh receivables" action={<button type="button" className="btn sm" onClick={reload}>Retry</button>}>
              <span title={err}>{friendly(err)} Figures below may be out of date.</span>
            </Callout>
          </div>
        )}
        {m && m.enabled && !m.canFund && (
          <div style={{ marginBottom: 24 }}>
            <Callout tone="warning" title="Funding is turned off for this desk">
              {!m.lender ? "No lender wallet is configured on the server." : !m.lenderAllowlisted ? "This lender wallet isn't approved on the note contract yet." : "The server doesn't hold this lender's key, so it can show invoices but not fund them."}
            </Callout>
          </div>
        )}

        {disabled ? (
          <div className="card l-empty">
            <div className="art-wrap"><ReceivableFlow /></div>
            <div className="empty-title">Invoice advances aren&apos;t enabled on this network</div>
            <div className="empty-body">Deploy the receivable note contract to list merchant invoices here.</div>
          </div>
        ) : (
          <>
            {m && total > 0 && (
              <section className="card l-hero" aria-label="How invoice advances work">
                <div>
                  <div className="eyebrow">Invoice advances</div>
                  <h2>Cash for merchants now, repaid at verified delivery</h2>
                  <p>Each paid order becomes a receivable note. You fund it at a discount; the order payout repays you when the parcel checks out at the door.</p>
                  <ul>
                    <li><Icon name="shield-check" /><span>The seller&apos;s bond absorbs the first loss if a delivery fails.</span></li>
                    <li><Icon name="coins" /><span>Repayment is automatic. Nothing to chase.</span></li>
                  </ul>
                </div>
                <div className="l-hero-art" tabIndex={0} role="region" aria-label="How an invoice advance works (diagram)"><ReceivableFlow /></div>
              </section>
            )}

            {!down && <div className="card kpi-group l-kpis">
              <Kpi label="Available balance" value={k?.available} loading={loading} down={down}
                sub={m?.lender ? <span title={m.lender}>{k?.gas != null ? `${Number(k.gas).toFixed(3)} WBT for gas` : "Lender wallet"}</span> : undefined} />
              <Kpi label="Capital deployed" value={k?.deployed} loading={loading} down={down} sub={k ? `${plural(k.activeCount, "active note")}` : undefined} />
              <Kpi label="Outstanding" value={k?.outstanding} loading={loading} down={down} sub={k ? "Face value due at delivery" : undefined} />
              <Kpi label="Repaid" value={k?.repaid} loading={loading} down={down}
                sub={k ? (Number(k.earned) > 0 ? <span className="l-pos">{signed(Number(k.earned))} USDT earned</span> : "Nothing earned yet") : undefined} />
              <Kpi label="Losses" value={k?.losses} loading={loading} down={down}
                sub={k ? (k.shortfallCount ? `${plural(k.shortfallCount, "note")} closed short` : "Seller bonds cover first") : undefined} />
            </div>}

            {down ? (
              <div className="card">
                <EmptyState art={<Offline />} title="Receivables unavailable" action={<button type="button" className="btn primary" onClick={reload}><Icon name="return" /> Try again</button>}>
                  <span title={err}>{friendly(err)} Open invoices and your notes will appear here once the service responds.</span>
                </EmptyState>
              </div>
            ) : m && total === 0 ? (
              <div className="card l-empty">
                <div className="art-wrap"><ReceivableFlow /></div>
                <div className="empty-title">No invoices on offer yet</div>
                <div className="empty-body">When a merchant requests an advance on a paid order, it&apos;s listed here. Fund it and you&apos;re repaid automatically when the delivery is verified.</div>
              </div>
            ) : (
              <section className="card">
                <div className="l-card-h">
                  <Tabs<View> label="Receivables" value={view} onChange={setView} items={[
                    { id: "available", label: "Available", count: m ? m.offers.length : null },
                    { id: "active", label: "Active", count: m ? m.active.length : null },
                    { id: "closed", label: "Closed", count: m ? m.closed.length : null },
                  ]} />
                  <div className="desc">{view === "available" ? "Payouts of paid orders, offered by the merchant." : view === "active" ? "Notes you hold. Repaid automatically at settlement." : "Settled notes and what they paid back."}</div>
                </div>
                <div className="l-tab-body" role="tabpanel">
                  {view === "available" && <Offers rows={m?.offers} loading={loading} m={m} avail={avail} now={now} onFund={openFund} />}
                  {view !== "available" && <Notes rows={view === "active" ? m?.active : m?.closed} loading={loading} kind={view} />}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {confirm && m && (
        <Dialog title={done ? "Note funded" : `Fund ${confirm.ref}`} onClose={closeDialog}>
          {done ? (
            <>
              <div className="l-done l-fund" role="status">
                <VerdictCheck size={64} />
                <div className="h">You funded {done.ref}</div>
                <div className="s">{possessive(confirm.merchant)} payout for this order now repays you when the delivery is verified.</div>
                <ul className="lines l-done-lines">
                  <li><span>Paid now</span><Money v={done.amount} /></li>
                  <li><span>Repaid at delivery</span><Money v={confirm.face} /></li>
                  <li className="total"><span>Your return</span><span className="l-pos"><Money v={confirm.lenderReturn} sign /> <span className="l-chip">+{pct(confirm.returnPct)}</span></span></li>
                </ul>
                <div className="tx"><span>Funding transaction</span><Hash value={done.txHash} href={done.explorerUrl} linkLabel="View funding transaction" /></div>
              </div>
              <div className="dialog-f">
                <button type="button" className="btn" onClick={closeDialog}>Done</button>
                {done.tokenUrl ? <a className="btn primary" href={done.tokenUrl} target="_blank" rel="noreferrer">View your note <Icon name="external" /></a> : <button type="button" className="btn primary" onClick={closeDialog}>View your note</button>}
              </div>
            </>
          ) : (
            <>
              <div className="dialog-b l-fund">
                <p className="intro">You buy {possessive(confirm.merchant)} payout for this order. You&apos;re repaid up to the face value when the delivery is verified.</p>
                <div className="l-pay"><span className="k">You pay now</span><span className="v">{fmtAmount(confirm.advance)}<span className="cur">USDT</span></span></div>
                <ul className="lines">
                  <li><span>Seller receives today</span><Money v={confirm.sellerToday} /></li>
                  <li><span>Held as seller bond</span><Money v={confirm.bond} /></li>
                  <li><span>Repaid at delivery</span><Money v={confirm.face} /></li>
                  <li className="total"><span>Your return</span><span><span className="l-pos"><Money v={confirm.lenderReturn} sign /></span> <span className="l-chip">+{pct(confirm.returnPct)}</span></span></li>
                </ul>
                <div className="l-vsteps-h">What happens</div>
                <ol className="l-vsteps">
                  <li><span className="n">1</span><span><b>Approve USDT</b>Your wallet approves USDT for the note contract, if needed.</span></li>
                  <li><span className="n">2</span><span><b>Pay the seller</b>The note contract takes {fmtAmount(confirm.advance)} USDT, pays the seller and locks the order&apos;s payout to the note.</span></li>
                  <li><span className="n">3</span><span><b>Receive the note</b>Note #{noteNo(confirm.tokenId)} is minted to your wallet. If the delivery fails, the bond covers you first.</span></li>
                </ol>
                <div className="l-fine">Your wallet pays the network fee. The offer expires {timeLeft(confirm.deadline)}.</div>
                {msg && <div className="mt-16"><Callout tone="danger" title="Funding didn't go through."><span title={msg}>{friendly(msg)}</span></Callout></div>}
              </div>
              <div className="dialog-f">
                <button type="button" className="btn" disabled={busy} onClick={closeDialog}>Cancel</button>
                <button type="button" className="btn primary" disabled={busy || !m.canFund || avail < Number(confirm.advance)} onClick={() => fund(confirm)}>
                  {busy ? <><Icon name="loader" className="spin" /> Funding…</> : `Fund ${fmtAmount(confirm.advance)} USDT`}
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

function Kpi({ label, value, sub, loading, down }: { label: string; value?: string | number | null; sub?: ReactNode; loading?: boolean; down?: boolean }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{loading ? <Skeleton w={100} h={28} /> : down || !hasAmount(value) ? "—" : <><CountUp value={value} /><span className="cur">USDT</span></>}</div>
      <div className="kpi-sub">{loading ? <Skeleton w={90} h={12} /> : down ? " " : sub ?? " "}</div>
    </div>
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

/** Offer countdown: time left plus a bar draining from listing to deadline. */
function Expiry({ o, now }: { o: Offer; now: number }) {
  const span = Math.max(1, o.deadline - (o.createdAt || o.deadline - 7200));
  const left = Math.max(0, o.deadline - now);
  const p = Math.min(1, left / span);
  return (
    <div className="l-exp">
      <div className="t">{timeLeft(o.deadline, now)}<small>· <Timestamp ts={o.deadline} mode="time" /></small></div>
      <div className={`l-bar ${p < 0.2 ? "low" : ""}`} role="progressbar" aria-label="Time left on offer" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${p * 100}%` }} /></div>
    </div>
  );
}

const Ret = ({ o }: { o: Offer }) => <span className="l-ret"><span className="l-chip">+{pct(o.returnPct)}</span><span className="xs muted tnum">{signed(Number(o.lenderReturn))}</span></span>;

function Offers({ rows, loading, m, avail, now, onFund }: { rows?: Offer[]; loading: boolean; m?: Market; avail: number; now: number; onFund: (o: Offer) => void }) {
  if (rows && !rows.length) return <EmptyState small icon="receipt" title="No invoices on offer">When a merchant requests an advance on a paid order, it appears here.</EmptyState>;
  return (
    <>
      <div className="table-wrap lg-only">
        <table className="data">
          <thead><tr>
            <th>Invoice</th><th>Merchant</th><th>Delivery</th>
            <th className="num">Face value</th><th className="num">Price</th><th className="num">Your return</th><th className="num">Seller bond</th>
            <th>Offer expires</th><th><span className="sr-only">Action</span></th>
          </tr></thead>
          <tbody>
            {loading && <SkeletonRows rows={2} cols={9} />}
            {m && rows?.map((o) => (
              <tr key={o.id}>
                <td className="nowrap"><div className="l-inv"><ProductArt product={o.product} variant="thumb" size={28} /><div><span className="ref">{o.ref}</span><div className="cell-sub">{o.product}</div></div></div></td>
                <td>{o.merchant}</td>
                <td><DeliveryBadge s={o.orderStatus} /></td>
                <td className="num"><Money v={o.face} cur={null} /></td>
                <td className="num"><Money v={o.advance} cur={null} strong /><div className="cell-sub">{pct(o.discountPct)} off</div></td>
                <td className="num"><Ret o={o} /></td>
                <td className="num"><Money v={o.bond} cur={null} /></td>
                <td><Expiry o={o} now={now} /></td>
                <td className="num"><FundButton o={o} m={m} avail={avail} onClick={() => onFund(o)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list lt-lg">
        {loading && [0, 1].map((i) => <li key={i}><Skeleton w="60%" /><div className="mt-8"><Skeleton w="40%" /></div></li>)}
        {m && rows?.map((o) => (
          <li key={o.id}>
            <div className="l-m-head">
              <ProductArt product={o.product} variant="thumb" size={36} />
              <div className="grow"><div className="ref">{o.ref}</div><div className="sub">{o.merchant}{o.product ? ` · ${o.product}` : ""}</div></div>
              <DeliveryBadge s={o.orderStatus} />
            </div>
            <div className="l-grid">
              <div><div className="k">Price · {pct(o.discountPct)} off</div><div className="v">{fmtAmount(o.advance)}<span className="cur">USDT</span></div></div>
              <div><div className="k">Face value</div><div className="v">{fmtAmount(o.face)}<span className="cur">USDT</span></div></div>
              <div><div className="k">Your return</div><div className="v"><span className="l-pos">{signed(Number(o.lenderReturn))}</span><span className="l-chip">+{pct(o.returnPct)}</span></div></div>
              <div><div className="k">Seller bond</div><div className="v">{fmtAmount(o.bond)}<span className="cur">USDT</span></div></div>
            </div>
            <div className="l-m-foot"><Expiry o={o} now={now} /><FundButton o={o} m={m} avail={avail} onClick={() => onFund(o)} /></div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Notes({ rows, loading, kind }: { rows?: Offer[]; loading: boolean; kind: "active" | "closed" }) {
  if (rows && !rows.length) {
    return kind === "active"
      ? <EmptyState small icon="receipt" title="No active notes">Notes you fund appear here until their delivery settles.</EmptyState>
      : <EmptyState small icon="check-circle" title="Nothing closed yet">Notes close automatically when the delivery is verified.</EmptyState>;
  }
  const outcome = (o: Offer) => o.status === "repaid" ? <Badge tone="success">Repaid</Badge> : <Badge tone="warning" title={o.outcome ?? undefined}>Bond used</Badge>;
  const PL = ({ o }: { o: Offer }) => <span className={pl(o) < 0 ? "l-neg" : "l-pos"}>{signed(pl(o))}</span>;
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
            {loading && <SkeletonRows rows={2} cols={7} />}
            {rows?.map((o) => (
              <tr key={o.id}>
                <td className="nowrap"><div className="l-inv"><ProductArt product={o.product} variant="thumb" size={28} /><div><span className="ref">{o.ref}</span><div className="cell-sub"><ExtLink href={o.tokenUrl}>Note #{noteNo(o.tokenId)}</ExtLink></div></div></div></td>
                <td>{o.merchant}<div className="cell-sub">{o.product}</div></td>
                {kind === "active" ? (
                  <>
                    <td><DeliveryBadge s={o.orderStatus} /></td>
                    <td className="num"><Money v={o.advance} cur={null} /></td>
                    <td className="num"><Money v={o.face} cur={null} strong /><div className="cell-sub l-pos">{signed(Number(o.face) - Number(o.advance))}</div></td>
                    <td className="num"><Money v={o.bond} cur={null} /></td>
                    <td className="nowrap"><Timestamp ts={o.fundedAt} /><div className="cell-sub"><Hash value={o.fundTx} href={o.fundTxUrl} linkLabel="View funding transaction" /></div></td>
                  </>
                ) : (
                  <>
                    <td>{outcome(o)}</td>
                    <td className="num"><Money v={o.advance} cur={null} /></td>
                    <td className="num"><Money v={o.toHolder} cur={null} strong /></td>
                    <td className="num tnum"><PL o={o} /></td>
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
        {rows?.map((o) => (
          <li key={o.id}>
            <div className="l-m-head">
              <ProductArt product={o.product} variant="thumb" size={36} />
              <div className="grow"><div className="ref">{o.ref}</div><div className="sub">{o.merchant}{o.product ? ` · ${o.product}` : ""}</div></div>
              {kind === "active" ? <DeliveryBadge s={o.orderStatus} /> : outcome(o)}
            </div>
            <div className="l-grid">
              <div><div className="k">Paid</div><div className="v">{fmtAmount(o.advance)}<span className="cur">USDT</span></div></div>
              {kind === "active"
                ? <><div><div className="k">Due at delivery</div><div className="v">{fmtAmount(o.face)}<span className="cur">USDT</span></div></div>
                    <div><div className="k">Seller bond</div><div className="v">{fmtAmount(o.bond)}<span className="cur">USDT</span></div></div>
                    <div><div className="k">Funded</div><div className="v" style={{ fontWeight: 500, fontSize: 13 }}><Timestamp ts={o.fundedAt} /></div></div></>
                : <><div><div className="k">Received</div><div className="v">{fmtAmount(o.toHolder)}<span className="cur">USDT</span></div></div>
                    <div><div className="k">Profit / loss</div><div className="v"><PL o={o} /></div></div>
                    <div><div className="k">Closed</div><div className="v" style={{ fontWeight: 500, fontSize: 13 }}><Timestamp ts={o.closedAt} /></div></div></>}
            </div>
            <div className="row between mt-12" style={{ gap: 12 }}>
              <ExtLink href={o.tokenUrl}>Note #{noteNo(o.tokenId)}</ExtLink>
              {kind === "active" ? <Hash value={o.fundTx} href={o.fundTxUrl} linkLabel="View funding transaction" /> : <Hash value={o.closeTx} href={o.closeTxUrl} linkLabel="View closing transaction" />}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Page() {
  return <Suspense><Lender /></Suspense>;
}
