import { redirect } from 'next/navigation';
import { getFinanceOverview, listRequests } from '../lib/finance-api';
import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listUserDirectory } from '../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../shell';
import { ROLE_LABEL, approverRole, type ApproverRole } from './model';
import { OverviewBody } from './overview-body';
import { RequestsTable } from './requests-table';
import { legacyTarget, resolveSearch, type RawSearch } from './search';

export default async function FinancePage({ searchParams }: { searchParams: Promise<RawSearch> }) {
  const search = await searchParams;
  const old = legacyTarget(search);
  if (old) redirect(old);

  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to see finance"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.view')) {
    return <StatePage title="Finance is not available"><p>Your role does not include finance requests.</p><a className="primary-button" href="/">Back to workspace</a></StatePage>;
  }
  const user = viewer.data;
  const role = hasPermission(user, 'finance_request.view_all') ? approverRole(user.permissions) : null;
  return role ? <ApproverHome role={role} /> : <MyRequests mayRaise={hasPermission(user, 'finance_request.create')} search={search} />;
}

async function ApproverHome({ role }: { role: ApproverRole }) {
  const [overview, directory] = await Promise.all([getFinanceOverview(), listUserDirectory()]);
  if (overview.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>{overview.state === 'unauthenticated' ? 'Sign in again to continue.' : overview.message}</p><a className="primary-button" href="/">Back to workspace</a></StatePage>;
  }
  const names = new Map(directory.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);
  return (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><span>Finance</span><b>/</b><strong>Overview</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">{ROLE_LABEL[role].toUpperCase()}</p><h1>Finance</h1>
              <p className="subtle">What waits on you, and where the cash is.</p>
            </div>
          </div>
          <OverviewBody overview={overview.data} names={names} role={role} now={new Date()} />
        </div>
      </section>
    </main>
  );
}

/** Someone who approves nothing: their own requests, as before. */
async function MyRequests({ mayRaise, search }: { mayRaise: boolean; search: RawSearch }) {
  const { page } = resolveSearch(search, { mayAct: false, seeAll: false, mayRaise });
  const [result, directory] = await Promise.all([listRequests({ view: 'mine', page }), listUserDirectory()]);
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
          <div className="toolbar">
            <div>
              <p className="eyebrow">FINANCE</p><h1>Advances &amp; settlements</h1>
              <p className="subtle">Requests for money, their approvals, and where each one stands.</p>
            </div>
            {mayRaise ? <a className="primary-button" href="/finance/new">+ New request</a> : null}
          </div>
          <section className="panel">
            <RequestsTable page={result.data} names={names} view="mine" pageHref={(n) => `/finance?page=${n}`} />
          </section>
        </div>
      </section>
    </main>
  );
}
