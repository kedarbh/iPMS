import type { FinanceOverview, PortfolioProject, ProjectMoney, WorkOrderProjectSummary } from '@ipms/contracts';
import { buildPortfolio, kathmanduToday, type ProjectHealth } from '../overview/director-model';
import { percent } from '../overview/model';

/**
 * The Project Director's portfolio report: one row per project joining
 * delivery (project service), quality (qc) and money (finance), plus the
 * series the charts draw. A pure module: it is given `now` and never reads
 * the clock. A service that did not answer leaves its columns null, so the
 * rest of the report still stands.
 */

/**
 * The categorical hues the charts give projects. The order is fixed and was
 * checked with the dataviz palette validator (light mode: CVD ΔE ≥ 11.8,
 * normal-vision ΔE ≥ 23.8). Three of the hues are under 3:1 contrast against
 * white, so every chart that uses them also shows the values as text and the
 * page carries a table view.
 */
export const SERIES_COLORS = ['#257de0', '#f47230', '#00b894', '#f2a600'] as const;
export const OTHER_COLOR = '#cbd5e1';
export const MAX_SERIES = SERIES_COLORS.length;

const WO_LIVE = ['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING', 'COMPLETED'] as const;
const DAY_MS = 86_400_000;
const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

export interface ReportRow {
  id: string; code: string; name: string;
  health: ProjectHealth;
  sites: number;
  tasks: { live: number; completed: number; overdue: number };
  /** Completed per rolling week, oldest first. */
  weekly: number[];
  nextMilestone: PortfolioProject['nextMilestone'];
  /** Null when qc did not answer. */
  workOrders: {
    byStatus: Record<(typeof WO_LIVE)[number], number>;
    total: number;
    overdue: number;
    /** Share of the last 90 days' approvals that passed first time; null under 1 approval. */
    firstTime: number | null;
    awaitingReview: number;
    /** Days the oldest submission has waited for review; null when none waits. */
    oldestReviewDays: number | null;
  } | null;
  /** Null when finance did not answer or holds nothing for this project. */
  money: { spentToDate: number; spentThisMonth: number; byMonth: number[]; cashHeld: number; overdue: { count: number; amount: number } } | null;
}

export interface ReportTotals {
  projects: number; sites: number;
  tasksLive: number; tasksCompleted: number; tasksOverdue: number;
  /** Mean completion across projects, 0–100. */
  completion: number;
  slipping: number; atRisk: number;
  workOrdersApproved: number | null; workOrdersTotal: number | null;
  firstTime: number | null;
  spentToDate: number | null; spentThisMonth: number | null; cashHeld: number | null;
  overdueSettlements: { count: number; amount: number } | null;
  weekly: number[];
}

export interface PortfolioReport { rows: ReportRow[]; totals: ReportTotals; months: string[] }

export function portfolioReport(
  portfolio: readonly PortfolioProject[],
  summary: readonly WorkOrderProjectSummary[] | null,
  finance: FinanceOverview | null,
  now: Date,
): PortfolioReport {
  const health = buildPortfolio(portfolio, summary, finance?.projects ?? null, now);
  const byId = new Map(portfolio.map((p) => [p.id, p]));
  const today = kathmanduToday(now).getTime();

  const rows: ReportRow[] = health.map((h) => {
    const p = byId.get(h.id)!;
    const wo = summary?.find((s) => s.projectId === h.id);
    const money = finance?.projects.find((m) => m.projectId === h.id);
    const byStatus = Object.fromEntries(WO_LIVE.map((s) => [s, wo?.byStatus[s] ?? 0])) as Record<(typeof WO_LIVE)[number], number>;
    const oldest = wo?.reviewing.oldestSubmittedAt;
    return {
      id: h.id, code: h.code, name: h.name, health: h,
      sites: p.sites.total,
      tasks: { live: p.tasks.live, completed: p.tasks.completed, overdue: p.tasks.overdue },
      weekly: [...(wo && sum(wo.completedByWeek) > 0 && p.sitesComplete === null ? wo.completedByWeek : p.completedByWeek)],
      nextMilestone: p.nextMilestone,
      workOrders: summary === null ? null : {
        byStatus,
        total: sum(Object.values(byStatus)),
        overdue: wo?.overdue ?? 0,
        firstTime: wo && wo.approved90 > 0 ? percent(wo.firstTime90, wo.approved90) : null,
        awaitingReview: wo?.reviewing.count ?? 0,
        oldestReviewDays: oldest ? Math.max(0, Math.floor((today - kathmanduToday(new Date(oldest)).getTime()) / DAY_MS)) : null,
      },
      money: finance === null ? null : {
        spentToDate: Number(money?.spentToDate ?? 0),
        spentThisMonth: Number(money?.spentByMonth.at(-1) ?? 0),
        byMonth: finance.months.map((_, i) => Number(money?.spentByMonth[i] ?? 0)),
        cashHeld: Number(money?.cashHeld ?? 0),
        overdue: { count: money?.overdueSettlements.count ?? 0, amount: Number(money?.overdueSettlements.amount ?? 0) },
      },
    };
  });

  const weeks = Math.max(0, ...rows.map((r) => r.weekly.length));
  const withWo = rows.flatMap((r) => (r.workOrders ? [r.workOrders] : []));
  const approved90 = summary ? sum(summary.map((s) => s.approved90)) : 0;
  const firstTime90 = summary ? sum(summary.map((s) => s.firstTime90)) : 0;
  const money = rows.flatMap((r) => (r.money ? [r.money] : []));
  return {
    rows,
    months: finance?.months ?? [],
    totals: {
      projects: rows.length,
      sites: sum(rows.map((r) => r.sites)),
      tasksLive: sum(rows.map((r) => r.tasks.live)),
      tasksCompleted: sum(rows.map((r) => r.tasks.completed)),
      tasksOverdue: sum(rows.map((r) => r.tasks.overdue)),
      completion: rows.length > 0 ? Math.round(sum(rows.map((r) => r.health.completion)) / rows.length) : 0,
      slipping: rows.filter((r) => r.health.schedule.severity === 'red').length,
      atRisk: rows.filter((r) => r.health.schedule.severity === 'amber').length,
      workOrdersApproved: summary ? sum(withWo.map((w) => w.byStatus.COMPLETED)) : null,
      workOrdersTotal: summary ? sum(withWo.map((w) => w.total)) : null,
      firstTime: summary && approved90 > 0 ? percent(firstTime90, approved90) : null,
      spentToDate: finance ? sum(money.map((m) => m.spentToDate)) : null,
      spentThisMonth: finance ? sum(money.map((m) => m.spentThisMonth)) : null,
      cashHeld: finance ? sum(money.map((m) => m.cashHeld)) : null,
      overdueSettlements: finance ? { count: sum(money.map((m) => m.overdue.count)), amount: sum(money.map((m) => m.overdue.amount)) } : null,
      weekly: Array.from({ length: weeks }, (_, i) => sum(rows.map((r) => r.weekly[r.weekly.length - weeks + i] ?? 0))),
    },
  };
}

