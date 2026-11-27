import '../overview/overview.css';
import '../overview/director.css';
import '../overview/charts.css';
import './reports.css';
import { getFinanceOverview } from '../lib/finance-api';
import { getCurrentUser } from '../lib/iam-api';
import { getPortfolio } from '../lib/project-api';
import { listUserDirectory } from '../lib/user-api';
import { getWorkOrderSummary } from '../lib/work-order-api';
import { Sidebar, StatePage, TopActions } from '../shell';
import { BarList, type BarItem } from '../overview/charts';
import { DeliveryPanel, QualityPanel } from '../overview/director-charts';
import { MoneyPanel } from '../overview/director-panels';
import { nprShort } from '../overview/director-model';
import { dayLabel } from '../overview/model';
import { Kpi, SignInPage } from '../overview/parts';
import { PrintButton } from './print-button';
import { portfolioReport, spendSeries, type PortfolioReport } from './report-model';

/**
 * The portfolio report: every project in the viewer's scope, joined across
 * delivery, quality and money, drawn as charts and then laid out in full as
 * a table (the table is also the charts' text alternative, and the CSV
 * download carries the same columns). Each service that does not answer
 * blanks only its own sections.
 */
export default async function PortfolioReportPage() {
  const [viewer, portfolio, workOrders, finance, directory] = await Promise.all([
    getCurrentUser(), getPortfolio(), getWorkOrderSummary(), getFinanceOverview(), listUserDirectory(),
  ]);
  if (viewer.state === 'unauthenticated' || portfolio.state === 'unauthenticated') return <SignInPage what="the portfolio report" />;
  if (portfolio.state === 'forbidden') {
    return <StatePage title="The portfolio report is not available"><p>Your role does not include project reporting.</p><a className="primary-button" href="/">Back to overview</a></StatePage>;
  }
  if (portfolio.state !== 'ready') {
    return <StatePage title="The portfolio report is not available"><p>{portfolio.message}</p><a className="primary-button" href="/">Back to overview</a></StatePage>;
  }

  const now = new Date();
  const summary = workOrders.state === 'ready' ? workOrders.data : null;
  const money = finance.state === 'ready' ? finance.data : null;
  const report = portfolioReport(portfolio.data, summary, money, now);
  const names = new Map(directory.state === 'ready' ? directory.data.map((p) => [p.id, p.fullName]) : []);
  const mayReadQuality = workOrders.state !== 'forbidden';
  const mayReadFinance = finance.state !== 'forbidden' && finance.state !== 'unauthenticated';

  return (
    <main className="app-shell">
      <Sidebar active="reports" />
      <section className="content" id="top">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Portfolio report</strong></div>
          <TopActions />
        </header>
        <div className="dashboard ov rp">
          <section className="ov-head">
            <div>
              <p className="ov-date">As of {dayLabel(now)}</p>
              <h1>Portfolio report</h1>
              <p>Delivery, quality and money for {report.totals.projects === 1 ? 'the one project' : `all ${report.totals.projects} projects`} in your scope.</p>
            </div>
            <div className="ov-head-actions rp-actions">
              <PrintButton />
              <a className="primary-button" href="/api/reports/portfolio" download>Download CSV</a>
            </div>
          </section>

          {report.rows.length === 0 ? (
            <section className="ov-card ov-panel"><div className="ov-empty"><strong>No active projects in your scope</strong></div></section>
          ) : (
            <>
              <SummaryStrip report={report} quality={mayReadQuality} finance={mayReadFinance} />
              <nav className="rp-toc" aria-label="Sections">
                <a href="#delivery">Delivery</a>
                {mayReadQuality ? <a href="#quality">Quality</a> : null}
                {mayReadFinance ? <a href="#money">Money</a> : null}
                <a href="#detail">Project detail</a>
              </nav>
              <div className="ov-pair">
                <DeliveryPanel totals={report.totals} rows={report.rows} full />
                {mayReadQuality ? <QualityPanel rows={report.rows} full /> : null}
              </div>
              {mayReadFinance ? (
                <>
                  <MoneyPanel finance={money} names={names} series={money ? spendSeries(money.projects, money.months) : undefined} />
                  {money ? <SpendToDatePanel report={report} /> : null}
                </>
              ) : null}
              <DetailTable report={report} quality={mayReadQuality} finance={mayReadFinance} />
            </>
          )}
        </div>
      </section>
    </main>
  );
}

