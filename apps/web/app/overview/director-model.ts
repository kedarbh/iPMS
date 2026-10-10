import type { PortfolioProject, ProjectMoney, WorkOrderProjectSummary } from '@ipms/contracts';
import { completionOf } from '../projects/[id]/summary';

/** Every threshold the Director's home judges by. Pure module: given `now`, never reads the clock. */
export const PACE_WEEKS = 4;
export const EARLY_DAYS = 28;
export const LATE_GRACE_DAYS = 14;
export const BEHIND_POINTS = 15;
export const FIRST_TIME_CONCERN = 70;
export const FIRST_TIME_WATCH = 85;
export const MIN_APPROVALS = 5;
export const SPIKE_RATIO = 1.5;
export const SPIKE_MIN = 50_000;

export type Severity = 'red' | 'amber' | 'green' | 'neutral';
export interface Signal { label: string; severity: Severity; reason: string }

export interface ProjectHealth {
  id: string; code: string; name: string;
  completion: number;
  /** Where the project should be by now, 0–100; null without a start and target date. */
  expected: number | null;
  behind: number;
  /** Completion leaves out work orders because qc did not answer. */
  partial: boolean;
  schedule: Signal;
  /** Null when qc did not answer. */
  quality: Signal | null;
  /** Null when finance did not answer. */
  money: Signal | null;
  standing: Severity;
}

const DAY_MS = 86_400_000;
const OFFSET_MS = 345 * 60_000;
const RANK: Record<Severity, number> = { red: 3, amber: 2, green: 1, neutral: 0 };

/** Today in Kathmandu as UTC midnight, so whole-day arithmetic is exact. Mirrors kathmanduDay in @ipms/contracts. */
export function kathmanduToday(now: Date): Date {
  const shifted = new Date(now.getTime() + OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}
const dayOf = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const daysBetween = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / DAY_MS);
const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);
const dayText = (date: Date): string => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const lateText = (days: number): string => (days >= 14 ? plural(Math.round(days / 7), 'week') : plural(days, 'day'));
const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

/** "NPR 2.4 lakh", "NPR 1.3 crore", "NPR 45,000": money as a Director scans it. */
export function nprShort(amount: string | number): string {
  const value = Number(amount);
  const short = (n: number, unit: string) => `NPR ${n.toFixed(1).replace(/\.0$/, '')} ${unit}`;
  if (value >= 10_000_000) return short(value / 10_000_000, 'crore');
  if (value >= 100_000) return short(value / 100_000, 'lakh');
  return `NPR ${Math.round(value).toLocaleString('en-IN')}`;
}

export interface ScheduleInput {
  status: string;
  startDate: string | null;
  targetDate: string | null;
  completion: number;
  remaining: number;
  /** Units completed in the last 28 days. */
  recent: number;
  nextMilestone: PortfolioProject['nextMilestone'];
}

