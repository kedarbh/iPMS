import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPortfolio = vi.fn();
const getWorkOrderSummary = vi.fn();
const getFinanceOverview = vi.fn();
vi.mock('../../../lib/project-api', () => ({ getPortfolio }));
vi.mock('../../../lib/work-order-api', () => ({ getWorkOrderSummary }));
vi.mock('../../../lib/finance-api', () => ({ getFinanceOverview }));

const { GET } = await import('./route');
const down = { state: 'unavailable', status: 503, message: 'down' };

beforeEach(() => {
  getPortfolio.mockReset().mockResolvedValue({ state: 'ready', data: [] });
  getWorkOrderSummary.mockReset().mockResolvedValue(down);
  getFinanceOverview.mockReset().mockResolvedValue(down);
});

describe('GET /api/reports/portfolio', () => {
  it('returns the report as a CSV download', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="portfolio-report-\d{4}-\d{2}-\d{2}\.csv"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A UTF-8 byte-order mark, so Excel reads the file as UTF-8.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toMatch(/^Project code,Project,/);
  });

  it('refuses without access to projects', async () => {
    getPortfolio.mockResolvedValue({ state: 'forbidden', status: 403, message: 'no' });
    expect((await GET()).status).toBe(403);
    getPortfolio.mockResolvedValue({ state: 'unauthenticated' });
    expect((await GET()).status).toBe(401);
  });
});
