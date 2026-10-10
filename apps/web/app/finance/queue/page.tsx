import { getFinanceOverview, listRequests, type RequestKind } from '../../lib/finance-api';
import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { listUserDirectory } from '../../lib/user-api';
import { redirect } from 'next/navigation';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { DecidedNotice } from '../decided';
import { KIND_PLURAL, ROLE_LABEL, approverRole, formatMoney } from '../model';
import { QueueTable } from '../queue-table';

const KINDS: readonly RequestKind[] = ['ADVANCE', 'SETTLEMENT', 'REIMBURSEMENT'];

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ kind?: string; page?: string; decided?: string }> }) {
  const search = await searchParams;
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') return <StatePage title="Sign in to see finance"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.view')) {
    return <StatePage title="Finance is not available"><p>Your role does not include finance requests.</p><a className="primary-button" href="/">Back to workspace</a></StatePage>;
  }
  const user = viewer.data;
  const role = hasPermission(user, 'finance_request.view_all') ? approverRole(user.permissions) : null;
  if (!role) redirect('/finance');

  const kind = KINDS.find((k) => k === search.kind);
  const page = Math.max(1, Math.floor(Number(search.page)) || 1);
  const [list, overview, directory] = await Promise.all([
    listRequests({ view: 'awaiting', page, limit: 50, ...(kind ? { kind } : {}) }), getFinanceOverview(), listUserDirectory(),
  ]);
  if (list.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>{list.state === 'unauthenticated' ? 'Sign in again to continue.' : list.message}</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }
  const waiting = overview.state === 'ready' ? overview.data.waiting : null;
  const names = Object.fromEntries(directory.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);
  const pill = (key: string, label: string, count: number | null, href: string, current: boolean) => (
    <a key={key} className="fin-pill-link" href={href} aria-current={current ? 'page' : undefined}>{label}{count === null ? null : <span className="fin-count">{count}</span>}</a>
  );

  return (
    <main className="app-shell">
      <Sidebar active="finance-queue" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><strong>Queue</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <DecidedNotice id={search.decided} viewerId={user.id} />
          <div className="toolbar">
            <div>
              <p className="eyebrow">{ROLE_LABEL[role].toUpperCase()}</p><h1>Queue</h1>
              <p className="subtle">Requests waiting for your decision.</p>
            </div>
          </div>
          <section className="panel">
            <nav className="fin-pills" aria-label="Kinds">
              {pill('all', 'All', waiting?.total ?? null, '/finance/queue', !kind)}
              {KINDS.map((k) => pill(k, KIND_PLURAL[k], waiting?.byKind[k].count ?? null, `/finance/queue?kind=${k}`, kind === k))}
              {waiting ? <span className="fin-pills-total">{waiting.total} waiting · {formatMoney(waiting.amount)}</span> : null}
            </nav>
            <QueueTable items={list.data.items} names={names} permissions={[...user.permissions]} now={new Date().toISOString()} />
          </section>
        </div>
      </section>
    </main>
  );
}
