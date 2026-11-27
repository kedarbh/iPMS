import './overview.css';
import './director.css';
import './charts.css';
import '../finance/finance.css';
import { DecidedNotice } from '../finance/decided';
import { getFinanceOverview } from '../lib/finance-api';
import { getCurrentUser } from '../lib/iam-api';
import { getPortfolio } from '../lib/project-api';
import { getMyProfile, listUserDirectory } from '../lib/user-api';
import { getWorkOrderSummary } from '../lib/work-order-api';
import { Sidebar, TopActions } from '../shell';
import { buildPortfolio, headline } from './director-model';
import { DeliveryPanel, QualityPanel } from './director-charts';
import { DecisionsPanel, MoneyPanel, PortfolioPanel, WaitingPanel } from './director-panels';
import { portfolioReport, spendSeries } from '../reports/report-model';
import { dayLabel, firstName, greeting } from './model';
import { SignInPage } from './parts';

/**
 * The Project Director's home: what waits on them, which projects are in
 * trouble and why, where the money goes, and what they decided. Each panel
 * renders from its own service, so one that does not answer blanks only
 * its panel.
 */
export async function DirectorOverview({ decided }: { decided?: string | undefined }) {
  const [portfolio, workOrders, finance, viewer, profile, directory] = await Promise.all([
    getPortfolio(), getWorkOrderSummary(), getFinanceOverview(), getCurrentUser(), getMyProfile(), listUserDirectory(),
  ]);
  if (viewer.state === 'unauthenticated' || portfolio.state === 'unauthenticated' || finance.state === 'unauthenticated') return <SignInPage what="your projects" />;

  const now = new Date();
  const money = finance.state === 'ready' ? finance.data : null;
  // A missing permission hides a panel; only a service that failed to answer is reported.
  const mayReadFinance = finance.state !== 'forbidden';
  const summaryData = workOrders.state === 'ready' ? workOrders.data : null;
  const health = portfolio.state === 'ready' ? buildPortfolio(portfolio.data, summaryData, money?.projects ?? null, now) : [];
  // The same joined rows the portfolio report draws, so both pages agree.
  const report = portfolio.state === 'ready' ? portfolioReport(portfolio.data, summaryData, money, now) : null;
  const pace = new Map(report?.rows.map((r) => [r.id, r.weekly]) ?? []);
  const mine = money?.pipeline.steps.find((s) => s.mine);
  const summary = headline(money ? { count: mine?.count ?? 0, amount: mine?.amount ?? '0.00' } : null, health);
  const names = new Map(directory.state === 'ready' ? directory.data.map((p) => [p.id, p.fullName]) : []);
  const name = firstName(profile?.state === 'ready' ? profile.data.fullName : undefined);

  return (
    <main className="app-shell">
      <Sidebar active="overview" />
      <section className="content" id="top">
        <header className="topbar">
          <div className="crumbs"><span>Workspace</span><b>/</b><strong>Overview</strong></div>
          <TopActions />
        </header>
        <div className="dashboard ov">
          {viewer.state === 'ready' ? <DecidedNotice id={decided} viewerId={viewer.data.id} /> : null}
          <section className="ov-head">
            <div>
              <p className="ov-date">{dayLabel(now)}</p>
              <h1>{greeting(now)}{name ? `, ${name}` : ''}</h1>
              {summary ? <p>{summary}</p> : null}
            </div>
            <div className="ov-head-actions">
              <a className="secondary-button" href="/reports">Portfolio report</a>
              <a className="primary-button" href="/finance/queue">Open queue</a>
            </div>
          </section>
          {mayReadFinance ? <WaitingPanel finance={money} names={names} now={now} /> : null}
          {portfolio.state === 'forbidden' ? null : (
            <PortfolioPanel
              health={health}
              failure={portfolio.state === 'unavailable' ? portfolio.message : null}
              workOrdersMissing={workOrders.state === 'unavailable'}
              pace={pace}
            />
          )}
          {report && report.rows.length > 0 ? (
            <div className="ov-pair">
              <DeliveryPanel totals={report.totals} rows={report.rows} />
              {workOrders.state === 'forbidden' ? null : <QualityPanel rows={report.rows} />}
            </div>
          ) : null}
          {mayReadFinance ? (
            <div className="ov-pair">
              <MoneyPanel finance={money} names={names} series={report && money ? spendSeries(report.rows, money.months) : undefined} />
              <DecisionsPanel finance={money} />
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
