import { listRequests } from '../../lib/finance-api';
import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { listUserDirectory } from '../../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { RequestsTable } from '../requests-table';
import { APPROVAL_PERMISSIONS, KIND_LABEL, STATUS_LABEL } from '../model';
import { HISTORY_PILLS, historyHref, rawFilters, resolveHistory, type RawHistory } from '../search';

export default async function HistoryPage({ searchParams }: { searchParams: Promise<RawHistory> }) {
  const search = await searchParams;
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') return <StatePage title="Sign in to see finance"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.view')) {
    return <StatePage title="Finance is not available"><p>Your role does not include finance requests.</p><a className="primary-button" href="/">Back to workspace</a></StatePage>;
  }
  const user = viewer.data;
  const seeAll = hasPermission(user, 'finance_request.view_all');
  const mayAct = APPROVAL_PERMISSIONS.some((p) => hasPermission(user, p));
  const query = resolveHistory(search, { mayAct, seeAll });

  const [result, directory] = await Promise.all([
    listRequests({ view: query.view, page: query.page, ...(query.status ? { status: query.status } : {}), ...(query.stage ? { stage: query.stage } : {}), ...(query.kind ? { kind: query.kind } : {}), ...(query.q ? { q: query.q } : {}) }),
    listUserDirectory(),
  ]);
  if (result.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>{result.state === 'unauthenticated' ? 'Sign in again to continue.' : result.message}</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }
  const names = new Map(directory.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);
  // "Decided by me" is for approvers who see everything; "My requests" only matters to someone whose default view is everyone's.
  const raw = rawFilters(query);
  const pills = HISTORY_PILLS.filter((p) => (p.key !== 'handled' || (mayAct && seeAll)) && (p.key !== 'mine' || seeAll));

  return (
    <main className="app-shell">
      <Sidebar active="finance-history" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><strong>History</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">FINANCE</p><h1>History</h1>
              <p className="subtle">{seeAll ? 'Every request in your projects.' : 'Every request you have raised.'}</p>
            </div>
          </div>
          <section className="panel">
            <form className="fin-search" action="/finance/history" role="search">
              {query.pill !== 'all' ? <input type="hidden" name="filter" value={query.pill} /> : null}
              {raw.status ? <input type="hidden" name="status" value={raw.status} /> : null}
              {raw.kind ? <input type="hidden" name="kind" value={raw.kind} /> : null}
              <input type="search" name="q" defaultValue={query.q ?? ''} placeholder="Search number, purpose, project" aria-label="Search requests" />
              <button className="ghost-button" type="submit">Search</button>
            </form>
            {raw.status || raw.kind ? (
              <p className="fin-pills">
                {raw.status ? <span className="fin-pill-link">Status: {STATUS_LABEL[raw.status]} <a href={historyHref({ filter: query.pill, ...(query.q ? { q: query.q } : {}), ...(raw.kind ? { kind: raw.kind } : {}) })} aria-label={`Clear status filter: ${STATUS_LABEL[raw.status]}`}>Clear</a></span> : null}
                {raw.kind ? <span className="fin-pill-link">Kind: {KIND_LABEL[raw.kind]} <a href={historyHref({ filter: query.pill, ...(query.q ? { q: query.q } : {}), ...(raw.status ? { status: raw.status } : {}) })} aria-label={`Clear kind filter: ${KIND_LABEL[raw.kind]}`}>Clear</a></span> : null}
              </p>
            ) : null}
            <nav className="fin-pills" aria-label="Status">
              {pills.map((p) => (
                <a key={p.key} className="fin-pill-link" href={historyHref({ filter: p.key, ...(query.q ? { q: query.q } : {}) })} aria-current={query.pill === p.key ? 'page' : undefined}>{p.label}</a>
              ))}
            </nav>
            <RequestsTable page={result.data} names={names} view={query.view} pageHref={(n) => historyHref({ filter: query.pill, ...(query.q ? { q: query.q } : {}), ...raw, page: n })} />
          </section>
        </div>
      </section>
    </main>
  );
}
