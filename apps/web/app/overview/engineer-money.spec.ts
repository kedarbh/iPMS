import { describe, expect, it } from 'vitest';
import type { FinanceRequest } from '../lib/finance-api';
import { engineerMoney, kathmanduToday } from './engineer-money';

const request = (over: Partial<FinanceRequest>): FinanceRequest => ({
  id: 'r', number: 'FIN-1', kind: 'ADVANCE', status: 'PAID', revision: 1, entryStatus: null,
  projectId: 'p', projectCode: 'KOS', projectName: 'Kosi', workOrderId: null, categoryId: 'c', requesterId: 'u',
  advanceId: null, purpose: 'Cement', requestedAmount: '5000.00', approvedAmount: null, appliedAmount: null,
  submittedAt: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...over,
});

describe('engineerMoney', () => {
  it('adds up the cash still out on paid advances, overdue first', () => {
    const requests = [
      request({ id: 'a', approvedAmount: '4000.00' }),
      request({ id: 'b', requestedAmount: '10000.00' }),
      request({ id: 'c', requestedAmount: '2500.50' }),
    ];
    const details = new Map([
      ['a', { balance: { paid: '4000.00', applied: '1000.00', cashReturned: '0.00', outstanding: '3000.00', status: 'PARTIALLY_SETTLED' as const }, settlementDueOn: '2026-12-02' }],
      ['b', { balance: { paid: '10000.00', applied: '0.00', cashReturned: '0.00', outstanding: '10000.00', status: 'PAID' as const }, settlementDueOn: '2026-11-20' }],
    ]);
    const money = engineerMoney(requests, details, '2026-11-27');
    expect(money.advances.map((a) => a.id)).toEqual(['b', 'a', 'c']);
    expect(money.overdue).toBe(1);
    expect(money.advances[0]?.due?.overdue).toBe(true);
    // c has no detail: the whole advance counts as still out.
    expect(money.cashWithYou).toBe('15500.50');
  });

  it('leaves out closed advances and anything not yet paid', () => {
    const requests = [
      request({ id: 'closed' }),
      request({ id: 'pending', status: 'PENDING_PM', requestedAmount: '700.00' }),
      request({ id: 'reimb', kind: 'REIMBURSEMENT', status: 'PENDING_FINANCE', requestedAmount: '300.00', approvedAmount: '250.00' }),
      request({ id: 'back', kind: 'REIMBURSEMENT', status: 'RETURNED' }),
      request({ id: 'draft', status: 'DRAFT' }),
    ];
    const details = new Map([['closed', { balance: { paid: '5000.00', applied: '5000.00', cashReturned: '0.00', outstanding: '0.00', status: 'CLOSED' as const }, settlementDueOn: '2026-11-01' }]]);
    const money = engineerMoney(requests, details, '2026-11-27');
    expect(money.advances).toEqual([]);
    expect(money.cashWithYou).toBe('0.00');
    expect(money.inApproval).toEqual({ count: 2, amount: '950.00' });
    expect(money.returned.map((r) => r.id)).toEqual(['back']);
    expect(money.drafts).toBe(1);
  });
});

describe('kathmanduToday', () => {
  it('rolls over to the next day at midnight Nepal time, not UTC', () => {
    expect(kathmanduToday(new Date('2026-11-27T18:00:00Z'))).toBe('2026-11-27');
    expect(kathmanduToday(new Date('2026-11-27T18:20:00Z'))).toBe('2026-11-28');
  });
});
