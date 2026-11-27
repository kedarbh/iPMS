import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const listWorkOrders = vi.fn();
const getMyProfile = vi.fn();
const listRequests = vi.fn();
const getRequest = vi.fn();
vi.mock('../lib/work-order-api', () => ({ listWorkOrders }));
vi.mock('../lib/finance-api', () => ({ listRequests, getRequest }));
vi.mock('../lib/user-api', () => ({ getMyProfile }));
vi.mock('../shell', () => ({
  Sidebar: () => null, TopActions: () => null, StatePage: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const { EngineerOverview } = await import('./engineer-overview');

beforeEach(() => {
  listWorkOrders.mockReset().mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
  getMyProfile.mockReset().mockResolvedValue({ state: 'ready', data: { fullName: 'Sita Rai' } });
  listRequests.mockReset().mockResolvedValue({ state: 'ready', data: { items: [], total: 0, page: 1, limit: 100 } });
  getRequest.mockReset();
});

const render = async (canViewFinance: boolean) => renderToStaticMarkup(await EngineerOverview({ canViewFinance }));

describe('EngineerOverview', () => {
  it('links to finance for an engineer who may use it', async () => {
    const out = await render(true);
    expect(out).toContain('Finance requests');
    expect(out).toContain('href="/finance"');
  });

  it('shows no finance link for an engineer whose company handles their money', async () => {
    const out = await render(false);
    expect(out).not.toContain('Finance requests');
    expect(out).not.toContain('href="/finance"');
    expect(out).toContain('Your work');
    expect(out).not.toContain('Your money');
    expect(listRequests).not.toHaveBeenCalled();
  });

  it('shows the cash an engineer holds and links each advance to its settlement', async () => {
    listRequests.mockResolvedValue({
      state: 'ready',
      data: {
        items: [{
          id: 'adv-1', number: 'FIN-0042', kind: 'ADVANCE', status: 'PAID', projectCode: 'KOS', purpose: 'Site cement',
          requestedAmount: '20000.00', approvedAmount: '15000.00',
        }],
        total: 1, page: 1, limit: 100,
      },
    });
    getRequest.mockResolvedValue({
      state: 'ready',
      data: { balance: { outstanding: '12000.00', status: 'PARTIALLY_SETTLED' }, settlementDueOn: '2020-01-08' },
    });
    const out = await render(true);
    expect(out).toContain('Your money');
    expect(out).toContain('NPR 12,000.00');
    expect(out).toContain('Overdue since 08 Jan 2020');
    expect(out).toContain('href="/finance/new?kind=SETTLEMENT&amp;advanceId=adv-1"');
  });

  it('says so when finance does not answer, without hiding the work orders', async () => {
    listRequests.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    const out = await render(true);
    expect(out).toContain('Finance did not answer');
    expect(out).toContain('Your work');
  });
});
