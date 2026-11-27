import './overview.css';
import './director.css';
import '../finance/finance.css';
import { formatMoney } from '../finance/model';
import { getFinanceOverview } from '../lib/finance-api';
import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listAuditEvents } from '../lib/audit-api';
import { getProjectDashboard } from '../lib/project-api';
import { getMyProfile, listUserDirectory, listUsers } from '../lib/user-api';
import { WaitingPanel } from './director-panels';
import { listWorkOrders } from '../lib/work-order-api';
import { WORK_ORDERS_PATH, WORK_ORDER_TYPE_LABEL, dueText } from '../quality/work-orders/labels';
import { auditRow, dayLabel, firstName, greeting, percent, statusBreakdown, whenLabel, workOrderRef } from './model';
import { Sidebar, StatePage, TopActions } from '../shell';

function Kpi({ label, value, unit, note, tone = 'muted' }: {
  label: string; value: string; unit: string; note: string; tone?: 'muted' | 'green' | 'amber' | 'red';
}) {
  return (
    <article className="ov-card ov-kpi">
      <p className="ov-kpi-label">{label}</p>
      <p className="ov-kpi-value"><strong>{value}</strong><span>{unit}</span></p>
      <p className={`ov-kpi-note ${tone}`}>{note}</p>
    </article>
  );
}

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></svg>
);
/** The project manager's home: work orders and finance requests waiting on their decision, then how their projects are doing. */
export async function ManagerOverview() {
  const [dashboard, review, rework, viewer, profile, audit, users, finance, directory] = await Promise.all([
    getProjectDashboard(),
    listWorkOrders({ status: 'REVIEWING', limit: 20 }),
    listWorkOrders({ limit: 1 }),
    getCurrentUser(),
    getMyProfile(),
    listAuditEvents(10),
    listUsers(),
    getFinanceOverview(),
    listUserDirectory(),
  ]);

  if (dashboard.state === 'unauthenticated') return <StatePage eyebrow="SECURE WORKSPACE" title="Sign in to see your projects"><p>Your decision queue reads live data through the iPMS gateway.</p><a className="primary-button" href="/login">Sign in</a></StatePage>;
  if (dashboard.state === 'forbidden') return <StatePage eyebrow="ACCESS NEEDED" title="Your account cannot view projects"><p>{dashboard.message}</p><p className="subtle">Ask an administrator for a role that grants <code>project.view</code>.</p></StatePage>;
  if (dashboard.state === 'unavailable') return <StatePage eyebrow="CONNECTION NEEDED" title="Project API is not available"><p>{dashboard.message}</p><p className="subtle">Start the gateway, Project service, PostgreSQL, Redis, and NATS, then refresh this page.</p><code>docker compose -f docker/docker-compose.yml up</code>{dashboard.correlationId ? <p className="subtle">Correlation ID: <code>{dashboard.correlationId}</code></p> : null}</StatePage>;

  const now = new Date();
  const perProject = await Promise.all(dashboard.data.projects.map((project) => listWorkOrders({ projectId: project.id, limit: 1 })));
  const mayCreate = viewer.state === 'ready' && hasPermission(viewer.data, 'task.create') && hasPermission(viewer.data, 'task.assign');
  const name = firstName(profile?.state === 'ready' ? profile.data.fullName : undefined);

  // Most overdue first, then soonest due: the order a manager should clear them in.
  const waiting = review.state === 'ready'
    ? [...review.data.items].sort((a, b) => new Date(a.plannedCompletionAt).getTime() - new Date(b.plannedCompletionAt).getTime())
    : [];
  const reviewTotal = review.state === 'ready' ? review.data.counts.REVIEWING : 0;
  const lateCount = waiting.filter((order) => dueText(order, now).tone === 'red').length;
  const reworkCount = rework.state === 'ready' ? rework.data.counts.RECTIFYING : 0;

  // A manager without finance approval simply has no finance panel; only a service that failed is reported.
  const showFinance = finance.state !== 'forbidden' && finance.state !== 'unauthenticated';
  const money = finance.state === 'ready' ? finance.data : null;
  const financeWaiting = money?.waiting.total ?? 0;
  const names = new Map(directory.state === 'ready' ? directory.data.map((p) => [p.id, p.fullName]) : []);

  const people = new Map(users.state === 'ready' ? users.data.items.map((u) => [u.id, u]) : []);
  const activity = audit.state === 'ready'
    ? audit.data.items.slice(0, 5).map((event) => {
      const actor = event.actorId ? people.get(event.actorId) : undefined;
      return auditRow(event, actor?.fullName ?? (event.actorId ? 'Someone' : 'System'), '');
    })
    : [];

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
                {review.state !== 'ready' ? 'Work orders are unavailable right now.'
                  : reviewTotal === 0 ? 'No work orders are waiting on you.'
                    : `${reviewTotal} work order${reviewTotal === 1 ? '' : 's'} need${reviewTotal === 1 ? 's' : ''} your decision${lateCount > 0 ? `, ${lateCount} overdue` : ''}.`}
              </p>
            </div>
            <div className="ov-head-actions">
              <a className="secondary-button" href="/finance">{financeWaiting > 0 ? `Finance requests (${financeWaiting})` : 'Finance requests'}</a>
              {mayCreate ? <a className="primary-button" href={`${WORK_ORDERS_PATH}/new`}>+ New work order</a> : null}
            </div>
          </section>

          <section className="ov-kpis" aria-label="What is waiting on you">
            <Kpi label="Awaiting QC review" value={review.state === 'ready' ? String(reviewTotal) : '—'} unit="work orders" note={lateCount > 0 ? `${lateCount} overdue` : 'None overdue'} tone={lateCount > 0 ? 'red' : 'green'} />
            <Kpi label="Returned for rework" value={rework.state === 'ready' ? String(reworkCount) : '—'} unit="with field team" note={reworkCount > 0 ? 'Waiting on resubmission' : 'Nothing returned'} tone={reworkCount > 0 ? 'amber' : 'green'} />
            {showFinance ? (
              <Kpi label="Finance approvals" value={money ? String(financeWaiting) : '—'} unit="requests" note={money ? (financeWaiting > 0 ? formatMoney(money.waiting.amount) : 'Nothing waiting') : 'Finance unavailable'} tone={money && financeWaiting > 0 ? 'amber' : money ? 'green' : 'muted'} />
            ) : null}
          </section>

          <section className="ov-card ov-panel" id="decisions">
            <header className="ov-panel-head">
              <div><h2>Needs your decision</h2><p>Overdue and oldest first</p></div>
              <a className="ov-link" href={WORK_ORDERS_PATH}>Open full queue <span aria-hidden="true">→</span></a>
            </header>
            <ul className="mg-queue">
              {waiting.map((order) => {
                const due = dueText(order, now);
                return (
                  <li key={order.id}>
                    <span className="mg-icon" aria-hidden="true"><CheckIcon /></span>
                    <div className="mg-main">
                      <p><a href={`${WORK_ORDERS_PATH}/${order.id}`}>{order.title}</a><code>{workOrderRef(order.id)}</code></p>
                      <span>{order.site.siteCode} · {order.project.name}</span>
                      <span>{WORK_ORDER_TYPE_LABEL[order.workOrderType]}</span>
                    </div>
                    <div className="mg-end">
                      <b className={due.tone}>{due.text}</b>
                      <a className="mg-review" href={`${WORK_ORDERS_PATH}/${order.id}`}>Review</a>
                    </div>
                  </li>
                );
              })}
              {review.state === 'ready' && waiting.length === 0 ? (
                <li className="mg-empty"><div><strong>No work orders to review</strong><p>New submissions from the field appear here.</p></div></li>
              ) : null}
              {review.state !== 'ready' ? (
                <li className="mg-empty"><div><strong>Work orders are unavailable</strong><p>The QC service did not answer.</p></div></li>
              ) : null}
            </ul>
          </section>

          {showFinance ? <WaitingPanel finance={money} names={names} now={now} title="Finance waiting on you" emptyText="Advances and reimbursements your engineers raise reach you first." /> : null}

          <section className="ov-card ov-panel" id="projects">
            <header className="ov-panel-head">
              <div><h2>Projects</h2><p>Work order status by project</p></div>
              <a className="ov-link" href="/projects">All <span aria-hidden="true">→</span></a>
            </header>
            {dashboard.data.projects.length === 0 ? (
              <div className="ov-empty"><strong>No active projects yet</strong></div>
            ) : (
              <ul className="mg-projects">
                {dashboard.data.projects.map((project, index) => {
                  const result = perProject[index];
                  const parts = result?.state === 'ready' ? statusBreakdown(result.data.counts) : null;
                  const by = (status: string) => parts?.segments.find((s) => s.status === status)?.count ?? 0;
                  return (
                    <li key={project.id}>
                      <div className="mg-project-head">
                        <div><a className="ov-project" href={`/projects/${project.id}`}>{project.name}</a><span className="ov-sub">{project.code} · {project._count.sites} sites</span></div>
                        <b>{parts ? `${percent(by('COMPLETED'), parts.total)}%` : '—'}</b>
                      </div>
                      {parts && parts.total > 0 ? (
                        <>
                          <div className="ov-stack" role="img" aria-label="Work orders by status">
                            {parts.segments.filter((s) => s.count > 0).map((s) => <i key={s.status} className={s.tone} style={{ width: `${s.width}%` }} />)}
                          </div>
                          <p className="mg-project-legend">
                            <span>{by('COMPLETED')} approved</span><span>{by('REVIEWING')} in QC</span><span>{by('ONGOING') + by('NOT_STARTED')} to do</span>
                            {by('RECTIFYING') > 0 ? <span className="red">{by('RECTIFYING')} in rework</span> : <span className="green">No rework</span>}
                          </p>
                        </>
                      ) : <p className="ov-sub">{parts ? 'No work orders yet' : 'Work orders unavailable'}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="ov-card ov-panel" id="activity">
            <header className="ov-panel-head"><div><h2>Recent activity</h2></div></header>
            {audit.state !== 'ready' ? (
              <p className="ov-note">{audit.state === 'forbidden' ? 'Your role cannot read the audit ledger, so recent activity is not shown.' : 'The audit ledger did not answer.'}</p>
            ) : activity.length === 0 ? (
              <div className="ov-empty"><strong>Nothing recorded yet</strong></div>
            ) : (
              <ul className="mg-activity">
                {activity.map((row) => (
                  <li key={row.key} className={row.tone}>
                    <p>{row.text} <code>{row.ref}</code> <span>· {row.actor}</span></p>
                    <time dateTime={row.at.toISOString()}>{whenLabel(row.at, now)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