export interface Series { key: string; label: string; color: string; values: number[]; total: number }

/**
 * Spend per month split by project. It reads every project finance reports,
 * not only the active ones in the portfolio, so a completed or cancelled
 * project's spend still counts and each column adds up to the month's total.
 * The largest spenders over the window keep their own series (at most four)
 * and the rest fold into "Other". Colours are dealt in project-code order, so
 * a project keeps its colour however the ranking moves between months.
 */
export function spendSeries(projects: readonly ProjectMoney[], months: readonly string[]): Series[] {
  const spenders = projects
    .map((p) => {
      const values = months.map((_, i) => Number(p.spentByMonth[i] ?? 0));
      return { key: p.projectId, label: p.code, values, total: sum(values) };
    })
    .filter((s) => s.total > 0);
  const ranked = [...spenders].sort((a, b) => b.total - a.total);
  const own = spenders.length <= MAX_SERIES ? spenders : ranked.slice(0, MAX_SERIES - 1);
  const rest = spenders.filter((s) => !own.includes(s));
  const series: Series[] = [...own]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((s, i) => ({ key: s.key, label: s.label, color: SERIES_COLORS[i]!, values: s.values, total: s.total }));
  if (rest.length > 0) {
    const values = months.map((_, i) => sum(rest.map((s) => s.values[i] ?? 0)));
    series.push({ key: 'other', label: `Other (${rest.length})`, color: OTHER_COLOR, values, total: sum(values) });
  }
  return series;
}

/** "2026-11" → "Nov" */
export const monthShort = (key: string): string => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

const CSV_HEADER = [
  'Project code', 'Project', 'Sites', 'Completion %', 'Expected by now %', 'Schedule', 'Schedule detail',
  'Tasks completed', 'Tasks live', 'Tasks overdue', 'Next milestone', 'Next milestone %',
  'Work orders', 'Approved', 'In QC review', 'In rework', 'Work orders overdue', 'First-time approval %', 'Oldest review wait (days)',
  'Spent to date (NPR)', 'Spent this month (NPR)', 'Cash with engineers (NPR)', 'Overdue settlements', 'Overdue settlement amount (NPR)',
];

/** A spreadsheet-safe cell: quoted when needed, and never read as a formula. */
function cell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportCsv(report: PortfolioReport): string {
  const lines = report.rows.map((r) => [
    r.code, r.name, r.sites, r.health.completion, r.health.expected, r.health.schedule.label, r.health.schedule.reason,
    r.tasks.completed, r.tasks.live, r.tasks.overdue, r.nextMilestone?.name ?? null, r.nextMilestone?.percent ?? null,
    r.workOrders?.total ?? null, r.workOrders?.byStatus.COMPLETED ?? null, r.workOrders?.byStatus.REVIEWING ?? null,
    r.workOrders?.byStatus.RECTIFYING ?? null, r.workOrders?.overdue ?? null, r.workOrders?.firstTime ?? null, r.workOrders?.oldestReviewDays ?? null,
    r.money ? r.money.spentToDate.toFixed(2) : null, r.money ? r.money.spentThisMonth.toFixed(2) : null,
    r.money ? r.money.cashHeld.toFixed(2) : null, r.money?.overdue.count ?? null, r.money ? r.money.overdue.amount.toFixed(2) : null,
  ].map(cell).join(','));
  return [CSV_HEADER.map(cell).join(','), ...lines].join('\r\n') + '\r\n';
}