/** The schedule signal: the spec's rules in order, first match wins. */
export function scheduleSignal(input: ScheduleInput, now: Date): { signal: Signal; expected: number | null; behind: number } {
  const today = kathmanduToday(now);
  const start = input.startDate ? dayOf(input.startDate) : null;
  const target = input.targetDate ? dayOf(input.targetDate) : null;
  let expected: number | null = null;
  if (start && target) {
    const span = daysBetween(start, target);
    const share = span <= 0 ? (today >= start ? 1 : 0) : daysBetween(start, today) / span;
    expected = Math.round(Math.min(1, Math.max(0, share)) * 100);
  }
  const behind = expected === null ? 0 : expected - input.completion;
  const progress = `${input.completion}% done, ${expected ?? 0}% of time used`;
  const milestone = input.nextMilestone;
  const next = milestone?.targetDate ? `. Next: ${milestone.name}, due ${dayText(dayOf(milestone.targetDate))}, ${milestone.percent}% of sites` : '';
  const result = (label: string, severity: Severity, reason: string) => ({ signal: { label, severity, reason }, expected, behind });

  if (input.status === 'ON_HOLD') return result('On hold', 'neutral', 'On hold');
  if (input.completion >= 100 && input.remaining <= 0) return result('Complete', 'green', 'All work complete');
  if (!start || !target) return result('Not scheduled', 'neutral', !target ? 'No target date set' : 'No start date set');
  if (today > target) return result('Slipping', 'red', `Target was ${dayText(target)}; ${input.completion}% done`);
  if (daysBetween(start, today) < EARLY_DAYS) {
    if (today < start) return result('On track', 'green', `Starts ${dayText(start)}`);
    const atRisk = behind > BEHIND_POINTS;
    return result(atRisk ? 'At risk' : 'On track', atRisk ? 'amber' : 'green', `Too early to forecast; ${progress}`);
  }
  if (input.recent === 0) return result('Stalled', 'red', `Nothing completed in 4 weeks${next}`);
  // Whole-number arithmetic: remaining units at the 28-day pace, in days.
  const forecast = addDays(today, Math.ceil((input.remaining * PACE_WEEKS * 7) / input.recent));
  const late = daysBetween(target, forecast);
  if (late > LATE_GRACE_DAYS) return result('Slipping', 'red', `${progress}. At current pace finishes ${dayText(forecast)}, ${lateText(late)} after target${next}`);
  if (late > 0) return result('At risk', 'amber', `At current pace finishes ${dayText(forecast)}, ${lateText(late)} after target${next}`);
  if (behind > BEHIND_POINTS) return result('At risk', 'amber', `${progress}${next}`);
  return result('On track', 'green', `On pace to finish by ${dayText(forecast)}${next}`);
}

/** Quality from the project's work orders: first-time approval over 90 days. */
export function qualitySignal(summary: WorkOrderProjectSummary | undefined): Signal {
  if (!summary) return { label: 'No work orders', severity: 'neutral', reason: 'No work orders yet' };
  const rework = summary.byStatus['RECTIFYING'] ?? 0;
  const extras = [rework > 0 ? `${rework} in rework` : '', summary.overdue > 0 ? `${summary.overdue} overdue` : ''].filter(Boolean).join(', ');
  const tail = extras ? `; ${extras}` : '';
  if (summary.approved90 < MIN_APPROVALS) return { label: 'Not enough reviews', severity: 'neutral', reason: `${plural(summary.approved90, 'approval')} in 90 days${tail}` };
  const rate = Math.round((summary.firstTime90 / summary.approved90) * 100);
  const reason = `${rate}% approved first time${tail}`;
  if (rate < FIRST_TIME_CONCERN) return { label: 'Concern', severity: 'red', reason };
  if (rate < FIRST_TIME_WATCH) return { label: 'Watch', severity: 'amber', reason };
  return { label: 'Good', severity: 'green', reason };
}

/** Money: a month well above the 3 before it, and cash past its settle-by day. */
export function moneySignal(money: ProjectMoney | undefined): Signal {
  if (!money) return { label: 'No spend', severity: 'neutral', reason: 'No spend recorded yet' };
  const months = money.spentByMonth.map(Number);
  const thisMonth = months[months.length - 1] ?? 0;
  const usual = sum(months.slice(-4, -1)) / 3;
  const spike = thisMonth > SPIKE_RATIO * usual && thisMonth - usual >= SPIKE_MIN;
  const late = money.overdueSettlements.count;
  const cash = Number(money.cashHeld);
  const parts = [`${nprShort(thisMonth)} this month${spike ? (usual > 0 ? `, ${(thisMonth / usual).toFixed(1)}× usual` : ', none in the 3 months before') : ''}`];
  if (cash > 0) parts.push(`${nprShort(cash)} with engineers${late > 0 ? `, ${plural(late, 'settlement')} overdue` : ''}`);
  const watch = spike || late > 0;
  return { label: watch ? 'Watch' : 'Good', severity: watch ? 'amber' : 'green', reason: parts.join('; ') };
}

