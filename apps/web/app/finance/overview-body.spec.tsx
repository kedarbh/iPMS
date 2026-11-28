import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverdueList } from './overdue-banner';
import { OverviewBody } from './overview-body';

const NOW = new Date('2026-10-10T08:00:00Z');
const names = new Map([['u-1', 'Anil Gurung'], ['u-2', 'Bikash Tamang']]);
const overview = (over: Record<string, unknown> = {}) => ({
  months: [], pipeline: { steps: [], paidThisMonth: { count: 0, amount: '0.00' } },
  waiting: {
    total: 4, amount: '32700.00', oldestSince: '2026-10-07T08:00:00Z',
    byKind: { ADVANCE: { count: 2, amount: '18500.00' }, SETTLEMENT: { count: 1, amount: '11800.00' }, REIMBURSEMENT: { count: 1, amount: '2400.00' } },
  },
  queue: [{
    id: 'r-1', number: 'RMB-2026-0003', kind: 'REIMBURSEMENT', status: 'PENDING_PM', projectId: 'p', projectCode: 'NP004', projectName: 'Pokhara',
    requesterId: 'u-2', purpose: 'Taxi to Pokhara', category: 'Travel', amount: '2400.00', waitingSince: '2026-10-07T08:00:00Z', flags: [],
  }],
  projects: [{ projectId: 'p', code: 'NP004', name: 'Pokhara', spentToDate: '0.00', spentByMonth: [], cashHeld: '78500.00', overdueSettlements: { count: 2, amount: '45000.00' } }],
  categories: [],
  cashHolders: [
    { requesterId: 'u-2', outstanding: '45000.00', open: 2, overdue: 1 },
    { requesterId: 'u-1', outstanding: '23500.00', open: 1, overdue: 0 },
  ],
  overdueAdvances: [],
  decisions: { approved: { count: 0, amount: '0.00' }, trimmed: { count: 0, saved: '0.00' }, returned: 0, rejected: 0, medianHoursToDecide: null },
  ...over,
}) as never;
const html = (data = overview(), role: 'PM' | 'FINANCE' | 'DIRECTOR' = 'PM') =>
  renderToStaticMarkup(<OverviewBody overview={data} names={names} role={role} now={NOW} />);

