import './overview.css';
import { getMyProfile } from '../lib/user-api';
import { listWorkOrders } from '../lib/work-order-api';
import { STATUS_TEXT, WORK_ORDERS_PATH, WORK_ORDER_TYPE_LABEL, dueText } from '../quality/work-orders/labels';
import { dayLabel, firstName, greeting, statusBreakdown, workOrderRef } from './model';
import { CheckIcon, Kpi, SignInPage } from './parts';
import { Sidebar, TopActions } from '../shell';

/** A field engineer's home: their own work orders, rework first. The API already narrows every read to what is assigned to them. */
export async function EngineerOverview({ canViewFinance }: { canViewFinance: boolean }) {
  const [open, profile] = await Promise.all([listWorkOrders({ view: 'open', limit: 12 }), getMyProfile()]);
  if (open.state === 'unauthenticated') return <SignInPage what="your work" />;

  const now = new Date();
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
