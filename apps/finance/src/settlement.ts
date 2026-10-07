import { SETTLEMENT_WINDOW_DAYS } from '@ipms/contracts';

/**
 * The last day to settle an advance: [SETTLEMENT_WINDOW_DAYS] after the day it
 * was paid. Dates here are calendar days (`paidOn` is a date, not a moment), so
 * this adds days to the date in UTC and returns `YYYY-MM-DD`.
 */
export function settlementDueOn(paidOn: Date): string {
  const due = new Date(Date.UTC(paidOn.getUTCFullYear(), paidOn.getUTCMonth(), paidOn.getUTCDate() + SETTLEMENT_WINDOW_DAYS));
  return due.toISOString().slice(0, 10);
}

/** The due day of a paid advance from its payments; null until it has been paid out. */
export function advanceSettlementDue(row: { kind: string; status: string }, payments: ReadonlyArray<{ kind: string; paidOn: Date }>): string | null {
  if (row.kind !== 'ADVANCE' || row.status !== 'PAID') return null;
  const payout = payments.find((p) => p.kind === 'PAYOUT');
  return payout ? settlementDueOn(payout.paidOn) : null;
}
