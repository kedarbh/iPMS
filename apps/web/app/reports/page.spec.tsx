import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const getPortfolio = vi.fn();
const getWorkOrderSummary = vi.fn();
const getFinanceOverview = vi.fn();
const getCurrentUser = vi.fn();
const listUserDirectory = vi.fn();
vi.mock('../lib/project-api', () => ({ getPortfolio }));
vi.mock('../lib/work-order-api', () => ({ getWorkOrderSummary }));
vi.mock('../lib/finance-api', () => ({ getFinanceOverview }));
vi.mock('../lib/iam-api', () => ({ getCurrentUser }));
vi.mock('../lib/user-api', () => ({ listUserDirectory }));
vi.mock('../shell', () => ({ Sidebar: () => null, TopActions: () => null, StatePage: ({ title }: { title: string }) => <h1>{title}</h1> }));

const { default: PortfolioReportPage } = await import('./page');

const ready = (data: unknown) => ({ state: 'ready', data });
const down = { state: 'unavailable', status: 503, message: 'down' };
const PROJECT = {
  id: 'p-1', code: 'KOS', name: 'Koshi Rollout', status: 'ACTIVE', startDate: '2026-01-01', targetDate: '2027-12-31',
  sites: { total: 4, byStatus: {} }, tasks: { live: 10, completed: 5, overdue: 2, byStatus: {} }, sitesComplete: null,
  nextMilestone: { name: 'Civil works', targetDate: '2026-12-15', percent: 50 }, completedByWeek: [0, 0, 1, 0, 1, 2, 1, 3],
};
const SUMMARY = {
  projectId: 'p-1', byStatus: { NOT_STARTED: 1, ONGOING: 2, REVIEWING: 3, RECTIFYING: 1, COMPLETED: 8 }, overdue: 1,
  approved90: 10, firstTime90: 6, reviewing: { count: 3, oldestSubmittedAt: '2026-11-01T00:00:00Z' }, completedByWeek: [0, 0, 0, 0, 0, 0, 0, 0],
};
const OVERVIEW = {
  months: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
  pipeline: { steps: [], paidThisMonth: { count: 0, amount: '0.00' } },
  waiting: { total: 0, amount: '0.00', oldestSince: null, byKind: {} }, queue: [],
  projects: [{ projectId: 'p-1', code: 'KOS', name: 'Koshi Rollout', spentToDate: '450000.00', spentByMonth: ['0', '0', '0', '100000', '150000', '200000'], cashHeld: '30000.00', overdueSettlements: { count: 1, amount: '10000.00' } }],
  categories: [{ categoryId: 'c-1', name: 'Travel', amount: '200000.00' }], cashHolders: [],
  decisions: { approved: { count: 0, amount: '0.00' }, trimmed: { count: 0, saved: '0.00' }, returned: 0, rejected: 0, medianHoursToDecide: null },
};

beforeEach(() => {
  getPortfolio.mockReset().mockResolvedValue(ready([PROJECT]));
  getWorkOrderSummary.mockReset().mockResolvedValue(ready([SUMMARY]));
  getFinanceOverview.mockReset().mockResolvedValue(ready(OVERVIEW));
  getCurrentUser.mockReset().mockResolvedValue(ready({ id: 'u-dir', roles: ['PROJECT_DIRECTOR'], permissions: [], tokenVersion: 0, isActive: true }));
  listUserDirectory.mockReset().mockResolvedValue(ready([]));
});

const render = async () => renderToStaticMarkup(await PortfolioReportPage());

describe('PortfolioReportPage', () => {
  it('draws delivery, quality and money, then the full table', async () => {
    const out = await render();
    expect(out).toContain('Portfolio report');
    expect(out).toContain('Delivery pace');
    expect(out).toContain('aria-label="Completed per week"');
    expect(out).toContain('First-time approval by project');
    expect(out).toContain('60%');
    expect(out).toContain('aria-label="Spend by month and project, NPR"');
    expect(out).toContain('Spent to date by project');
    expect(out).toContain('Project detail');
    expect(out).toContain('Civil works');
    expect(out).toContain('href="/api/reports/portfolio"');
  });

  it('keeps delivery when quality and finance do not answer', async () => {
    getWorkOrderSummary.mockResolvedValue(down);
    getFinanceOverview.mockResolvedValue(down);
    const out = await render();
    expect(out).toContain('Delivery pace');
    expect(out).toContain('Quality control did not answer');
    expect(out).toContain('Finance did not answer');
    expect(out).not.toContain('Spent to date by project');
  });

  it('hides sections the viewer may not read', async () => {
    getWorkOrderSummary.mockResolvedValue({ state: 'forbidden', status: 403, message: 'no' });
    getFinanceOverview.mockResolvedValue({ state: 'forbidden', status: 403, message: 'no' });
    const out = await render();
    expect(out).toContain('Delivery pace');
    expect(out).not.toContain('id="quality"');
    expect(out).not.toContain('id="money"');
    expect(out).not.toContain('Spent to date');
  });

  it('says so when projects are down', async () => {
    getPortfolio.mockResolvedValue(down);
    expect(await render()).toContain('The portfolio report is not available');
  });
});
