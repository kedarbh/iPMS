import './overview.css';
import './director.css';
import '../finance/finance.css';
import { DecidedNotice } from '../finance/decided';
import { getFinanceOverview } from '../lib/finance-api';
import { getCurrentUser } from '../lib/iam-api';
import { getPortfolio } from '../lib/project-api';
import { getMyProfile, listUserDirectory } from '../lib/user-api';
import { getWorkOrderSummary } from '../lib/work-order-api';
import { Sidebar, TopActions } from '../shell';
import { buildPortfolio, headline } from './director-model';
import { DecisionsPanel, MoneyPanel, PortfolioPanel, WaitingPanel } from './director-panels';
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
  const health = portfolio.state === 'ready'
    ? buildPortfolio(portfolio.data, workOrders.state === 'ready' ? workOrders.data : null, money?.projects ?? null, now)
    : [];
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
              <a className="secondary-button" href="/finance/reports">Spend report</a>
              <a className="primary-button" href="/finance?view=awaiting">Open queue</a>
            </div>
          </section>
          <WaitingPanel finance={money} names={names} now={now} />
          <PortfolioPanel
            health={health}
            failure={portfolio.state === 'ready' ? null : portfolio.state === 'unavailable' || portfolio.state === 'forbidden' ? portfolio.message : 'Sign in again to continue.'}
            workOrdersMissing={workOrders.state !== 'ready'}
          />
          <div className="ov-pair">
            <MoneyPanel finance={money} names={names} />
            <DecisionsPanel finance={money} />
          </div>
        </div>
      </section>
    </main>
  );
}
