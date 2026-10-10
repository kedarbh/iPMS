import { describe, expect, it } from 'vitest';
import type { PortfolioProject, ProjectMoney, WorkOrderProjectSummary } from '@ipms/contracts';
import type { ProjectDetail } from '../lib/project-api';
import { summarizeProject, type Work } from '../projects/[id]/summary';
import {
  buildPortfolio, decideTimeText, headline, moneySignal, nprShort, qualitySignal, scheduleSignal, waitingFor, type ProjectHealth,
} from './director-model';

const NOW = new Date('2026-10-10T06:00:00Z');
const YEAR = { status: 'ACTIVE', startDate: '2026-01-01T00:00:00.000Z', targetDate: '2026-12-31T00:00:00.000Z', nextMilestone: null };

describe('nprShort', () => {
  it('reads money the way a Director scans it', () => {
    expect(nprShort('45000.00')).toBe('NPR 45,000');
    expect(nprShort('240000.00')).toBe('NPR 2.4 lakh');
    expect(nprShort('300000.00')).toBe('NPR 3 lakh');
    expect(nprShort(12_500_000)).toBe('NPR 1.3 crore');
  });
});

describe('scheduleSignal', () => {
  const run = (over: Partial<Parameters<typeof scheduleSignal>[0]>) =>
    scheduleSignal({ ...YEAR, completion: 50, remaining: 10, recent: 20, ...over }, NOW);

  it('leaves a project on hold unjudged', () => {
    expect(run({ status: 'ON_HOLD' }).signal).toEqual({ label: 'On hold', severity: 'neutral', reason: 'On hold' });
  });

  it('calls a finished project complete', () => {
    expect(run({ completion: 100, remaining: 0 }).signal).toMatchObject({ label: 'Complete', severity: 'green' });
  });

  it('does not call a project complete while work remains, even when it rounds to 100%', () => {
    expect(run({ completion: 100, remaining: 1, targetDate: '2026-09-30T00:00:00.000Z' }).signal).toMatchObject({ label: 'Slipping', severity: 'red' });
  });

  it('asks for dates when there are none', () => {
    expect(run({ targetDate: null }).signal).toEqual({ label: 'Not scheduled', severity: 'neutral', reason: 'No target date set' });
  });

  it('says a project past its target is slipping', () => {
    expect(run({ targetDate: '2026-09-30T00:00:00.000Z', completion: 78 }).signal).toEqual({ label: 'Slipping', severity: 'red', reason: 'Target was 30 Sept; 78% done' });
  });

  it('does not forecast a project in its first four weeks', () => {
    expect(run({ startDate: '2026-09-30T00:00:00.000Z', completion: 5 }).signal).toEqual({ label: 'On track', severity: 'green', reason: 'Too early to forecast; 5% done, 11% of time used' });
    expect(run({ startDate: '2026-11-01T00:00:00.000Z', completion: 0 }).signal).toEqual({ label: 'On track', severity: 'green', reason: 'Starts 1 Nov' });
  });

  it('says a project with nothing done in four weeks is stalled', () => {
    expect(run({ recent: 0 }).signal).toMatchObject({ label: 'Stalled', severity: 'red', reason: 'Nothing completed in 4 weeks' });
  });

  it('says it is slipping when the pace finishes it more than two weeks late', () => {
    const { signal, expected, behind } = run({ completion: 42, remaining: 58, recent: 4 });
    expect(expected).toBe(77);
    expect(behind).toBe(35);
    expect(signal).toEqual({ label: 'Slipping', severity: 'red', reason: '42% done, 77% of time used. At current pace finishes 20 Nov, 46 weeks after target' });
  });

  it('says it is at risk when the pace finishes it a little late', () => {
    expect(run({ targetDate: '2026-11-30T00:00:00.000Z', completion: 80, remaining: 26, recent: 14 }).signal)
      .toEqual({ label: 'At risk', severity: 'amber', reason: 'At current pace finishes 1 Dec, 1 day after target' });
  });

  it('says it is at risk when it is well behind where time says it should be', () => {
    expect(run({ completion: 50, remaining: 10, recent: 20 }).signal).toEqual({ label: 'At risk', severity: 'amber', reason: '50% done, 77% of time used' });
  });

  it('says it is on track otherwise, and names the next milestone', () => {
    const nextMilestone = { name: 'Power-on', targetDate: '2026-10-20T00:00:00.000Z', percent: 35 };
    expect(run({ completion: 80, remaining: 10, recent: 20, nextMilestone }).signal)
      .toEqual({ label: 'On track', severity: 'green', reason: 'On pace to finish by 24 Oct. Next: Power-on, due 20 Oct, 35% of sites' });
  });
});

