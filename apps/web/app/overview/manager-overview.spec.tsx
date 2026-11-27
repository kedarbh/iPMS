import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const getProjectDashboard = vi.fn();
const listWorkOrders = vi.fn();
const getCurrentUser = vi.fn();
const listAuditEvents = vi.fn();
const getMyProfile = vi.fn();
const listUsers = vi.fn();
const listUserDirectory = vi.fn();
const getFinanceOverview = vi.fn();
vi.mock('../lib/project-api', () => ({ getProjectDashboard }));
vi.mock('../lib/work-order-api', () => ({ listWorkOrders }));
vi.mock('../lib/iam-api', () => ({ getCurrentUser, hasPermission: () => true }));
vi.mock('../lib/audit-api', () => ({ listAuditEvents }));
vi.mock('../lib/user-api', () => ({ getMyProfile, listUsers, listUserDirectory }));
vi.mock('../lib/finance-api', () => ({ getFinanceOverview }));
vi.mock('../shell', () => ({ Sidebar: () => null, TopActions: () => null, StatePage: ({ title }: { title: string }) => <h1>{title}</h1> }));

const { ManagerOverview } = await import('./manager-overview');

const ready = (data: unknown) => ({ state: 'ready', data });
const COUNTS = { ALL: 0, NOT_STARTED: 0, ONGOING: 0, REVIEWING: 0, RECTIFYING: 0, COMPLETED: 0, CANCELLED: 0, OVERDUE: 0 };
const FINANCE = {
  months: [],
  pipeline: {
    steps: [
      { status: 'PENDING_PM', count: 1, amount: '8000.00', oldestSince: '2026-11-20T00:00:00Z', mine: true },
      { status: 'PENDING_DIRECTOR', count: 0, amount: '0.00', oldestSince: null, mine: false },
      { status: 'PENDING_FINANCE', count: 0, amount: '0.00', oldestSince: null, mine: false },
    ],
    paidThisMonth: { count: 0, amount: '0.00' },
  },
  waiting: { total: 1, amount: '8000.00', oldestSince: '2026-11-20T00:00:00Z', byKind: {} },
  queue: [{
    id: 'r-9', number: 'ADV-2026-0099', kind: 'ADVANCE', status: 'PENDING_PM', projectId: 'p-1', projectCode: 'KOS', projectName: 'Koshi Rollout',
    requesterId: 'u-eng', purpose: 'Generator fuel', category: 'Fuel', amount: '8000.00', waitingSince: '2026-11-20T00:00:00Z', flags: [],
  }],
  projects: [], categories: [], cashHolders: [],
  decisions: { approved: { count: 0, amount: '0.00' }, trimmed: { count: 0, saved: '0.00' }, returned: 0, rejected: 0, medianHoursToDecide: null },
};

beforeEach(() => {
  getProjectDashboard.mockReset().mockResolvedValue(ready({ projects: [], activeProjectCount: 0, sitesInDelivery: 0 }));
  listWorkOrders.mockReset().mockResolvedValue(ready({ items: [], counts: COUNTS }));
  getCurrentUser.mockReset().mockResolvedValue(ready({ id: 'u-pm', roles: ['PROJECT_MANAGER'], permissions: [] }));
  listAuditEvents.mockReset().mockResolvedValue(ready({ items: [] }));
  getMyProfile.mockReset().mockResolvedValue(ready({ fullName: 'Maya Gurung' }));
  listUsers.mockReset().mockResolvedValue(ready({ items: [] }));
  listUserDirectory.mockReset().mockResolvedValue(ready([{ id: 'u-eng', fullName: 'Sita Rai' }]));
  getFinanceOverview.mockReset().mockResolvedValue(ready(FINANCE));
});

describe('ManagerOverview', () => {
  it('puts finance requests waiting on the manager beside their work orders', async () => {
    const out = renderToStaticMarkup(await ManagerOverview());
    expect(out).toContain('Finance approvals');
    expect(out).toContain('Finance waiting on you');
    expect(out).toContain('Generator fuel');
    expect(out).toContain('Sita Rai');
    expect(out).toContain('href="/finance/requests/r-9"');
    expect(out).toContain('Finance requests (1)');
  });

  it('shows no finance panel to a manager without finance access', async () => {
    getFinanceOverview.mockResolvedValue({ state: 'forbidden', message: 'no' });
    const out = renderToStaticMarkup(await ManagerOverview());
    expect(out).not.toContain('Finance approvals');
    expect(out).not.toContain('Finance waiting on you');
    expect(out).toContain('Needs your decision');
  });

  it('reports finance as down rather than hiding it', async () => {
    getFinanceOverview.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    const out = renderToStaticMarkup(await ManagerOverview());
    expect(out).toContain('Finance did not answer');
  });
});
