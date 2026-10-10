import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUser = vi.fn();
vi.mock('./lib/iam-api', async () => {
  const actual = await vi.importActual<typeof import('./lib/iam-api')>('./lib/iam-api');
  return { ...actual, getCurrentUser };
});

const cookieStore = { get: vi.fn() };
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookieStore) }));

const getMyProfile = vi.fn();
vi.mock('./lib/user-api', () => ({ getMyProfile }));

const listWorkOrders = vi.fn();
vi.mock('./lib/work-order-api', () => ({ listWorkOrders }));

const { Sidebar, TopActions, initialsOf } = await import('./shell');

function user(permissions: string[]) {
  return { state: 'ready', data: { id: 'u-1', roles: [], permissions, tokenVersion: 0, isActive: true } };
}

/** Walks the rendered tree for every `href` an anchor carries. */
function hrefs(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const element = node as { props?: { href?: string; children?: unknown } };
  const here = typeof element.props?.href === 'string' ? [element.props.href] : [];
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  return [...here, ...list.flatMap(hrefs)];
}

/** Walks the rendered tree for the `href` of every nav item whose section matches the active one (what NavItem marks aria-current). */
function currentHrefs(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const element = node as { props?: { href?: string; section?: string; active?: string; children?: unknown } };
  const props = element.props;
  const here = props && typeof props.href === 'string' && props.section !== undefined && props.section === props.active ? [props.href] : [];
  const children = props?.children;
  const list = Array.isArray(children) ? children : [children];
  return [...here, ...list.flatMap(currentHrefs)];
}

beforeEach(() => {
  getCurrentUser.mockReset();
  listWorkOrders.mockReset();
  cookieStore.get.mockReset();
});

describe('Sidebar', () => {
  it('offers Users to a viewer who may see them', async () => {
    getCurrentUser.mockResolvedValue(user(['user.view', 'project.view']));
    expect(hrefs(await Sidebar({ active: 'projects' }))).toContain('/users');
  });

  // Hiding it is UX, not a boundary — /users still renders a forbidden state
  // for anyone who reaches it directly.
  it('hides Users from a viewer who may not', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    expect(hrefs(await Sidebar({ active: 'projects' }))).not.toContain('/users');
  });

  it('still renders the rest of the navigation when the identity call fails', async () => {
    getCurrentUser.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    const links = hrefs(await Sidebar({ active: 'projects' }));
    expect(links).toContain('/projects');
    expect(links).not.toContain('/users');
  });

  it('hides Users from a deactivated account even if the claim still lists the permission', async () => {
    getCurrentUser.mockResolvedValue({
      state: 'ready',
      data: { id: 'u-1', roles: [], permissions: ['user.view'], tokenVersion: 0, isActive: false },
    });
    expect(hrefs(await Sidebar({ active: 'projects' }))).not.toContain('/users');
  });

  it('lists the checklist library and work orders under Records', async () => {
    getCurrentUser.mockResolvedValue(user(['qc_template.view', 'task.view']));
    const links = hrefs(await Sidebar({ active: 'work-orders' }));
    expect(links).toEqual(expect.arrayContaining(['/quality/templates', '/quality/work-orders']));
    expect(links).not.toContain('/work-orders');
  });

  it('offers the checklist library only to a viewer who may see templates', async () => {
    getCurrentUser.mockResolvedValue(user(['task.view']));
    expect(hrefs(await Sidebar({ active: 'projects' }))).not.toContain('/quality/templates');
    getCurrentUser.mockResolvedValue(user(['qc_template.view']));
    const links = hrefs(await Sidebar({ active: 'projects' }));
    expect(links).toContain('/quality/templates');
    expect(links).not.toContain('/quality/work-orders');
  });

  it('shows the audit log only to a viewer who may read the ledger', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    expect(hrefs(await Sidebar({ active: 'overview' }))).not.toContain('/#audit-log');
    getCurrentUser.mockResolvedValue(user(['audit.view']));
    expect(hrefs(await Sidebar({ active: 'overview' }))).toContain('/#audit-log');
  });

  it('hides the whole group from a viewer who may see neither', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    const links = hrefs(await Sidebar({ active: 'projects' }));
    expect(links.some((href) => href.startsWith('/quality'))).toBe(false);
  });

  it('offers Documentation to a manager', async () => {
    getCurrentUser.mockResolvedValue({ state: 'ready', data: { id: 'u-1', roles: ['QC_MANAGER'], permissions: [], tokenVersion: 0, isActive: true } });
    expect(hrefs(await Sidebar({ active: 'projects' }))).toContain('/docs');
  });

  it('hides Documentation from staff below manager, and no longer links Settings', async () => {
    getCurrentUser.mockResolvedValue({ state: 'ready', data: { id: 'u-1', roles: ['FIELD_ENGINEER'], permissions: [], tokenVersion: 0, isActive: true } });
    const links = hrefs(await Sidebar({ active: 'projects' }));
    expect(links).not.toContain('/docs');
    expect(links.some((href) => href.includes('settings'))).toBe(false);
  });
});

