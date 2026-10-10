/** Nepal keeps one offset all year, UTC+5:45, so a fixed shift is exact. */
export const KATHMANDU_OFFSET_MINUTES = 345;

/** Rolling seven-day windows the portfolio and work-order summaries count completions in; the last four are the 28 days pace uses. */
export const SUMMARY_WEEKS = 8;

const WEEK_MS = 7 * 86_400_000;

/** The calendar day in Kathmandu at this instant, as `YYYY-MM-DD`. */
export function kathmanduDay(at: Date): string {
  return new Date(at.getTime() + KATHMANDU_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** The calendar month in Kathmandu at this instant, as `YYYY-MM`. */
export function kathmanduMonth(at: Date): string {
  return kathmanduDay(at).slice(0, 7);
}

/** The `count` months ending with the one `now` falls in (in Kathmandu), oldest first, as `YYYY-MM`. */
export function recentMonths(now: Date, count: number): string[] {
  const [year, month] = kathmanduMonth(now).split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1)).toISOString().slice(0, 7));
}

/**
 * Counts instants into rolling seven-day windows ending at `now`, oldest
 * first: the last window is the seven days up to `now`. Rolling rather than
 * calendar weeks, so the last four windows are exactly the last 28 days.
 * Instants after `now` or older than the first window are left out.
 */
export function weeklyCounts(instants: readonly Date[], now: Date, weeks: number): number[] {
  const counts = new Array<number>(weeks).fill(0);
  for (const at of instants) {
    const age = now.getTime() - at.getTime();
    if (age < 0) continue;
    const index = weeks - 1 - Math.floor(age / WEEK_MS);
    if (index >= 0) counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}
