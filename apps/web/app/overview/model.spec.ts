import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../lib/audit-api';
import { auditRow, filterLog, parseLogFilter, percent, statusBreakdown, whenLabel } from './model';

function event(action: string, newState: Record<string, unknown> = {}, objectType = 'WorkOrder'): AuditEvent {
  return {
    id: 'e-1', sequence: 1, actorId: 'u-1', action, objectType, objectId: '3f2a91c0-1111-2222-3333-444455556666',
    previousState: {}, newState, details: {}, timestamp: '2026-10-03T03:27:00.000Z',
  };
}

describe('percent', () => {
  it('rounds, and is 0 rather than NaN when there is nothing to divide', () => {
    expect(percent(96, 148)).toBe(65);
    expect(percent(0, 0)).toBe(0);
  });
});

describe('statusBreakdown', () => {
  it('leaves cancelled work orders out of the total and the shares', () => {
    const { total, segments } = statusBreakdown({ COMPLETED: 96, REVIEWING: 18, RECTIFYING: 11, ONGOING: 15, NOT_STARTED: 8, CANCELLED: 40 });
    expect(total).toBe(148);
    expect(segments.map((s) => s.share)).toEqual([65, 12, 7, 10, 5]);
    expect(segments.reduce((sum, s) => sum + s.width, 0)).toBeCloseTo(100);
  });

  it('copes with no work orders at all', () => {
    const { total, segments } = statusBreakdown({});
    expect(total).toBe(0);
    expect(segments.every((s) => s.width === 0 && s.share === 0)).toBe(true);
  });
});

describe('whenLabel', () => {
  const now = new Date(2026, 9, 3, 12, 0);
  it('names today and yesterday, dates anything older', () => {
    expect(whenLabel(new Date(2026, 9, 3, 9, 5), now)).toBe('Today, 9:05');
    expect(whenLabel(new Date(2026, 9, 2, 17, 30), now)).toBe('Yesterday, 17:30');
    expect(whenLabel(new Date(2026, 8, 30, 16, 20), now)).toBe('30 Sep, 16:20');
  });
});

describe('auditRow', () => {
  it('reads an approval as Approved, and a return as Rework', () => {
    expect(auditRow(event('work_order.status_changed', { status: 'COMPLETED' }), 'Anil', 'Project manager')).toMatchObject({ tag: 'Approved', group: 'approvals', actor: 'Anil' });
    expect(auditRow(event('work_order.status_changed', { status: 'RECTIFYING' }), 'Anil', 'PM')).toMatchObject({ tag: 'Rework', group: 'rework' });
  });

  it('gives every object a short readable reference', () => {
    expect(auditRow(event('work_order.created'), 'A', 'R').ref).toBe('WO-3F2A91');
    expect(auditRow(event('project.updated', {}, 'Project'), 'A', 'R').ref).toBe('PRJ-3F2A91');
  });

  it('falls back to a sentence for actions it has no special reading for', () => {
    expect(auditRow(event('qc_template.published', {}, 'QcTemplate'), 'A', 'R')).toMatchObject({ tag: 'Updated', text: 'QC template published' });
  });
});

describe('finance audit events', () => {
  it.each([
    ['FinanceRequest', 'FIN'],
    ['ExpenseCategory', 'CAT'],
    ['Payment', 'PAY'],
  ])('files %s events under Finance with a %s reference', (objectType, prefix) => {
    const row = auditRow(event('finance.request.created', {}, objectType), 'A', 'R');
    expect(row.group).toBe('finance');
    expect(row.ref).toBe(`${prefix}-3F2A91`);
  });

  it('reads finance actions as what happened, not a generic Created/Updated', () => {
    expect(auditRow(event('finance.request.paid', {}, 'FinanceRequest'), 'A', 'R')).toMatchObject({ tag: 'Paid', tone: 'green', text: 'Request paid' });
    expect(auditRow(event('finance.request.approved', {}, 'FinanceRequest'), 'A', 'R')).toMatchObject({ tag: 'Approved', text: 'Request approved' });
    expect(auditRow(event('finance.advance.cash_returned', {}, 'FinanceRequest'), 'A', 'R')).toMatchObject({ text: 'Advance cash returned' });
    expect(auditRow(event('finance.category.updated', {}, 'ExpenseCategory'), 'A', 'R')).toMatchObject({ text: 'Category updated' });
  });

  it('shows up under the Finance filter only', () => {
    const rows = [auditRow(event('finance.request.created', {}, 'FinanceRequest'), 'A', 'R'), auditRow(event('site.updated', {}, 'Site'), 'A', 'R')];
    expect(filterLog(rows, 'finance')).toHaveLength(1);
  });
});

