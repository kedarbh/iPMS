import { describe, expect, it } from 'vitest';
import type { NotificationDto } from '@ipms/contracts';
import { categoryOf, markEveryRead, markIdsUnread, markOneRead, relativeTime, toItem } from './notification-model';

const NOW = new Date('2026-10-02T12:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('categoryOf', () => {
  it('groups by the type prefix', () => {
    expect(categoryOf('QC_SUBMISSION_APPROVED')).toBe('qc');
    expect(categoryOf('WORK_ORDER_ASSIGNED')).toBe('work-order');
    expect(categoryOf('FINANCE_REQUEST_RETURNED')).toBe('finance');
    expect(categoryOf('SOMETHING_ELSE')).toBe('system');
  });
});

describe('relativeTime', () => {
  it('reads naturally across the ranges', () => {
    expect(relativeTime(at(10_000), NOW)).toBe('just now');
    expect(relativeTime(at(5 * 60_000), NOW)).toBe('5m ago');
    expect(relativeTime(at(3 * 3_600_000), NOW)).toBe('3h ago');
    expect(relativeTime(at(2 * 86_400_000), NOW)).toBe('2d ago');
    expect(relativeTime(at(30 * 86_400_000), NOW)).toBe('2026-09-02');
  });

  it('never goes negative when the clocks disagree, and tolerates junk', () => {
    expect(relativeTime(at(-60_000), NOW)).toBe('just now');
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});

describe('toItem', () => {
  it('maps the wire shape to what the panel renders', () => {
    const dto: NotificationDto = {
      id: 'n-1', type: 'QC_SUBMISSION_REJECTED', title: 'Rework required', body: 'Fix it',
      actionUrl: '/quality/work-orders/w-1', workOrderId: 'w-1', isRead: false, createdAt: at(5 * 60_000),
    };
    expect(toItem(dto, NOW)).toEqual({
      id: 'n-1', category: 'qc', title: 'Rework required', description: 'Fix it',
      time: '5m ago', unread: true, href: '/quality/work-orders/w-1',
    });
  });

  it('omits href when there is no action url', () => {
    const item = toItem({ id: 'n', type: 'X', title: 't', body: 'b', actionUrl: null, workOrderId: null, isRead: true, createdAt: at(0) }, NOW);
    expect('href' in item).toBe(false);
    expect(item.unread).toBe(false);
  });
});

describe('read-state helpers', () => {
  const items = [
    { id: 'a', category: 'qc' as const, title: '', description: '', time: '', unread: true },
    { id: 'b', category: 'qc' as const, title: '', description: '', time: '', unread: true },
  ];

  it('marks one without touching the rest or mutating the input', () => {
    const next = markOneRead(items, 'a');
    expect(next.map((i) => i.unread)).toEqual([false, true]);
    expect(items[0]!.unread).toBe(true);
  });

  it('marks every one', () => {
    expect(markEveryRead(items).every((i) => !i.unread)).toBe(true);
  });

  describe('markIdsUnread', () => {
    const read = [
      { id: 'a', category: 'qc' as const, title: '', description: '', time: '', unread: false },
      { id: 'b', category: 'qc' as const, title: '', description: '', time: '', unread: false },
      { id: 'c', category: 'qc' as const, title: '', description: '', time: '', unread: false },
    ];

    it('marks only the given ids and leaves the others untouched', () => {
      const next = markIdsUnread(read, new Set(['a', 'c']));
      expect(next.map((i) => i.unread)).toEqual([true, false, true]);
      expect(next[1]).toBe(read[1]);
    });

    it('does not mutate its input', () => {
      markIdsUnread(read, new Set(['a']));
      expect(read.every((i) => !i.unread)).toBe(true);
    });

    it('returns items unchanged for an empty set', () => {
      expect(markIdsUnread(read, new Set())).toEqual(read);
    });
  });
});
