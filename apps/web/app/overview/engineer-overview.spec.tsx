import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const listWorkOrders = vi.fn();
const getMyProfile = vi.fn();
vi.mock('../lib/work-order-api', () => ({ listWorkOrders }));
vi.mock('../lib/user-api', () => ({ getMyProfile }));
vi.mock('../shell', () => ({
  Sidebar: () => null, TopActions: () => null, StatePage: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const { EngineerOverview } = await import('./engineer-overview');

beforeEach(() => {
  listWorkOrders.mockReset().mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
  getMyProfile.mockReset().mockResolvedValue({ state: 'ready', data: { fullName: 'Sita Rai' } });
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
  });
});
