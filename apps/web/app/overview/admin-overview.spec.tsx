import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const getProjectDashboard = vi.fn();
const listWorkOrders = vi.fn();
const getCurrentUser = vi.fn();
const listAuditEvents = vi.fn();
const listUsers = vi.fn();
const getFinanceOverview = vi.fn();
vi.mock('../lib/project-api', () => ({ getProjectDashboard }));
vi.mock('../lib/work-order-api', () => ({ listWorkOrders }));
vi.mock('../lib/iam-api', () => ({ getCurrentUser, hasPermission: () => true }));
vi.mock('../lib/audit-api', () => ({ listAuditEvents }));
vi.mock('../lib/user-api', () => ({ listUsers }));
vi.mock('../lib/finance-api', () => ({ getFinanceOverview }));
vi.mock('../shell', () => ({ Sidebar: () => null, TopActions: () => null, initialsOf: () => 'X', StatePage: ({ title }: { title: string }) => <h1>{title}</h1> }));

const { AdminOverview } = await import('./admin-overview');

const ready = (data: unknown) => ({ state: 'ready', data });
const COUNTS = { ALL: 0, NOT_STARTED: 0, ONGOING: 0, REVIEWING: 0, RECTIFYING: 0, COMPLETED: 0, CANCELLED: 0, OVERDUE: 0 };
const FINANCE = {
  months: ['2026-10', '2026-11'],
  pipeline: { steps: [], paidThisMonth: { count: 0, amount: '0.00' } },
  waiting: { total: 0, amount: '0.00', oldestSince: null, byKind: {} },
  queue: [],
  projects: [{ projectId: 'p', code: 'KOS', name: 'Koshi', spentToDate: '0.00', spentByMonth: ['0.00', '0.00'], cashHeld: '9000.00', overdueSettlements: { count: 0, amount: '0.00' } }],
  categories: [],
  cashHolders: [{ requesterId: 'u-eng', outstanding: '9000.00', open: 1, overdue: 0 }],
  decisions: { approved: { count: 0, amount: '0.00' }, trimmed: { count: 0, saved: '0.00' }, returned: 0, rejected: 0, medianHoursToDecide: null },
};

beforeEach(() => {
  getProjectDashboard.mockReset().mockResolvedValue(ready({ projects: [], activeProjectCount: 0, sitesInDelivery: 0 }));
  listWorkOrders.mockReset().mockResolvedValue(ready({ items: [], counts: COUNTS }));
  getCurrentUser.mockReset().mockResolvedValue(ready({ id: 'u-admin', roles: ['SUPER_ADMIN'], permissions: [] }));
  listAuditEvents.mockReset().mockResolvedValue(ready({ items: [] }));
  listUsers.mockReset().mockResolvedValue(ready({ items: [{ id: 'u-eng', fullName: 'Sita Rai', roles: [] }] }));
  getFinanceOverview.mockReset().mockResolvedValue(ready(FINANCE));
});

const render = async () => renderToStaticMarkup(await AdminOverview({ searchParams: Promise.resolve({}) }));

describe('AdminOverview', () => {
  it('shows organisation money, with who holds cash, to someone who reads all finance', async () => {
    const out = await render();
    expect(out).toContain('Cash with engineers');
    expect(out).toContain('Sita Rai');
  });

  it('shows no money panel without finance access', async () => {
    getFinanceOverview.mockResolvedValue({ state: 'forbidden', message: 'no' });
    expect(await render()).not.toContain('Cash with engineers');
  });
});
