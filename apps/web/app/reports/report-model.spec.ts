import { describe, expect, it } from 'vitest';
import type { FinanceOverview, PortfolioProject, WorkOrderProjectSummary } from '@ipms/contracts';
import { OTHER_COLOR, SERIES_COLORS, monthShort, portfolioReport, reportCsv, spendSeries } from './report-model';

const NOW = new Date('2026-11-27T06:00:00Z');
const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];

const project = (id: string, code: string, extra: Partial<PortfolioProject> = {}): PortfolioProject => ({
  id, code, name: `${code} project`, status: 'ACTIVE', startDate: '2026-01-01', targetDate: '2027-01-01',
  sites: { total: 4, byStatus: {} }, tasks: { live: 10, completed: 6, overdue: 1, byStatus: {} },
  sitesComplete: null, nextMilestone: { name: 'Civil works', targetDate: '2026-12-15', percent: 50 },
  completedByWeek: [0, 1, 0, 2, 1, 1, 3, 2], ...extra,
});
const summary = (projectId: string, extra: Partial<WorkOrderProjectSummary> = {}): WorkOrderProjectSummary => ({
  projectId, byStatus: { NOT_STARTED: 1, ONGOING: 2, REVIEWING: 3, RECTIFYING: 1, COMPLETED: 8, CANCELLED: 4 }, overdue: 2,
  approved90: 10, firstTime90: 8, reviewing: { count: 3, oldestSubmittedAt: '2026-11-20T03:00:00Z' }, completedByWeek: [0, 0, 0, 0, 0, 0, 0, 0], ...extra,
});
const money = (projectId: string, code: string, byMonth: number[]) => ({
  projectId, code, name: `${code} project`, spentToDate: String(byMonth.reduce((t, v) => t + v, 0) + 1000),
  spentByMonth: byMonth.map((v) => v.toFixed(2)), cashHeld: '5000.00', overdueSettlements: { count: 1, amount: '2000.00' },
});
const finance = (projects: ReturnType<typeof money>[]): FinanceOverview => ({
  months: MONTHS, projects,
  pipeline: { steps: [], paidThisMonth: { count: 0, amount: '0.00' } },
  waiting: { total: 0, amount: '0.00', oldestSince: null, byKind: {} as FinanceOverview['waiting']['byKind'] },
  queue: [], categories: [], cashHolders: [],
  decisions: { approved: { count: 0, amount: '0.00' }, trimmed: { count: 0, saved: '0.00' }, returned: 0, rejected: 0, medianHoursToDecide: null },
});

describe('portfolioReport', () => {
  it('joins delivery, quality and money per project and adds them up', () => {
    const report = portfolioReport(
      [project('a', 'AAA'), project('b', 'BBB')],
      [summary('a'), summary('b', { approved90: 0, firstTime90: 0, reviewing: { count: 0, oldestSubmittedAt: null } })],
      finance([money('a', 'AAA', [0, 0, 0, 0, 100, 200])]),
      NOW,
    );
    const a = report.rows.find((r) => r.id === 'a')!;
    // Cancelled work orders are left out of the total.
    expect(a.workOrders).toMatchObject({ total: 15, overdue: 2, firstTime: 80, awaitingReview: 3, oldestReviewDays: 7 });
    expect(a.money).toMatchObject({ spentToDate: 1300, spentThisMonth: 200, cashHeld: 5000, overdue: { count: 1, amount: 2000 } });
    const b = report.rows.find((r) => r.id === 'b')!;
    expect(b.workOrders?.firstTime).toBeNull();
    expect(b.workOrders?.oldestReviewDays).toBeNull();
    // Finance answered but holds nothing for this project: zeros, not unknown.
    expect(b.money?.spentToDate).toBe(0);
    expect(report.totals).toMatchObject({ projects: 2, sites: 8, tasksOverdue: 2, workOrdersApproved: 16, workOrdersTotal: 30, firstTime: 80, spentToDate: 1300, cashHeld: 5000 });
    expect(report.totals.weekly).toEqual([0, 2, 0, 4, 2, 2, 6, 4]);
    expect(report.months).toEqual(MONTHS);
  });

  it('leaves a silent service unknown rather than zero', () => {
    const report = portfolioReport([project('a', 'AAA')], null, null, NOW);
    expect(report.rows[0]!.workOrders).toBeNull();
    expect(report.rows[0]!.money).toBeNull();
    expect(report.totals).toMatchObject({ firstTime: null, workOrdersTotal: null, spentToDate: null, cashHeld: null, overdueSettlements: null });
  });
});

describe('spendSeries', () => {
  const rowsFor = (n: number) => portfolioReport(
    Array.from({ length: n }, (_, i) => project(`p${i}`, `P${i}`)),
    null,
    finance(Array.from({ length: n }, (_, i) => money(`p${i}`, `P${i}`, [0, 0, 0, 0, 0, (i + 1) * 100]))),
    NOW,
  ).rows;

  it('gives each of up to four spenders its own colour in code order', () => {
    const series = spendSeries(rowsFor(3), MONTHS);
    expect(series.map((s) => s.label)).toEqual(['P0', 'P1', 'P2']);
    expect(series.map((s) => s.color)).toEqual(SERIES_COLORS.slice(0, 3));
  });

  it('folds all but the three largest into Other', () => {
    const series = spendSeries(rowsFor(6), MONTHS);
    expect(series.map((s) => s.label)).toEqual(['P3', 'P4', 'P5', 'Other (3)']);
    expect(series.at(-1)).toMatchObject({ color: OTHER_COLOR, total: 600 });
  });

  it('leaves out projects that spent nothing', () => {
    const rows = portfolioReport([project('a', 'AAA')], null, finance([money('a', 'AAA', [0, 0, 0, 0, 0, 0])]), NOW).rows;
    expect(spendSeries(rows, MONTHS)).toEqual([]);
  });
});

describe('reportCsv', () => {
  it('writes a header and one row per project, safe for spreadsheets', () => {
    const report = portfolioReport([project('a', '=AAA', { name: 'Koshi, "North"' })], [summary('a')], finance([money('a', '=AAA', [0, 0, 0, 0, 0, 50])]), NOW);
    const lines = reportCsv(report).split('\r\n');
    expect(lines[0]).toMatch(/^Project code,Project,Sites,Completion %/);
    expect(lines[1]).toMatch(/^'=AAA,"Koshi, ""North""",4,/);
    expect(lines[1]).toContain(',1050.00,50.00,5000.00,1,2000.00');
    expect(lines.at(-1)).toBe('');
  });

  it('leaves unknown columns blank', () => {
    const line = reportCsv(portfolioReport([project('a', 'AAA')], null, null, NOW)).split('\r\n')[1]!;
    expect(line.endsWith(',,,,,,,,,,,,')).toBe(true);
  });
});

it('monthShort names the month', () => expect(monthShort('2026-11')).toBe('Nov'));