describe('Sidebar for a project manager', () => {
  const manager = { state: 'ready', data: { id: 'u-1', roles: ['PROJECT_MANAGER'], permissions: ['task.view', 'qc_template.view', 'finance_request.view'], tokenVersion: 0, isActive: true } };

  it('groups Quality & EHS and Finance, and counts what is waiting for review', async () => {
    getCurrentUser.mockResolvedValue(manager);
    listWorkOrders.mockResolvedValue({ state: 'ready', data: { counts: { REVIEWING: 3 } } });
    const text = JSON.stringify(await Sidebar({ active: 'overview' }));
    expect(text).toContain('Quality');
    expect(text).toContain('Finance');
    expect(text).toContain('"badge":3');
  });

  it('shows no badge when nothing is waiting, or the count is unavailable', async () => {
    getCurrentUser.mockResolvedValue(manager);
    listWorkOrders.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    expect(JSON.stringify(await Sidebar({ active: 'overview' }))).toContain('"badge":0');
  });

  it('leaves administrators on the Records grouping', async () => {
    getCurrentUser.mockResolvedValue({ state: 'ready', data: { id: 'u-1', roles: ['SUPER_ADMIN'], permissions: ['task.view'], tokenVersion: 0, isActive: true } });
    const text = JSON.stringify(await Sidebar({ active: 'overview' }));
    expect(text).toContain('Records');
    expect(listWorkOrders).not.toHaveBeenCalled();
  });
});

describe('Sidebar for QC and field engineers', () => {
  const as = (role: string) => ({ state: 'ready', data: { id: 'u-1', roles: [role], permissions: ['task.view', 'qc_template.view', 'audit.view'], tokenVersion: 0, isActive: true } });

  it.each(['QC_MANAGER', 'FIELD_ENGINEER'])('%s sees the finance requests but no audit log', async (role) => {
    getCurrentUser.mockResolvedValue({ state: 'ready', data: { ...as(role).data, permissions: [...as(role).data.permissions, 'finance_request.view'] } });
    listWorkOrders.mockResolvedValue({ state: 'ready', data: { counts: { REVIEWING: 2 } } });
    const links = hrefs(await Sidebar({ active: 'overview' }));
    expect(links).toContain('/finance');
    expect(links).not.toContain('/finance/categories');
    expect(links).not.toContain('/finance/reports');
    expect(links).not.toContain('/#audit-log');
  });

  it('counts reviews for QC but does not look them up for an engineer', async () => {
    getCurrentUser.mockResolvedValue(as('FIELD_ENGINEER'));
    await Sidebar({ active: 'overview' });
    expect(listWorkOrders).not.toHaveBeenCalled();
  });
});

describe('Sidebar Finance group', () => {
  const as = (roles: string[], permissions: string[]) => ({ state: 'ready', data: { id: 'u-1', roles, permissions, tokenVersion: 0, isActive: true } });

  it('is hidden without finance_request.view', async () => {
    getCurrentUser.mockResolvedValue(as(['SUPER_ADMIN'], ['task.view']));
    expect(hrefs(await Sidebar({ active: 'overview' })).some((href) => href.startsWith('/finance'))).toBe(false);
  });

  it('shows Categories and Spend report only to those who may use them', async () => {
    getCurrentUser.mockResolvedValue(as(['SUPER_ADMIN'], ['finance_request.view']));
    let links = hrefs(await Sidebar({ active: 'overview' }));
    expect(links).toContain('/finance');
    expect(links).not.toContain('/finance/categories');
    expect(links).not.toContain('/finance/reports');
    getCurrentUser.mockResolvedValue(as(['SUPER_ADMIN'], ['finance_request.view', 'finance_category.manage', 'finance_request.view_all']));
    links = hrefs(await Sidebar({ active: 'overview' }));
    expect(links).toEqual(expect.arrayContaining(['/finance', '/finance/categories', '/finance/reports']));
  });

  it('leaves Finance with the Finance group only', async () => {
    getCurrentUser.mockResolvedValue(as(['FINANCE'], ['finance_request.view', 'finance_request.view_all', 'finance_category.manage', 'project.view', 'task.view']));
    const links = hrefs(await Sidebar({ active: 'finance' }));
    expect(links).toEqual(expect.arrayContaining(['/finance', '/finance/categories', '/finance/reports']));
    expect(links).not.toContain('/projects');
    expect(JSON.stringify(await Sidebar({ active: 'finance' }))).not.toContain('Overview');
    expect(links.some((href) => href.startsWith('/quality'))).toBe(false);
    expect(links).not.toContain('/#audit-log');
  });

  it('gives Project Directors their overview, the projects, work orders to read and the finance group, with no badge', async () => {
    getCurrentUser.mockResolvedValue(as(['PROJECT_DIRECTOR'], ['project.view', 'site.view', 'milestone.view', 'task.view', 'task.view_all', 'finance_request.view', 'finance_request.view_all', 'finance_approval.director']));
    const links = hrefs(await Sidebar({ active: 'overview' }));
    expect(links).toEqual(expect.arrayContaining(['/projects', '/quality/work-orders', '/finance', '/finance/reports']));
    expect(JSON.stringify(await Sidebar({ active: 'overview' }))).toContain('Overview');
    expect(links).not.toContain('/quality/templates');
    expect(links).not.toContain('/finance/categories');
    expect(links).not.toContain('/#audit-log');
    expect(listWorkOrders).not.toHaveBeenCalled();
  });

  it('keeps the review badge for a Director who is also a QC Manager', async () => {
    getCurrentUser.mockResolvedValue(as(['QC_MANAGER', 'PROJECT_DIRECTOR'], ['project.view', 'task.view', 'qc_template.view', 'finance_request.view', 'finance_request.view_all', 'finance_approval.director']));
    listWorkOrders.mockResolvedValue({ state: 'ready', data: { counts: { REVIEWING: 2 } } });
    const tree = await Sidebar({ active: 'overview' });
    expect(hrefs(tree)).toEqual(expect.arrayContaining(['/quality/work-orders', '/quality/templates', '/finance']));
    expect(JSON.stringify(tree)).toContain('"badge":2');
  });
});

