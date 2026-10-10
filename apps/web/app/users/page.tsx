import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listUsers } from '../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../shell';

/**
 * Declared here rather than imported: `UserStatusFilter` in `@ipms/contracts`
 * is inferred from a Zod enum, and importing the barrel would pull
 * `node:crypto` and zod into this page for the sake of three string literals.
 * Keep the two in step.
 */
type UserStatusFilterValue = 'ACTIVE' | 'INACTIVE' | 'ALL';

const STATUS_TABS: { value: UserStatusFilterValue; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('') || '?';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; role?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = (['ACTIVE', 'INACTIVE', 'ALL'].includes(params.status ?? '')
    ? params.status
    : 'ALL') as UserStatusFilterValue;

  const [users, viewer] = await Promise.all([
    listUsers({
      search: params.search,
      status,
      role: params.role,
      page: params.page === undefined ? undefined : Number(params.page),
    }),
    getCurrentUser(),
  ]);

  if (users.state === 'unauthenticated') {
    return <StatePage title="Sign in to manage users"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (users.state === 'forbidden') {
    return (
      <StatePage title="Your account cannot view users">
        <p>{users.message}</p>
        <p className="subtle">Ask an administrator for a role that grants <code>user.view</code>.</p>
      </StatePage>
    );
  }
  if (users.state === 'unavailable') {
    return (
      <StatePage title="User directory is not available">
        <p>{users.message}</p>
        {users.correlationId ? <p className="subtle">Correlation ID: <code>{users.correlationId}</code></p> : null}
      </StatePage>
    );
  }

  // For clarity only — the gateway and the service are what enforce this.
  const mayCreate = viewer.state === 'ready' && hasPermission(viewer.data, 'user.create');
  const { items, total, page, limit } = users.data;

  /** Preserves the active filters when paging, so page 2 is page 2 of the same view. */
  const pageHref = (target: number): string => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (status !== 'ALL') query.set('status', status);
    if (params.role) query.set('role', params.role);
    query.set('page', String(target));
    return `/users?${query.toString()}`;
  };

  /** A status tab keeps the search and role, but starts again at page 1. */
  const tabHref = (value: UserStatusFilterValue, withSearch = true): string => {
    const query = new URLSearchParams();
    if (withSearch && params.search) query.set('search', params.search);
    if (value !== 'ALL') query.set('status', value);
    if (params.role) query.set('role', params.role);
    const qs = query.toString();
    return qs ? `/users?${qs}` : '/users';
  };

  return (
    <main className="app-shell">
      <Sidebar active="users" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Users</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div><p className="eyebrow">ALL USERS</p><h1>Users</h1></div>
            {mayCreate ? <a className="primary-button" href="/users/new">New user</a> : null}
          </div>

          <div className="users-controls">
            <nav className="seg" aria-label="Filter by status">
              {STATUS_TABS.map((tab) => (
                <a key={tab.value} href={tabHref(tab.value)} className={tab.value === status ? 'seg-item on' : 'seg-item'} aria-current={tab.value === status ? 'page' : undefined}>
                  {tab.label}
                </a>
              ))}
            </nav>
            {params.search ? (
              <a className="chip chip-clear" href={tabHref(status, false)} aria-label={`Clear search for ${params.search}`}>
                “{params.search}” <span aria-hidden="true">×</span>
              </a>
            ) : null}
            <span className="users-count">{total} {total === 1 ? 'user' : 'users'}</span>
          </div>

          <section className="panel users-panel">
            {items.length === 0
              ? <div className="empty-list"><strong>No users match</strong><p>Try a different name or status, or <a href="/users">show everyone</a>.</p></div>
              : <table className="data-table users-table">
                  <thead>
                    <tr><th>User</th><th>Roles</th><th>Status</th><th>Last sign-in</th><th></th></tr>
                  </thead>
                  <tbody>
                    {items.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <a className="user-cell" href={`/users/${user.id}`}>
                            <span className={user.isActive ? 'user-avatar' : 'user-avatar off'} aria-hidden="true">{initials(user.fullName)}</span>
                            <span className="user-id"><b>{user.fullName}</b><span>{user.email}</span></span>
                          </a>
                        </td>
                        <td>
                          {user.roles.length === 0
                            ? <span className="subtle-dash">—</span>
                            : (
                              <span className="role-pills">
                                {user.roles.map((role) => <span key={role.name} className="role-pill">{role.name}</span>)}
                                {user.financeEnabled === false ? <span className="role-pill role-pill-off" title="Their own company handles their advances and expenses">Finance off</span> : null}
                              </span>
                            )}
                        </td>
                        <td>
                          <span className={user.isActive ? 'status-dot on' : 'status-dot'}>{user.isActive ? 'Active' : 'Inactive'}</span>
                        </td>
                        <td className="muted-cell">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}</td>
                        <td className="row-actions"><a className="ghost-button" href={`/users/${user.id}`}>Open</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>}
          </section>

          {total > limit ? (
            <p className="subtle">
              Showing {items.length} of {total} users.
              {page > 1 ? <> <a href={pageHref(page - 1)}>Previous</a></> : null}
              {page * limit < total ? <> <a href={pageHref(page + 1)}>Next</a></> : null}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
