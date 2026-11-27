import './overview.css';
import { KIND_LABEL, STATUS_LABEL, formatMoney } from '../finance/model';
import { getRequest, listRequests } from '../lib/finance-api';
import { getMyProfile } from '../lib/user-api';
import { listWorkOrders } from '../lib/work-order-api';
import { STATUS_TEXT, WORK_ORDERS_PATH, WORK_ORDER_TYPE_LABEL, dueText } from '../quality/work-orders/labels';
import { engineerMoney, kathmanduToday, type AdvanceDetail, type EngineerMoney } from './engineer-money';
import { dayLabel, firstName, greeting, statusBreakdown, workOrderRef } from './model';
import { CheckIcon, Kpi, SignInPage } from './parts';
import { Sidebar, TopActions } from '../shell';

/** Paid advances whose balance and settle-by day the dashboard reads, most recent first. */
const ADVANCE_DETAILS = 6;

/** The engineer's own requests and the balance of each open advance; null when finance did not answer. */
async function loadMoney(now: Date): Promise<EngineerMoney | null> {
  const mine = await listRequests({ view: 'mine', limit: 100 });
  if (mine.state !== 'ready') return null;
  const paid = mine.data.items.filter((r) => r.kind === 'ADVANCE' && r.status === 'PAID').slice(0, ADVANCE_DETAILS);
  const details = new Map<string, AdvanceDetail>();
  await Promise.all(paid.map(async (r) => {
    const detail = await getRequest(r.id);
    if (detail.state === 'ready') details.set(r.id, { balance: detail.data.balance, settlementDueOn: detail.data.settlementDueOn });
  }));
  return engineerMoney(mine.data.items, details, kathmanduToday(now));
}

/** A field engineer's home: their own work orders, rework first, then the money they hold. The API already narrows every read to what is assigned to them. */
export async function EngineerOverview({ canViewFinance }: { canViewFinance: boolean }) {
  const now = new Date();
  const [open, profile, money] = await Promise.all([
    listWorkOrders({ view: 'open', limit: 12 }), getMyProfile(), canViewFinance ? loadMoney(now) : Promise.resolve(null),
  ]);
  if (open.state === 'unauthenticated') return <SignInPage what="your work" />;

  const name = firstName(profile?.state === 'ready' ? profile.data.fullName : undefined);
  const counts = open.state === 'ready' ? open.data.counts : null;
  const breakdown = counts ? statusBreakdown(counts) : null;
  // Returned work first: it is blocking someone else. The API already orders the rest soonest-due first.
  const mine = open.state === 'ready'
    ? [...open.data.items].sort((a, b) => Number(b.status === 'RECTIFYING') - Number(a.status === 'RECTIFYING'))
    : [];
  const todo = counts ? counts.NOT_STARTED + counts.ONGOING : 0;
  const rework = counts?.RECTIFYING ?? 0;
  const late = counts?.OVERDUE ?? 0;

  return (
    <main className="app-shell">
      <Sidebar active="overview" />
      <section className="content" id="top">
        <header className="topbar">
          <div className="crumbs"><span>Workspace</span><b>/</b><strong>Overview</strong></div>
          <TopActions />
        </header>

        <div className="dashboard ov">
          <section className="ov-head">
            <div>
              <p className="ov-date">{dayLabel(now)}</p>
              <h1>{greeting(now)}{name ? `, ${name}` : ''}</h1>
              <p>
                {!counts ? 'Your work orders are unavailable right now.'
                  : rework > 0 ? `${rework} work order${rework === 1 ? ' was' : 's were'} returned for rework${late > 0 ? `, ${late} overdue` : ''}.`
                    : todo + counts.RECTIFYING === 0 ? 'You have nothing to do right now.'
                      : `${todo} work order${todo === 1 ? '' : 's'} to do${late > 0 ? `, ${late} overdue` : ''}.`}
              </p>
            </div>
            {canViewFinance ? (
              <div className="ov-head-actions">
                <a className="secondary-button" href="/finance">Finance requests</a>
                <a className="primary-button" href="/finance/new">+ New request</a>
              </div>
            ) : null}
          </section>

          <section className="ov-kpis ov-kpis-4" aria-label="Your work">
            <Kpi label="To do" value={counts ? String(todo) : '—'} unit="work orders" note={late > 0 ? `${late} overdue` : 'None overdue'} tone={late > 0 ? 'red' : 'green'} />
            <Kpi label="Returned for rework" value={counts ? String(rework) : '—'} unit="work orders" note={rework > 0 ? 'Fix and resubmit' : 'Nothing returned'} tone={rework > 0 ? 'amber' : 'green'} />
            <Kpi label="In review" value={counts ? String(counts.REVIEWING) : '—'} unit="submitted" note={counts && counts.REVIEWING > 0 ? 'Waiting for QC' : 'Nothing waiting'} />
            <Kpi label="Approved" value={counts ? String(counts.COMPLETED) : '—'} unit="work orders" note="Passed QC" tone="green" />
          </section>

          <section className="ov-card ov-panel" id="my-work">
            <header className="ov-panel-head">
              <div><h2>Your work</h2><p>Returned work first, then soonest due</p></div>
              <a className="ov-link" href={WORK_ORDERS_PATH}>All my work orders <span aria-hidden="true">→</span></a>
            </header>
            <ul className="mg-queue">
              {mine.map((order) => {
                const due = dueText(order, now);
                const status = STATUS_TEXT[order.status];
                return (
                  <li key={order.id}>
                    <span className="mg-icon" aria-hidden="true"><CheckIcon /></span>
                    <div className="mg-main">
                      <p><a href={`${WORK_ORDERS_PATH}/${order.id}`}>{order.title}</a><code>{workOrderRef(order.id)}</code><span className={`ov-tag ${status.tone}`}>{status.label}</span></p>
                      <span>{order.site.siteCode} · {order.project.name}</span>
                      <span>{WORK_ORDER_TYPE_LABEL[order.workOrderType]}</span>
                    </div>
                    <div className="mg-end">
                      <b className={due.tone}>{due.text}</b>
                      <a className="mg-review" href={`${WORK_ORDERS_PATH}/${order.id}`}>{order.status === 'RECTIFYING' ? 'Fix' : 'Open'}</a>
                    </div>
                  </li>
                );
              })}
              {open.state === 'ready' && mine.length === 0 ? <li className="mg-empty"><div><strong>Nothing assigned right now</strong><p>Work orders your project manager assigns to you appear here.</p></div></li> : null}
              {open.state !== 'ready' ? <li className="mg-empty"><div><strong>Work orders are unavailable</strong><p>{open.state === 'forbidden' ? open.message : 'The QC service did not answer.'}</p></div></li> : null}
            </ul>
          </section>

          {canViewFinance ? <MoneyPanel money={money} /> : null}

          <section className="ov-card ov-panel" id="work-order-status">
            <header className="ov-panel-head"><div><h2>Your progress</h2><p>{breakdown ? `${breakdown.total} work orders assigned to you` : 'Unavailable'}</p></div></header>
            {breakdown && breakdown.total > 0 ? (
              <>
                <div className="ov-stack" role="img" aria-label="Your work orders by status">
                  {breakdown.segments.filter((s) => s.count > 0).map((s) => <i key={s.status} className={s.tone} style={{ width: `${s.width}%` }} />)}
                </div>
                <ul className="ov-legend">
                  {breakdown.segments.map((s) => <li key={s.status}><i className={s.tone} aria-hidden="true" /><span>{s.label}</span><b>{s.count}</b><em>{s.share}%</em></li>)}
                </ul>
              </>
            ) : <div className="ov-empty"><strong>No work orders yet</strong></div>}
          </section>
        </div>
      </section>
    </main>
  );
}