describe('Sidebar Finance active item', () => {
  const all = { state: 'ready', data: { id: 'u-1', roles: ['SUPER_ADMIN'], permissions: ['finance_request.view', 'finance_category.manage', 'finance_request.view_all'], tokenVersion: 0, isActive: true } };

  it.each([
    ['finance', '/finance'],
    ['finance-categories', '/finance/categories'],
    ['finance-reports', '/finance/reports'],
  ] as const)('marks only the %s item as current', async (active, href) => {
    getCurrentUser.mockResolvedValue(all);
    expect(currentHrefs(await Sidebar({ active }))).toEqual([href]);
  });

  it('falls back to the default menu when a finance-home user cannot view finance', async () => {
    getCurrentUser.mockResolvedValue({ state: 'ready', data: { id: 'u-1', roles: ['FINANCE'], permissions: ['project.view'], tokenVersion: 0, isActive: true } });
    expect(hrefs(await Sidebar({ active: 'overview' }))).toContain('/projects');
  });
});

describe('Sidebar collapse', () => {
  it('renders expanded by default', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    const tree = await Sidebar({ active: 'projects' });
    expect(tree.props.className).toBe('sidebar');
  });

  // Read on the server, so a collapsed rail does not flash open on each page load.
  it('renders collapsed when the cookie says so', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    cookieStore.get.mockImplementation((name: string) => (name === 'ipms-sidebar' ? { value: 'collapsed' } : undefined));
    const tree = await Sidebar({ active: 'projects' });
    expect(tree.props.className).toBe('sidebar collapsed');
    expect(hrefs(tree)).toContain('/projects');
  });
});

describe('Sidebar user actions', () => {
  it('offers Profile and a POST sign-out in the sidebar footer', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    getMyProfile.mockResolvedValue({ state: 'ready', data: { fullName: 'Jane Doe', roles: [{ code: 'SUPER_ADMIN', name: 'Administrator' }] } });
    const tree = await Sidebar({ active: 'overview' });
    expect(hrefs(tree)).toContain('/profile');
    expect(JSON.stringify(tree)).toContain('/api/auth/logout');
  });

  it('names the signed-in person and their role', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    getMyProfile.mockResolvedValue({ state: 'ready', data: { fullName: 'Jane Doe', roles: [{ code: 'SUPER_ADMIN', name: 'Administrator' }] } });
    const text = JSON.stringify(await Sidebar({ active: 'overview' }));
    expect(text).toContain('Jane Doe');
    expect(text).toContain('Administrator');
  });

  it('still renders when the profile call fails', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    getMyProfile.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    expect(hrefs(await Sidebar({ active: 'overview' }))).toContain('/profile');
  });
});

describe('TopActions', () => {
  it('renders children and NotificationCenter', () => {
    const tree = TopActions({ children: <button type="button">Custom Action</button> });
    expect(tree.props.className).toBe('top-actions');
    expect(JSON.stringify(tree)).toContain('Custom Action');
    const types = (tree.props.children as { type?: { name?: string } }[]).map((child) => child.type?.name);
    expect(types).toContain('NotificationCenter');
  });

  it('offers the section search on every page', () => {
    const tree = TopActions({});
    const [search] = tree.props.children as { props: { children: { type: { name: string } } } }[];
    expect(search?.props.children.type.name).toBe('TopSearch');
  });
});

describe('initialsOf', () => {
  it.each([['Jane Doe', 'JD'], ['Mary Ann Smith', 'MS'], ['Admin', 'AD'], ['  ', '?']])('%s → %s', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});