const dash = '—';
/** "2026-12-15" → "15 Dec 2026" */
const dayShort = (iso: string): string => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function SummaryStrip({ report, quality, finance }: { report: PortfolioReport; quality: boolean; finance: boolean }) {
  const t = report.totals;
  const flagged = t.slipping + t.atRisk;
  return (
    <section className="ov-kpis" aria-label="Portfolio summary">
      <Kpi label="Completion" value={`${t.completion}%`} unit="average" note={`${t.projects} ${t.projects === 1 ? 'project' : 'projects'} · ${t.sites} sites`} />
      <Kpi label="Schedule" value={String(flagged)} unit={flagged === 1 ? 'project flagged' : 'projects flagged'} note={flagged === 0 ? 'All on track' : `${t.slipping} slipping, ${t.atRisk} at risk`} tone={t.slipping > 0 ? 'red' : t.atRisk > 0 ? 'amber' : 'green'} />
      <Kpi label="Tasks overdue" value={String(t.tasksOverdue)} unit={`of ${t.tasksLive} live`} note={`${t.tasksCompleted} completed to date`} />
      {quality ? <Kpi
        label="First-time approval"
        value={t.firstTime === null ? dash : `${t.firstTime}%`}
        unit="last 90 days"
        note={t.workOrdersTotal === null ? 'Quality control did not answer' : `${t.workOrdersApproved} of ${t.workOrdersTotal} work orders approved`}
      /> : null}
      {finance ? <Kpi label="Spent to date" value={t.spentToDate === null ? dash : nprShort(t.spentToDate).replace('NPR ', '')} unit={t.spentToDate === null ? '' : 'NPR'} note={t.spentThisMonth === null ? 'Finance did not answer' : `${nprShort(t.spentThisMonth)} this month`} /> : null}
      {finance ? <Kpi
        label="Cash with engineers"
        value={t.cashHeld === null ? dash : nprShort(t.cashHeld).replace('NPR ', '')}
        unit={t.cashHeld === null ? '' : 'NPR'}
        note={t.overdueSettlements === null ? 'Finance did not answer' : t.overdueSettlements.count > 0 ? `${t.overdueSettlements.count} ${t.overdueSettlements.count === 1 ? 'settlement' : 'settlements'} overdue, ${nprShort(t.overdueSettlements.amount)}` : 'No settlement overdue'}
        tone={t.overdueSettlements && t.overdueSettlements.count > 0 ? 'red' : 'muted'}
      /> : null}
    </section>
  );
}

function SpendToDatePanel({ report }: { report: PortfolioReport }) {
  const rows = report.rows.filter((r) => r.money).sort((a, b) => b.money!.spentToDate - a.money!.spentToDate);
  return (
    <section className="ov-card ov-panel" id="spend-to-date">
      <header className="ov-panel-head"><div><h2>Spent to date by project</h2><p>Reimbursed plus settled since each project began. Cash still out on advances is noted under each project.</p></div></header>
      <BarList
        label="Spent to date by project"
        items={rows.map((r): BarItem => ({
          key: r.id,
          label: <a className="ov-project" href={`/projects/${r.id}`}>{r.code}</a>,
          sub: r.money!.cashHeld > 0 ? `${nprShort(r.money!.cashHeld)} with engineers${r.money!.overdue.count > 0 ? `, ${r.money!.overdue.count} overdue` : ''}` : r.name,
          value: r.money!.spentToDate,
          display: nprShort(r.money!.spentToDate),
        }))}
      />
    </section>
  );
}

