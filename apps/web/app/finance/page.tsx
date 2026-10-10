import type { RequestView } from '../lib/finance-api';
import { listRequests } from '../lib/finance-api';
import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listUserDirectory } from '../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../shell';
import { DecidedNotice } from './decided';
import { RequestsTable, financeHref } from './requests-table';
import { resolveSearch, type RawSearch } from './search';

const LABEL: Record<RequestView, string> = { awaiting: 'Waiting for me', handled: 'Decided by me', mine: 'My requests', all: 'All requests' };

export default async function FinancePage({ searchParams }: { searchParams: Promise<RawSearch> }) {
  const search = await searchParams;
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to see finance"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.view')) {
    return <StatePage title="Finance is not available"><p>Your role does not include finance requests.</p><a className="primary-button" href="/">Back to workspace</a></StatePage>;
  }

  const user = viewer.data;
  const mayAct = ['finance_approval.pm', 'finance_approval.director', 'finance_payment.record'].some((p) => hasPermission(user, p));
  const mayRaise = hasPermission(user, 'finance_request.create');
  const seeAll = hasPermission(user, 'finance_request.view_all');
  const { view, status, kind, page, tabs } = resolveSearch(search, { mayAct, seeAll, mayRaise });
  const query = { ...(status ? { status } : {}), ...(kind ? { kind } : {}) };

  const [result, directory] = await Promise.all([
    listRequests({ view, page, ...query }),
    listUserDirectory(),
  ]);
  if (result.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>{result.state === 'unauthenticated' ? 'Sign in again to continue.' : result.message}</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }
  const names = new Map(directory.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);

  return (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Finance</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <DecidedNotice id={search.decided} viewerId={user.id} />
          <div className="toolbar">
            <div>
              <p className="eyebrow">FINANCE</p><h1>Advances &amp; settlements</h1>
              <p className="subtle">Requests for money, their approvals, and where each one stands.</p>
            </div>
            {mayRaise ? <a className="primary-button" href="/finance/new">+ New request</a> : null}
          </div>
          <section className="panel">
            <nav className="finance-tabs" aria-label="Views">
              {tabs.map((tab) => (
                <a key={tab} href={financeHref(tab, query)} aria-current={tab === view ? 'page' : undefined}>{LABEL[tab]}</a>
              ))}
            </nav>
            <RequestsTable page={result.data} names={names} view={view} query={query} />
          </section>
        </div>
      </section>
    </main>
  );
}