describe('qualitySignal', () => {
  const summary = (over: Partial<WorkOrderProjectSummary>): WorkOrderProjectSummary => ({
    projectId: 'p-1', byStatus: {}, overdue: 0, approved90: 10, firstTime90: 9, reviewing: { count: 0, oldestSubmittedAt: null }, completedByWeek: [], ...over,
  });

  it('says so when there are no work orders', () => {
    expect(qualitySignal(undefined)).toEqual({ label: 'No work orders', severity: 'neutral', reason: 'No work orders yet' });
  });

  it('does not judge on fewer than five approvals', () => {
    expect(qualitySignal(summary({ approved90: 4, firstTime90: 1 }))).toMatchObject({ label: 'Not enough reviews', severity: 'neutral', reason: '4 approvals in 90 days' });
  });

  it('is a concern below 70% first time, and names the rework and the overdue', () => {
    expect(qualitySignal(summary({ approved90: 25, firstTime90: 17, byStatus: { RECTIFYING: 4 }, overdue: 2 })))
      .toEqual({ label: 'Concern', severity: 'red', reason: '68% approved first time; 4 in rework, 2 overdue' });
  });

  it('is one to watch below 85%, and good above', () => {
    expect(qualitySignal(summary({ approved90: 10, firstTime90: 8 }))).toMatchObject({ label: 'Watch', severity: 'amber' });
    expect(qualitySignal(summary({ approved90: 10, firstTime90: 9 }))).toMatchObject({ label: 'Good', severity: 'green', reason: '90% approved first time' });
  });
});

describe('moneySignal', () => {
  const money = (spentByMonth: string[], over: Partial<ProjectMoney> = {}): ProjectMoney => ({
    projectId: 'p-1', code: 'KOS', name: 'Koshi', spentToDate: '0.00', spentByMonth, cashHeld: '0.00', overdueSettlements: { count: 0, amount: '0.00' }, ...over,
  });

  it('watches a month well above the usual, and cash gone past its day', () => {
    expect(moneySignal(money(['0', '0', '100000', '100000', '100000', '320000'], { cashHeld: '45000.00', overdueSettlements: { count: 1, amount: '45000.00' } })))
      .toEqual({ label: 'Watch', severity: 'amber', reason: 'NPR 3.2 lakh this month, 3.2× usual; NPR 45,000 with engineers, 1 settlement overdue' });
  });

  it('ignores a jump smaller than NPR 50,000', () => {
    expect(moneySignal(money(['0', '0', '10000', '10000', '10000', '30000']))).toEqual({ label: 'Good', severity: 'green', reason: 'NPR 30,000 this month' });
  });

  it('says so when nothing has been spent', () => {
    expect(moneySignal(undefined)).toMatchObject({ label: 'No spend', severity: 'neutral' });
  });
});

