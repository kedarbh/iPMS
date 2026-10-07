import { describe, expect, it } from 'vitest';
import { SETTLEMENT_WINDOW_DAYS } from '@ipms/contracts';
import { advanceSettlementDue, settlementDueOn } from './settlement.js';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('settlementDueOn', () => {
  it('is a week after the day the advance was paid', () => {
    expect(SETTLEMENT_WINDOW_DAYS).toBe(7);
    expect(settlementDueOn(day('2026-10-07'))).toBe('2026-10-14');
  });

  it('carries over month and year ends', () => {
    expect(settlementDueOn(day('2026-10-28'))).toBe('2026-11-04');
    expect(settlementDueOn(day('2026-12-29'))).toBe('2027-01-05');
  });

  it('counts calendar days, whatever time of day the date was stored at', () => {
    expect(settlementDueOn(new Date('2026-10-07T23:59:59.000Z'))).toBe('2026-10-14');
  });
});

describe('advanceSettlementDue', () => {
  const payments = [{ kind: 'CASH_RETURN', paidOn: day('2026-10-09') }, { kind: 'PAYOUT', paidOn: day('2026-10-07') }];

  it('runs from the payout, not from cash returned later', () => {
    expect(advanceSettlementDue({ kind: 'ADVANCE', status: 'PAID' }, payments)).toBe('2026-10-14');
  });

  it('is null for anything but a paid advance, or one not yet paid out', () => {
    expect(advanceSettlementDue({ kind: 'ADVANCE', status: 'PENDING_FINANCE' }, payments)).toBeNull();
    expect(advanceSettlementDue({ kind: 'REIMBURSEMENT', status: 'PAID' }, payments)).toBeNull();
    expect(advanceSettlementDue({ kind: 'ADVANCE', status: 'PAID' }, [])).toBeNull();
  });
});
