import { describe, expect, it } from 'vitest';
import {
  dueBucket, dueText, eligiblePeople, endOfDayIso, filterCount, initials, isWorkOrderType, pageWindow,
  personLabel, queueFilter, queueFilters, quickDates, taskKind, templatesFor,
} from './labels';

const NOW = new Date(2026, 8, 25, 10, 0); // 25 Sep 2026, 10:00 local
const at = (d: number, h = 23, m = 59) => new Date(2026, 8, d, h, m).toISOString();

describe('templatesFor', () => {
  const templates = [{ id: 'q', category: 'QUALITY' as const }, { id: 'e', category: 'EHS' as const }, { id: 'o', category: 'OTHER' as const }];
  it('offers only templates of the type’s category', () => {
    expect(templatesFor('QUALITY_SPOT_CHECK', templates).map((t) => t.id)).toEqual(['q']);
    expect(templatesFor('EHS_SELF_CHECK', templates).map((t) => t.id)).toEqual(['e']);
  });
});

describe('dueBucket', () => {
  it.each([
    [{ status: 'NOT_STARTED', plannedCompletionAt: at(24) }, 'overdue'],
    [{ status: 'ONGOING', plannedCompletionAt: at(25) }, 'today'],
    [{ status: 'RECTIFYING', plannedCompletionAt: at(30) }, 'week'],
    [{ status: 'REVIEWING', plannedCompletionAt: at(3 + 30) }, 'later'],
    [{ status: 'NOT_STARTED', plannedCompletionAt: null }, 'none'],
    [{ status: 'COMPLETED', plannedCompletionAt: at(20) }, 'closed'],
  ] as const)('%j is %s', (order, bucket) => {
    expect(dueBucket(order, NOW)).toBe(bucket);
  });
});

describe('dueText', () => {
  it('says how late, how soon, or when it closed', () => {
    expect(dueText({ status: 'NOT_STARTED', plannedCompletionAt: at(22), actualCompletionAt: null }, NOW)).toEqual({ text: '3 days overdue', tone: 'red' });
    expect(dueText({ status: 'NOT_STARTED', plannedCompletionAt: at(25), actualCompletionAt: null }, NOW)).toEqual({ text: 'Due today', tone: 'amber' });
    expect(dueText({ status: 'NOT_STARTED', plannedCompletionAt: at(26), actualCompletionAt: null }, NOW)).toEqual({ text: 'Due tomorrow', tone: 'amber' });
    expect(dueText({ status: 'ONGOING', plannedCompletionAt: at(30), actualCompletionAt: null }, NOW).text).toBe('Due 30 Sept');
    expect(dueText({ status: 'COMPLETED', plannedCompletionAt: at(30), actualCompletionAt: at(24, 12) }, NOW)).toEqual({ text: 'Done 24 Sept', tone: 'green' });
    expect(dueText({ status: 'CANCELLED', plannedCompletionAt: at(20), actualCompletionAt: null }, NOW).text).toBe('Cancelled');
  });
});

describe('quickDates', () => {
  it('offers days from today and the month’s end', () => {
    expect(quickDates(NOW)).toEqual([
      { label: 'In 3 days', day: '2026-09-28' }, { label: 'In a week', day: '2026-10-02' },
      { label: 'In 2 weeks', day: '2026-10-09' }, { label: 'End of month', day: '2026-09-30' },
    ]);
  });
});

describe('queue filters', () => {
  const counts = { ALL: 12, OVERDUE: 2, NOT_STARTED: 3, ONGOING: 1, REVIEWING: 2, RECTIFYING: 1, COMPLETED: 4, CANCELLED: 1 };
  it('sums the open statuses and passes the rest through', () => {
    expect(filterCount('open', counts)).toBe(7);
    expect(filterCount('overdue', counts)).toBe(2);
    expect(filterCount('all', counts)).toBe(12);
  });
  it('defaults to open', () => {
    expect(queueFilter(undefined).key).toBe('open');
    expect(queueFilter('rework').query).toEqual({ status: 'RECTIFYING' });
  });
  it('offers no Cancelled pill to someone who sees only their own work', () => {
    expect(queueFilters(false).map((entry) => entry.key)).toContain('cancelled');
    expect(queueFilters(true).map((entry) => entry.key)).toEqual(['open', 'overdue', 'review', 'rework', 'done', 'all']);
  });
  it('falls back to open when such a viewer asks for cancelled by URL', () => {
    expect(queueFilter('cancelled').key).toBe('cancelled');
    expect(queueFilter('cancelled', true).key).toBe('open');
  });
});

describe('eligiblePeople', () => {
  const directory = [
    { id: 'a', fullName: 'Asha Rai', employeeCode: '101', isActive: true },
    { id: 'b', fullName: 'Bikash KC', employeeCode: null, isActive: true },
    { id: 'c', fullName: 'Chandra Lama', employeeCode: null, isActive: false },
  ];
  it('offers whole-project people and those holding every chosen site, and counts the rest', () => {
    const assignable = [
      { userId: 'a', wholeProject: true, siteIds: [] },
      { userId: 'b', wholeProject: false, siteIds: ['s1'] },
      { userId: 'c', wholeProject: true, siteIds: [] },
    ];
    expect(eligiblePeople(assignable, directory, ['s1'])).toEqual({ people: [{ id: 'a', label: 'Asha Rai (101)' }, { id: 'b', label: 'Bikash KC' }], hidden: 0 });
    expect(eligiblePeople(assignable, directory, ['s1', 's2'])).toEqual({ people: [{ id: 'a', label: 'Asha Rai (101)' }], hidden: 1 });
  });
});

describe('small helpers', () => {
  it('endOfDayIso is the last second of that local day', () => {
    const local = new Date(endOfDayIso('2026-09-30')!);
    expect([local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds()]).toEqual([30, 23, 59, 59]);
    expect(endOfDayIso('30/09/2026')).toBeNull();
  });
  it('isWorkOrderType accepts the four types only', () => {
    expect(isWorkOrderType('EHS_SPOT_CHECK')).toBe(true);
    expect(isWorkOrderType('CIVIL')).toBe(false);
  });
  it('personLabel and initials', () => {
    expect(personLabel({ fullName: 'Dipesh Adhikari', employeeCode: '6000059290' })).toBe('Dipesh Adhikari (6000059290)');
    expect(initials('Dipesh Adhikari (6000059290)')).toBe('DA');
    expect(initials('Engineer')).toBe('E');
  });
  it('taskKind names the task type or the work order type', () => {
    const names = new Map([['tt-1', 'Civil']]);
    expect(taskKind({ taskTypeId: 'tt-1', workOrderType: null }, names)).toBe('Civil');
    expect(taskKind({ taskTypeId: null, workOrderType: 'EHS_SPOT_CHECK' }, names)).toBe('EHS Spot Check');
  });
  it('pageWindow elides gaps', () => {
    expect(pageWindow(50, 103)).toEqual([1, null, 48, 49, 50, 51, 52, null, 103]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });
});

describe('previewTitle', () => {
  it('names work orders exactly as the service will', async () => {
    const { workOrderTitle } = await import('@ipms/contracts');
    const { previewTitle } = await import('./labels');
    for (const [type, site, note] of [['QUALITY_SELF_CHECK', 'SAKUWA GACHHI', ''], ['EHS_SPOT_CHECK', 'KOS102X', ' sector 2 '], ['EHS_SELF_CHECK', 'S'.repeat(300), 'x']] as const) {
      expect(previewTitle(type, site, note)).toBe(workOrderTitle(type, site, note));
    }
  }, 15000);
});