/** Cash the engineer holds, when each advance must be settled, and requests still moving. */
function MoneyPanel({ money }: { money: EngineerMoney | null }) {
  if (!money) {
    return (
      <section className="ov-card ov-panel" id="money">
        <header className="ov-panel-head"><div><h2>Your money</h2></div></header>
        <p className="ov-note">Finance did not answer, so your advances cannot be shown. <a className="ov-link" href="/finance">Open finance</a></p>
      </section>
    );
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return (
    <section className="ov-card ov-panel" id="money">
      <header className="ov-panel-head">
        <div><h2>Your money</h2><p>Advances you hold, overdue first, and requests still in approval</p></div>
        <a className="ov-link" href="/finance">All my requests <span aria-hidden="true">→</span></a>
      </header>
      <section className="ov-kpis ov-kpis-4" aria-label="Your money">
        <Kpi label="Cash with you" value={formatMoney(money.cashWithYou)} unit="" note={plural(money.advances.length, 'open advance')} />
        <Kpi label="Overdue to settle" value={String(money.overdue)} unit={money.overdue === 1 ? 'advance' : 'advances'} note={money.overdue > 0 ? 'Settle or return the cash' : 'Nothing overdue'} tone={money.overdue > 0 ? 'red' : 'green'} />
        <Kpi label="In approval" value={String(money.inApproval.count)} unit="requests" note={money.inApproval.count > 0 ? formatMoney(money.inApproval.amount) : 'Nothing waiting'} />
        <Kpi label="Sent back to you" value={String(money.returned.length)} unit="requests" note={money.returned.length > 0 ? 'Fix and resubmit' : money.drafts > 0 ? `${plural(money.drafts, 'draft')} not sent` : 'Nothing returned'} tone={money.returned.length > 0 ? 'amber' : 'green'} />
      </section>
      <ul className="mg-queue">
        {money.returned.map((r) => (
          <li key={r.id}>
            <span className="mg-icon" aria-hidden="true">₨</span>
            <div className="mg-main">
              <p><a href={`/finance/requests/${r.id}`}>{r.purpose}</a><code>{r.number}</code><span className="ov-tag amber">{STATUS_LABEL[r.status]}</span></p>
              <span>{KIND_LABEL[r.kind]} · {r.projectCode}</span>
            </div>
            <div className="mg-end">
              <b>{formatMoney(r.approvedAmount ?? r.requestedAmount)}</b>
              <a className="mg-review" href={`/finance/requests/${r.id}`}>Fix</a>
            </div>
          </li>
        ))}
        {money.advances.map((a) => (
          <li key={a.id}>
            <span className="mg-icon" aria-hidden="true">₨</span>
            <div className="mg-main">
              <p><a href={`/finance/requests/${a.id}`}>{a.purpose}</a><code>{a.number}</code></p>
              <span>Advance · {a.projectCode}</span>
            </div>
            <div className="mg-end">
              <b>{formatMoney(a.outstanding)}</b>
              {a.due ? <span className={`ov-sub${a.due.overdue ? ' red' : ''}`}>{a.due.label}</span> : null}
              <a className="mg-review" href={`/finance/new?kind=SETTLEMENT&advanceId=${a.id}`}>Settle</a>
            </div>
          </li>
        ))}
        {money.advances.length === 0 && money.returned.length === 0 ? (
          <li className="mg-empty"><div><strong>No cash out and nothing to fix</strong><p>Advances you are paid appear here until you settle them.</p></div></li>
        ) : null}
      </ul>
    </section>
  );
}