describe('buildPortfolio', () => {
  const project = (over: Partial<PortfolioProject> = {}): PortfolioProject => ({
    id: 'p-1', code: 'KOS', name: 'Koshi', ...YEAR, status: 'ACTIVE',
    sites: { total: 4, byStatus: {} }, tasks: { live: 6, completed: 3, overdue: 0, byStatus: {} },
    sitesComplete: null, nextMilestone: null, completedByWeek: [0, 0, 0, 0, 5, 5, 5, 5], ...over,
  });
  const wo = (over: Partial<WorkOrderProjectSummary> = {}): WorkOrderProjectSummary => ({
    projectId: 'p-1', byStatus: { COMPLETED: 1, ONGOING: 1, CANCELLED: 2 }, overdue: 0, approved90: 0, firstTime90: 0,
    reviewing: { count: 0, oldestSubmittedAt: null }, completedByWeek: [], ...over,
  });

  it('adds work orders to tasks when no milestone declares requirements, as the project page does', () => {
    expect(buildPortfolio([project()], [wo()], null, NOW)[0]!.completion).toBe(50);
    expect(buildPortfolio([project({ sitesComplete: 3 })], [wo()], null, NOW)[0]!.completion).toBe(75);
  });

  it('agrees with summarizeProject on the same work', () => {
    const detail = { id: 'p-1', sites: [{ id: 's-1', siteCode: 'S1', status: 'PLANNED', region: null }, { id: 's-2', siteCode: 'S2', status: 'PLANNED', region: null }], milestones: [], taskTypes: [] } as unknown as ProjectDetail;
    const work = (id: string, status: Work['status'], order: boolean): Work => ({
      id, siteId: 's-1', title: id, status, assigneeId: null, plannedCompletionAt: null, taskTypeId: order ? null : 'tt-1', workOrderType: order ? 'QUALITY_SELF_CHECK' : null,
    });
    const page = summarizeProject(detail, [work('t1', 'COMPLETED', false), work('t2', 'ONGOING', false), work('w1', 'COMPLETED', true), work('w2', 'CANCELLED', true)], NOW);
    const portfolio = buildPortfolio([project({ tasks: { live: 2, completed: 1, overdue: 0, byStatus: {} } })], [wo({ byStatus: { COMPLETED: 1, CANCELLED: 1 } })], null, NOW);
    expect(portfolio[0]!.completion).toBe(page.completion);
  });

  it('marks completion partial and quality unknown when qc did not answer', () => {
    const [health] = buildPortfolio([project()], null, null, NOW);
    expect(health).toMatchObject({ partial: true, quality: null, money: null });
  });

  it('takes the worst signal as the standing, and puts the worst first', () => {
    const late = project({ id: 'p-2', code: 'LATE', targetDate: '2026-09-30T00:00:00.000Z' });
    const fine = project({ id: 'p-3', code: 'FINE', tasks: { live: 6, completed: 6, overdue: 0, byStatus: {} } });
    const result = buildPortfolio([fine, late], [], [], NOW);
    expect(result.map((h) => h.code)).toEqual(['LATE', 'FINE']);
    expect(result[0]!.standing).toBe('red');
  });
});

describe('headline', () => {
  const health = (severity: ProjectHealth['schedule']['severity']) => ({ schedule: { label: '', severity, reason: '' } }) as ProjectHealth;

  it('leads with what waits, then the projects slipping', () => {
    expect(headline({ count: 3, amount: '240000.00' }, [health('red'), health('red'), health('green')])).toBe('3 requests worth NPR 2.4 lakh wait on you · 2 of 3 projects slipping.');
  });

  it('falls back to at risk, then to every project on track', () => {
    expect(headline({ count: 1, amount: '5000.00' }, [health('amber')])).toBe('1 request worth NPR 5,000 waits on you · 1 of 1 project at risk.');
    expect(headline({ count: 0, amount: '0.00' }, [health('green')])).toBe('Nothing waits on you · every project is on track.');
    expect(headline({ count: 0, amount: '0.00' }, [health('green'), health('neutral')])).toBe('Nothing waits on you.');
  });

  it('leaves out what it cannot know', () => {
    expect(headline(null, [health('green')])).toBe('every project is on track.');
    expect(headline(null, [])).toBe('');
  });
});

describe('waitingFor and decideTimeText', () => {
  it('counts whole Kathmandu days', () => {
    expect(waitingFor('2026-10-10T01:00:00Z', NOW)).toBe('today');
    expect(waitingFor('2026-10-05T06:00:00Z', NOW)).toBe('5 days');
    expect(waitingFor(null, NOW)).toBe('—');
  });

  it('says how long decisions take in hours or days', () => {
    expect(decideTimeText(0.4)).toBe('under an hour');
    expect(decideTimeText(4)).toBe('4 h');
    expect(decideTimeText(60)).toBe('3 days');
  });
});