describe('OverviewBody', () => {
  it('shows what waits, in total and by kind', () => {
    const out = html();
    expect(out).toContain('Waiting for your approval');
    expect(out).toContain('<span class="fin-unit">NPR</span>32,700.00');
    expect(out).toContain('4 requests · oldest 3 days');
    expect(out).toContain('Advances');
    expect(out).toContain('<span class="fin-unit">NPR</span>18,500.00');
    expect(out).toContain('2 waiting');
    expect(out).toContain('Reimbursements');
  });

  it('words the dark card for finance', () => {
    expect(html(overview(), 'FINANCE')).toContain('Waiting for payment');
  });

  it('raises the overdue banner with the people holding the cash', () => {
    const out = html();
    expect(out).toContain('2 settlements overdue');
    expect(out).toContain('NPR 45,000.00');
    expect(out).toContain('Bikash Tamang');
    // Without the overdue list (an older finance service) there is nothing to open, so no button.
    expect(out).not.toContain('See who');
  });

  it('offers "See who" over the overdue advances themselves', () => {
    const out = html(overview({
      overdueAdvances: [
        { id: 'a-1', number: 'ADV-2026-0007', requesterId: 'u-2', projectCode: 'NP004', projectName: 'Pokhara', outstanding: '30000.00', dueOn: '2026-10-01', daysOverdue: 9 },
        { id: 'a-2', number: 'ADV-2026-0009', requesterId: 'u-1', projectCode: 'NP004', projectName: 'Pokhara', outstanding: '15000.00', dueOn: '2026-10-05', daysOverdue: 5 },
      ],
    }));
    expect(out).toMatch(/<button[^>]*aria-expanded="false"[^>]*>See who<\/button>/);
    expect(out).toContain('with Bikash Tamang and Anil Gurung, past');
  });

  it('has no banner when nothing is overdue', () => {
    const quiet = overview({ projects: [{ projectId: 'p', code: 'NP004', name: 'Pokhara', spentToDate: '0.00', spentByMonth: [], cashHeld: '0.00', overdueSettlements: { count: 0, amount: '0.00' } }], cashHolders: [] });
    const out = html(quiet);
    expect(out).toContain('Waiting for your approval');
    expect(out).not.toContain('fin-banner');
    expect(out).not.toContain('settlements overdue');
  });

  it('says "and others" or "with others" when the listed holders do not cover every overdue settlement', () => {
    const partial = overview({ cashHolders: [{ requesterId: 'u-2', outstanding: '45000.00', open: 2, overdue: 1 }] });
    expect(html(partial)).toContain('with Bikash Tamang and others, past');
    const none = html(overview({ cashHolders: [] }));
    expect(none).toContain('fin-banner');
    expect(none).toContain('with others, past');
  });

  it('says the cash list is the top holders only when it is full', () => {
    const holder = (n: number) => ({ requesterId: `u-${n}`, outstanding: '1000.00', open: 1, overdue: 0 });
    expect(html(overview({ cashHolders: [1, 2, 3, 4, 5].map(holder) }))).toContain('Showing the 5 holding the most.');
    expect(html(overview())).not.toContain('holding the most');
  });

  it('uses singular wording', () => {
    const one = overview({
      waiting: { total: 1, amount: '2400.00', oldestSince: '2026-10-07T08:00:00Z', byKind: { ADVANCE: { count: 0, amount: '0.00' }, SETTLEMENT: { count: 0, amount: '0.00' }, REIMBURSEMENT: { count: 1, amount: '2400.00' } } },
      projects: [{ projectId: 'p', code: 'NP004', name: 'Pokhara', spentToDate: '0.00', spentByMonth: [], cashHeld: '0.00', overdueSettlements: { count: 1, amount: '20000.00' } }],
    });
    const out = html(one);
    expect(out).toContain('1 request ');
    expect(out).toContain('1 settlement overdue');
  });

  it('tones the wait pill by age', () => {
    expect(html()).toContain('finance-pill amber');
    const fresh = overview({ queue: [{ id: 'r-2', number: 'RMB-2026-0004', kind: 'REIMBURSEMENT', status: 'PENDING_PM', projectId: 'p', projectCode: 'NP004', projectName: 'Pokhara', requesterId: 'u-2', purpose: 'Lunch', category: 'Meals', amount: '300.00', waitingSince: '2026-10-10T02:00:00Z', flags: [] }] });
    const out = html(fresh);
    expect(out).toContain('finance-pill slate');
    expect(out).not.toContain('finance-pill amber');
  });

  it('lists the waiting requests with a way into the queue', () => {
    const out = html();
    expect(out).toContain('href="/finance/requests/r-1"');
    expect(out).toContain('Taxi to Pokhara');
    expect(out).toContain('3 days');
    expect(out).toContain('href="/finance/queue"');
  });

  it('lists who holds cash, overdue ones marked', () => {
    const out = html();
    expect(out).toContain('id="cash"');
    expect(out).toContain('NPR 78,500.00 open');
    expect(out).toContain('NPR 45,000.00');
    expect(out).toContain('1 overdue');
  });

  it('says so when nothing waits', () => {
    const empty = overview({ waiting: { total: 0, amount: '0.00', oldestSince: null, byKind: { ADVANCE: { count: 0, amount: '0.00' }, SETTLEMENT: { count: 0, amount: '0.00' }, REIMBURSEMENT: { count: 0, amount: '0.00' } } }, queue: [] });
    const out = html(empty);
    expect(out).toContain('Nothing waits on you.');
    expect(out).toContain('0 requests');
  });
});

describe('OverdueList', () => {
  it('links each overdue advance to its request with who, how much and how late', () => {
    const out = renderToStaticMarkup(<OverdueList id="x" more={2} rows={[{ id: 'a-1', number: 'ADV-2026-0007', who: 'Bikash Tamang', project: 'NP004', amount: 'NPR 30,000.00', late: '9 days late' }]} />);
    expect(out).toContain('href="/finance/requests/a-1"');
    expect(out).toContain('Bikash Tamang');
    expect(out).toContain('ADV-2026-0007 · NP004');
    expect(out).toContain('9 days late');
    expect(out).toContain('and 2 more');
  });
});