/**
 * One row per project, worst standing first. Completion uses the project
 * page's rule, adding work orders to tasks when no milestone declares
 * requirements. `workOrders` or `money` is null when that service did not answer.
 */
export function buildPortfolio(
  projects: readonly PortfolioProject[],
  workOrders: readonly WorkOrderProjectSummary[] | null,
  money: readonly ProjectMoney[] | null,
  now: Date,
): ProjectHealth[] {
  const recentOf = (weeks: readonly number[]) => sum(weeks.slice(-PACE_WEEKS));
  return projects.map((project) => {
    const wo = workOrders?.find((w) => w.projectId === project.id);
    const byMilestones = project.sitesComplete !== null;
    const woLive = wo ? sum(Object.entries(wo.byStatus).flatMap(([status, n]) => (status === 'CANCELLED' ? [] : [n]))) : 0;
    const completed = project.tasks.completed + (byMilestones ? 0 : wo?.byStatus['COMPLETED'] ?? 0);
    const live = project.tasks.live + (byMilestones ? 0 : woLive);
    const completion = completionOf({ sitesComplete: project.sitesComplete, sites: project.sites.total, completed, live });
    const remaining = byMilestones ? project.sites.total - (project.sitesComplete ?? 0) : live - completed;
    const recent = recentOf(project.completedByWeek) + (byMilestones || !wo ? 0 : recentOf(wo.completedByWeek));
    const { signal: schedule, expected, behind } = scheduleSignal({
      status: project.status, startDate: project.startDate, targetDate: project.targetDate, completion, remaining, recent, nextMilestone: project.nextMilestone,
    }, now);
    const quality = workOrders === null ? null : qualitySignal(wo);
    const spend = money === null ? null : moneySignal(money.find((m) => m.projectId === project.id));
    const standing = [schedule, quality, spend].reduce<Severity>((worst, s) => (s && RANK[s.severity] > RANK[worst] ? s.severity : worst), 'neutral');
    return { id: project.id, code: project.code, name: project.name, completion, expected, behind, partial: workOrders === null && !byMilestones, schedule, quality, money: spend, standing };
  }).sort((a, b) => RANK[b.standing] - RANK[a.standing] || b.behind - a.behind || a.code.localeCompare(b.code));
}

/** The header's one sentence: what waits on the viewer, then how the projects are doing. */
export function headline(waiting: { count: number; amount: string } | null, health: readonly ProjectHealth[]): string {
  const parts: string[] = [];
  if (waiting) {
    parts.push(waiting.count === 0 ? 'Nothing waits on you' : `${plural(waiting.count, 'request')} worth ${nprShort(waiting.amount)} ${waiting.count === 1 ? 'waits' : 'wait'} on you`);
  }
  const slipping = health.filter((h) => h.schedule.severity === 'red').length;
  const atRisk = health.filter((h) => h.schedule.severity === 'amber').length;
  if (slipping > 0) parts.push(`${slipping} of ${plural(health.length, 'project')} slipping`);
  else if (atRisk > 0) parts.push(`${atRisk} of ${plural(health.length, 'project')} at risk`);
  else if (health.length > 0 && health.every((h) => h.schedule.severity === 'green')) parts.push('every project is on track');
  if (parts.length === 0) return '';
  const sentence = `${parts.join(' · ')}.`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}

/** "today", "1 day", "5 days": how long something has waited, in Kathmandu days. */
export function waitingFor(since: string | null, now: Date): string {
  if (!since) return '—';
  const days = daysBetween(kathmanduToday(new Date(since)), kathmanduToday(now));
  return days <= 0 ? 'today' : plural(days, 'day');
}

/** "under an hour", "4 h", "3 days". */
export function decideTimeText(hours: number): string {
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${Math.round(hours)} h`;
  return plural(Math.round(hours / 24), 'day');
}
