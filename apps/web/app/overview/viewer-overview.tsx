import './overview.css';
import './director.css';
import { getPortfolio } from '../lib/project-api';
import { getMyProfile } from '../lib/user-api';
import { getWorkOrderSummary, listWorkOrders } from '../lib/work-order-api';
import { Sidebar, StatePage, TopActions } from '../shell';
import { buildPortfolio, headline } from './director-model';
import { PortfolioPanel } from './director-panels';
import { dayLabel, firstName, greeting, percent, statusBreakdown } from './model';
import { Kpi, SignInPage } from './parts';

/**
 * A Viewer's home: how the projects in their scope are doing, and nothing to
 * act on. Viewers hold no approval, dispatch, finance or audit permission, so
 * the page offers no buttons that would only end in a 403.
 */
export async function ViewerOverview() {
  const [portfolio, summary, all, profile] = await Promise.all([
    getPortfolio(), getWorkOrderSummary(), listWorkOrders({ limit: 1 }), getMyProfile(),
  ]);
  if (portfolio.state === 'unauthenticated') return <SignInPage what="your projects" />;
  if (portfolio.state === 'forbidden') {
    return <StatePage eyebrow="ACCESS NEEDED" title="Your account cannot view projects"><p>{portfolio.message}</p><p className="subtle">Ask an administrator for a role that grants <code>project.view</code>.</p></StatePage>;
  }

  const now = new Date();
  const name = firstName(profile?.state === 'ready' ? profile.data.fullName : undefined);
  const projects = portfolio.state === 'ready' ? portfolio.data : [];
  const health = buildPortfolio(projects, summary.state === 'ready' ? summary.data : null, null, now);
  const counts = all.state === 'ready' ? all.data.counts : null;
  const breakdown = counts ? statusBreakdown(counts) : null;
  const sites = projects.reduce((total, project) => total + project.sites.total, 0);
  const approved = counts?.COMPLETED ?? 0;
  const rework = counts?.RECTIFYING ?? 0;
  const late = counts?.OVERDUE ?? 0;
  const dash = '—';
  const summaryLine = portfolio.state === 'ready' ? headline(null, health) : '';

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
              <p>{summaryLine || 'A read-only view of the projects shared with you.'}</p>
            </div>
            <div className="ov-head-actions">
              <a className="secondary-button" href="/projects">View projects</a>
            </div>
          </section>

          <section className="ov-kpis ov-kpis-4" aria-label="Projects shared with you">
            <Kpi label="Projects" value={portfolio.state === 'ready' ? String(projects.length) : dash} unit={`${sites} sites`} note="In your scope" />
            <Kpi label="Approved" value={breakdown ? `${percent(approved, breakdown.total)}%` : dash} unit="of work orders" note={breakdown ? `${approved} of ${breakdown.total}` : 'Work orders unavailable'} tone={breakdown ? 'green' : 'muted'} />
            <Kpi label="Returned for rework" value={counts ? String(rework) : dash} unit="work orders" note={rework > 0 ? 'With the field team' : 'Nothing returned'} tone={rework > 0 ? 'amber' : 'green'} />
            <Kpi label="Overdue" value={counts ? String(late) : dash} unit="work orders" note={late > 0 ? 'Past their planned date' : 'None overdue'} tone={late > 0 ? 'red' : 'green'} />
          </section>

          <PortfolioPanel
            health={health}
            failure={portfolio.state === 'unavailable' ? portfolio.message : null}
            workOrdersMissing={summary.state !== 'ready'}
            showMoney={false}
          />

          <section className="ov-card ov-panel" id="work-order-status">
            <header className="ov-panel-head"><div><h2>Work order status</h2><p>{breakdown ? `${breakdown.total} work orders, cancelled excluded` : 'The QC service did not answer'}</p></div></header>
            {breakdown && breakdown.total > 0 ? (
              <>
                <div className="ov-stack" role="img" aria-label="Work orders by status">
                  {breakdown.segments.filter((s) => s.count > 0).map((s) => <i key={s.status} className={s.tone} style={{ width: `${s.width}%` }} />)}
                </div>
                <ul className="ov-legend">
                  {breakdown.segments.map((s) => <li key={s.status}><i className={s.tone} aria-hidden="true" /><span>{s.label}</span><b>{s.count}</b><em>{s.share}%</em></li>)}
                </ul>
              </>
            ) : <div className="ov-empty"><strong>{breakdown ? 'No work orders yet' : 'Work orders are unavailable'}</strong></div>}
          </section>
        </div>
      </section>
    </main>
  );
}
