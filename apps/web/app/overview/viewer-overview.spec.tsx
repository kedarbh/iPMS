import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const getPortfolio = vi.fn();
const getWorkOrderSummary = vi.fn();
const listWorkOrders = vi.fn();
const getMyProfile = vi.fn();
vi.mock('../lib/project-api', () => ({ getPortfolio }));
vi.mock('../lib/work-order-api', () => ({ getWorkOrderSummary, listWorkOrders }));
vi.mock('../lib/user-api', () => ({ getMyProfile }));
vi.mock('../shell', () => ({ Sidebar: () => null, TopActions: () => null, StatePage: ({ title }: { title: string }) => <h1>{title}</h1> }));

const { ViewerOverview } = await import('./viewer-overview');

const ready = (data: unknown) => ({ state: 'ready', data });
const PROJECT = {
  id: 'p-1', code: 'KOS', name: 'Koshi Rollout', status: 'ACTIVE', startDate: '2026-01-01T00:00:00.000Z', targetDate: '2027-12-31T00:00:00.000Z',
  sites: { total: 4, byStatus: {} }, tasks: { live: 10, completed: 5, overdue: 0, byStatus: {} }, sitesComplete: null, nextMilestone: null, completedByWeek: [0, 0, 0, 0, 1, 1, 1, 1],
};
const COUNTS = { ALL: 10, NOT_STARTED: 2, ONGOING: 2, REVIEWING: 1, RECTIFYING: 1, COMPLETED: 4, CANCELLED: 0, OVERDUE: 3 };

beforeEach(() => {
  getPortfolio.mockReset().mockResolvedValue(ready([PROJECT]));
  getWorkOrderSummary.mockReset().mockResolvedValue(ready([]));
  listWorkOrders.mockReset().mockResolvedValue(ready({ items: [], counts: COUNTS }));
  getMyProfile.mockReset().mockResolvedValue(ready({ fullName: 'Hari Thapa' }));
});

describe('ViewerOverview', () => {
  it('shows the portfolio and work order status with nothing to act on', async () => {
    const out = renderToStaticMarkup(await ViewerOverview());
    expect(out).toContain('Hari');
    expect(out).toContain('Koshi Rollout');
    expect(out).toContain('40%'); // 4 of 10 approved
    expect(out).toContain('Work order status');
    expect(out).not.toContain('New work order');
    expect(out).not.toContain('/finance');
    expect(out).not.toContain('Audit log');
    expect(out).not.toContain('<th>Money</th>');
  });

  it('keeps the page up when QC does not answer', async () => {
    listWorkOrders.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    getWorkOrderSummary.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    const out = renderToStaticMarkup(await ViewerOverview());
    expect(out).toContain('Koshi Rollout');
    expect(out).toContain('Work orders are unavailable');
  });

  it('sends a signed-out visitor to sign in', async () => {
    getPortfolio.mockResolvedValue({ state: 'unauthenticated' });
    expect(renderToStaticMarkup(await ViewerOverview())).toContain('Sign in to see your projects');
  });
});
