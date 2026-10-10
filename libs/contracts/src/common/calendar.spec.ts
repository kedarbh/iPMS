import { describe, expect, it } from 'vitest';
import { kathmanduDay, kathmanduMonth, recentMonths, weeklyCounts } from './calendar.js';

describe('kathmanduDay', () => {
  it('turns the day over at midnight Kathmandu time, 18:15 UTC', () => {
    expect(kathmanduDay(new Date('2026-09-30T18:14:59Z'))).toBe('2026-09-30');
    expect(kathmanduDay(new Date('2026-09-30T18:15:00Z'))).toBe('2026-10-01');
  });
});

describe('kathmanduMonth', () => {
  it('reads the month in Kathmandu, not UTC', () => {
    expect(kathmanduMonth(new Date('2026-09-30T19:00:00Z'))).toBe('2026-10');
    expect(kathmanduMonth(new Date('2026-09-30T18:00:00Z'))).toBe('2026-09');
  });
});

describe('recentMonths', () => {
  it('lists the months ending with the current one, oldest first, across a year end', () => {
    expect(recentMonths(new Date('2026-02-10T06:00:00Z'), 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('weeklyCounts', () => {
  const now = new Date('2026-10-10T06:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

  it('counts into rolling seven-day windows ending now, oldest first', () => {
    expect(weeklyCounts([ago(1), ago(6.9), ago(7.1), ago(20)], now, 4)).toEqual([0, 1, 1, 2]);
  });

  it('leaves out instants older than the first window or after now', () => {
    expect(weeklyCounts([ago(28.5), ago(-1)], now, 4)).toEqual([0, 0, 0, 0]);
  });
});