function DetailTable({ report, quality, finance }: { report: PortfolioReport; quality: boolean; finance: boolean }) {
  const t = report.totals;
  return (
    <section className="ov-card ov-panel" id="detail">
      <header className="ov-panel-head">
        <div><h2>Project detail</h2><p>Every figure the charts draw, one row per project. The CSV download has the same columns.</p></div>
        <a className="ov-link" href="/api/reports/portfolio" download>Download CSV <span aria-hidden="true">↓</span></a>
      </header>
      <div className="ov-scroll">
        <table className="ov-table rp-table">
          <thead>
            <tr>
              <th>Project</th><th>Schedule</th><th className="num">Done</th><th className="num">Plan</th>
              <th className="num">Tasks overdue</th><th>Next milestone</th>
              {quality ? <><th className="num">Work orders</th><th className="num">Approved</th><th className="num">In review</th><th className="num">Rework</th><th className="num">First time</th><th className="num">Oldest wait</th></> : null}
              {finance ? <><th className="num">Spent to date</th><th className="num">This month</th><th className="num">Cash out</th><th className="num">Overdue</th></> : null}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.id}>
                <td><a className="ov-project" href={`/projects/${r.id}`}>{r.name}</a><span className="ov-sub">{r.code} · {r.sites} sites</span></td>
                <td><span className={`dr-badge ${r.health.schedule.severity}`}>{r.health.schedule.label}</span></td>
                <td className="num">{r.health.completion}%</td>
                <td className="num">{r.health.expected === null ? dash : `${r.health.expected}%`}</td>
                <td className="num">{r.tasks.overdue}</td>
                <td>{r.nextMilestone ? <>{r.nextMilestone.name}<span className="ov-sub">{r.nextMilestone.percent}% of sites{r.nextMilestone.targetDate ? ` · due ${dayShort(r.nextMilestone.targetDate)}` : ''}</span></> : dash}</td>
                {quality ? (
                  <>
                    <td className="num">{r.workOrders?.total ?? dash}</td>
                    <td className="num">{r.workOrders?.byStatus.COMPLETED ?? dash}</td>
                    <td className="num">{r.workOrders?.byStatus.REVIEWING ?? dash}</td>
                    <td className="num">{r.workOrders?.byStatus.RECTIFYING ?? dash}</td>
                    <td className="num">{r.workOrders?.firstTime == null ? dash : `${r.workOrders.firstTime}%`}</td>
                    <td className="num">{r.workOrders?.oldestReviewDays == null ? dash : `${r.workOrders.oldestReviewDays} d`}</td>
                  </>
                ) : null}
                {finance ? (
                  <>
                    <td className="num">{r.money ? nprShort(r.money.spentToDate) : dash}</td>
                    <td className="num">{r.money ? nprShort(r.money.spentThisMonth) : dash}</td>
                    <td className="num">{r.money ? nprShort(r.money.cashHeld) : dash}</td>
                    <td className="num">{r.money ? (r.money.overdue.count > 0 ? `${r.money.overdue.count} · ${nprShort(r.money.overdue.amount)}` : '0') : dash}</td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All projects</th><td />
              <td className="num">{t.completion}%</td><td /><td className="num">{t.tasksOverdue}</td><td />
              {quality ? (
                <>
                  <td className="num">{t.workOrdersTotal ?? dash}</td><td className="num">{t.workOrdersApproved ?? dash}</td>
                  <td className="num">{report.rows.reduce((n, r) => n + (r.workOrders?.byStatus.REVIEWING ?? 0), 0)}</td>
                  <td className="num">{report.rows.reduce((n, r) => n + (r.workOrders?.byStatus.RECTIFYING ?? 0), 0)}</td>
                  <td className="num">{t.firstTime === null ? dash : `${t.firstTime}%`}</td><td />
                </>
              ) : null}
              {finance ? (
                <>
                  <td className="num">{t.spentToDate === null ? dash : nprShort(t.spentToDate)}</td>
                  <td className="num">{t.spentThisMonth === null ? dash : nprShort(t.spentThisMonth)}</td>
                  <td className="num">{t.cashHeld === null ? dash : nprShort(t.cashHeld)}</td>
                  <td className="num">{t.overdueSettlements === null ? dash : t.overdueSettlements.count}</td>
                </>
              ) : null}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
