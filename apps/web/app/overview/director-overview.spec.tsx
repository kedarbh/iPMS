import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const getPortfolio = vi.fn();
const getWorkOrderSummary = vi.fn();
const getFinanceOverview = vi.fn();
const getCurrentUser = vi.fn();
const getMyProfile = vi.fn();
const listUserDirectory = vi.fn();
vi.mock('../lib/project-api', () => ({ getPortfolio }));
vi.mock('../lib/work-order-api', () => ({ getWorkOrderSummary }));
vi.mock('../lib/finance-api', () => ({ getFinanceOverview }));
vi.mock('../lib/iam-api', () => ({ getCurrentUser }));
vi.mock('../lib/user-api', () => ({ getMyProfile, listUserDirectory }));
vi.mock('../shell', () => ({ Sidebar: () => null, TopActions: () => null, StatePage: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('../finance/decided', () => ({ DecidedNotice: () => null }));

const { DirectorOverview } = await import('./director-overview');

const ready = (data: unknown) => ({ state: 'ready', data });
const down = { state: 'unavailable', status: 503, message: 'down' };
const PROJECT = {
  id: 'p-1', code: 'KOS', name: 'Koshi Rollout', status: 'ACTIVE', startDate: '2026-01-01T00:00:00.000Z', targetDate: '2027-12-31T00:00:00.000Z',
  sites: { total: 4, byStatus: {} }, tasks: { live: 10, completed: 5, overdue: 0, byStatus: {} }, sitesComplete: null, nextMilestone: null, completedByWeek: [0, 0, 0, 0, 1, 1, 1, 1],
};
const OVERVIEW = {
  months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
  pipeline: {
    steps: [
      { status: 'PENDING_PM', count: 2, amount: '3000.00', oldestSince: '2026-10-08T00:00:00Z', mine: false },
      { status: 'PENDING_DIRECTOR', count: 1, amount: '240000.00', oldestSince: '2026-10-05T00:00:00Z', mine: true },
      { status: 'PENDING_FINANCE', count: 0, amount: '0.00', oldestSince: null, mine: false },
    ],
    paidThisMonth: { count: 0, amount: '0.00' },
  },
  queue: [{
    id: 'r-1', number: 'ADV-2026-0012', kind: 'ADVANCE', status: 'PENDING_DIRECTOR', projectId: 'p-1', projectCode: 'KOS', projectName: 'Koshi Rollout',
    requesterId: 'u-eng', purpose: 'Site travel', category: 'Travel', amount: '240000.00', waitingSince: '2026-10-05T00:00:00Z',
    flags: [{ code: 'WAITING_LONG', tone: 'amber', days: 5 }],
  }],
  projects: [], categories: [], cashHolders: [],
  decisions: { approved: { count: 0, amount: '0.00' }, trimmed: { count: 0, saved: '0.00' }, returned: 0, rejected: 0, medianHoursToDecide: null },
};

beforeEach(() => {
  getPortfolio.mockReset().mockResolvedValue(ready([PROJECT]));
  getWorkOrderSummary.mockReset().mockResolvedValue(ready([]));
  getFinanceOverview.mockReset().mockResolvedValue(ready(OVERVIEW));
  getCurrentUser.mockReset().mockResolvedValue(ready({ id: 'u-dir', roles: ['PROJECT_DIRECTOR'], permissions: [], tokenVersion: 0, isActive: true }));
  getMyProfile.mockReset().mockResolvedValue(ready({ fullName: 'Hari Sharma' }));
  listUserDirectory.mockReset().mockResolvedValue(ready([{ id: 'u-eng', fullName: 'Sita Rai' }]));
});

const render = async () => renderToStaticMarkup(await DirectorOverview({}));

describe('DirectorOverview', () => {
  it('leads with what waits on the Director and lists it with its flags', async () => {
    const out = await render();
    expect(out).toContain('1 request worth NPR 2.4 lakh waits on you');
    expect(out).toContain('With you');
    expect(out).toContain('ADV-2026-0012');
    expect(out).toContain('Waiting 5 days');
    expect(out).toContain('Sita Rai');
    expect(out).toContain('Koshi Rollout');
  });

  it('still shows the queue when projects are down', async () => {
    getPortfolio.mockResolvedValue(down);
    const out = await render();
    expect(out).toContain('Projects are unavailable');
    expect(out).toContain('ADV-2026-0012');
  });

  it('shows quality as unknown when qc is down', async () => {
    getWorkOrderSummary.mockResolvedValue(down);
    const out = await render();
    expect(out).toContain('Work orders unavailable');
    expect(out).toContain('Koshi Rollout');
  });

  it('says plainly when finance is down, and still shows the portfolio', async () => {
    getFinanceOverview.mockResolvedValue(down);
    const out = await render();
    expect(out).toContain('Finance did not answer');
    expect(out).toContain('Koshi Rollout');
  });

  it('notes that decisions cannot be shown when finance is down', async () => {
    getFinanceOverview.mockResolvedValue(down);
    expect(await render()).toContain('Finance did not answer, so your decisions cannot be shown.');
  });

  it('hides the finance panels, without an error, when the viewer may not read finance', async () => {
    getFinanceOverview.mockResolvedValue({ state: 'forbidden', message: 'no' });
    const out = await render();
    expect(out).not.toContain('id="waiting"');
    expect(out).not.toContain('id="money"');
    expect(out).not.toContain('id="decisions"');
    expect(out).not.toContain('did not answer');
    expect(out).toContain('Koshi Rollout');
  });

  it('hides the portfolio, without an error, when the viewer may not read projects', async () => {
    getPortfolio.mockResolvedValue({ state: 'forbidden', message: 'no' });
    const out = await render();
    expect(out).not.toContain('id="portfolio"');
    expect(out).not.toContain('Projects are unavailable');
    expect(out).toContain('ADV-2026-0012');
  });

  it('shows no work-order note when the viewer may not read work orders', async () => {
    getWorkOrderSummary.mockResolvedValue({ state: 'forbidden', message: 'no' });
    const out = await render();
    expect(out).not.toContain('Work orders unavailable');
    expect(out).toContain('Koshi Rollout');
  });

  it('asks a signed-out viewer to sign in', async () => {
    getCurrentUser.mockResolvedValue({ state: 'unauthenticated' });
    expect(await render()).toContain('Sign in to see your projects');
  });
});