describe('log filters', () => {
  const rows = [
    auditRow(event('work_order.status_changed', { status: 'COMPLETED' }), 'A', 'R'),
    auditRow(event('work_order.status_changed', { status: 'RECTIFYING' }), 'A', 'R'),
    auditRow(event('site.updated', {}, 'Site'), 'A', 'R'),
  ];
  it('narrows to one group, or shows all', () => {
    expect(filterLog(rows, 'all')).toHaveLength(3);
    expect(filterLog(rows, 'approvals')).toHaveLength(1);
    expect(filterLog(rows, 'finance')).toHaveLength(0);
  });
  it('ignores a filter it does not know', () => {
    expect(parseLogFilter('rework')).toBe('rework');
    expect(parseLogFilter('nope')).toBe('all');
    expect(parseLogFilter(undefined)).toBe('all');
  });
});

import { dayLabel, firstName, greeting, workOrderRef } from './model';

describe('manager home helpers', () => {
  it('greets by the hour', () => {
    expect(greeting(new Date(2026, 9, 2, 8))).toBe('Good morning');
    expect(greeting(new Date(2026, 9, 2, 14))).toBe('Good afternoon');
    expect(greeting(new Date(2026, 9, 2, 20))).toBe('Good evening');
  });

  it('uses the first name only, and copes with no name', () => {
    expect(firstName('Anil Shrestha')).toBe('Anil');
    expect(firstName(undefined)).toBe('');
  });

  it('writes the day the way the design does', () => {
    expect(dayLabel(new Date(2026, 9, 2))).toBe('Friday, 2 October');
  });

  it('shortens a work order id to a readable reference', () => {
    expect(workOrderRef('3f2a91c0-1111-2222-3333-444455556666')).toBe('WO-3F2A91');
  });
});

import { homeFor } from './model';

describe('homeFor', () => {
  it.each([
    [['SUPER_ADMIN'], 'admin'],
    [['PROJECT_MANAGER'], 'manager'],
    [['QC_MANAGER'], 'qc'],
    [['FIELD_ENGINEER'], 'engineer'],
    [['PROJECT_MANAGER', 'SUPER_ADMIN'], 'admin'],
    [['QC_MANAGER', 'FIELD_ENGINEER'], 'qc'],
    [['SOME_CUSTOM_ROLE'], 'admin'],
    [[], 'admin'],
  ])('%j lands on the %s home', (roles, expected) => {
    expect(homeFor(roles)).toBe(expected);
  });

  it('sends Finance to the finance workspace and Project Directors to their own home', () => {
    expect(homeFor(['FINANCE'])).toBe('finance');
    expect(homeFor(['PROJECT_DIRECTOR'])).toBe('director');
    expect(homeFor(['FINANCE', 'PROJECT_DIRECTOR'])).toBe('director');
    expect(homeFor(['QC_MANAGER', 'PROJECT_DIRECTOR'])).toBe('director');
  });

  it('keeps administrators and project managers on their own homes even if they also hold a finance role', () => {
    expect(homeFor(['SUPER_ADMIN', 'FINANCE'])).toBe('admin');
    expect(homeFor(['PROJECT_MANAGER', 'PROJECT_DIRECTOR'])).toBe('manager');
  });
});
