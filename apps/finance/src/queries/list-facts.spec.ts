import { describe, expect, it, vi } from 'vitest';
import { listFacts } from './list-facts.js';

const dec = (v: string) => ({ toFixed: () => v });
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function build(opts: { settled?: unknown[]; payments?: unknown[]; bills?: unknown[] } = {}) {
  const prisma = {
    financeRequest: { findMany: vi.fn(async () => opts.settled ?? []) },
    payment: { findMany: vi.fn(async () => opts.payments ?? []) },
    requestInvoice: { findMany: vi.fn(async () => opts.bills ?? []) },
  };
  return prisma;
}

describe('listFacts', () => {
  it('gives a paid advance its balance and settle-by day, from the payout', async () => {
    const prisma = build({
      settled: [{ advanceId: 'a1', appliedAmount: dec('6000.00') }],
      payments: [
        { requestId: 'a1', kind: 'PAYOUT', amount: dec('10000.00'), paidOn: day('2026-10-07') },
        { requestId: 'a1', kind: 'CASH_RETURN', amount: dec('1000.00'), paidOn: day('2026-10-09') },
      ],
    });
    const facts = await listFacts(prisma as never, [{ id: 'a1', kind: 'ADVANCE', status: 'PAID', approvedAmount: dec('10000.00') }]);
    expect(facts.get('a1')).toEqual({
      balance: { paid: '10000.00', applied: '6000.00', cashReturned: '1000.00', outstanding: '3000.00', status: 'PARTIALLY_SETTLED' },
      settlementDueOn: '2026-10-14',
    });
  });

  it('marks a fully settled advance closed, so it is not still "to settle"', async () => {
    const prisma = build({
      settled: [{ advanceId: 'a1', appliedAmount: dec('10000.00') }],
      payments: [{ requestId: 'a1', kind: 'PAYOUT', amount: dec('10000.00'), paidOn: day('2026-10-07') }],
    });
    const facts = await listFacts(prisma as never, [{ id: 'a1', kind: 'ADVANCE', status: 'PAID', approvedAmount: dec('10000.00') }]);
    expect(facts.get('a1')!.balance!.status).toBe('CLOSED');
  });

  it('gives a settlement the VAT inside its VAT bills only', async () => {
    const prisma = build({ bills: [{ requestId: 's1', amount: dec('15000.00') }, { requestId: 's1', amount: dec('2250.00') }] });
    const facts = await listFacts(prisma as never, [
      { id: 's1', kind: 'SETTLEMENT', status: 'SETTLED', approvedAmount: dec('17250.00') },
      { id: 's2', kind: 'SETTLEMENT', status: 'SETTLED', approvedAmount: dec('100.00') },
    ]);
    expect(facts.get('s1')).toEqual({ vatAmount: '1984.51' });
    expect(facts.has('s2')).toBe(false);
  });

  it('asks nothing of the database for rows that need no facts', async () => {
    const prisma = build();
    const facts = await listFacts(prisma as never, [
      { id: 'a2', kind: 'ADVANCE', status: 'PENDING_PM', approvedAmount: null },
      { id: 'a3', kind: 'ADVANCE', status: 'DRAFT', approvedAmount: null },
    ]);
    expect(facts.size).toBe(0);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
    expect(prisma.requestInvoice.findMany).not.toHaveBeenCalled();
  });

  it('uses a handful of queries however many rows there are', async () => {
    const prisma = build();
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `a${i}`, kind: 'ADVANCE', status: 'PAID', approvedAmount: dec('1.00') }));
    await listFacts(prisma as never, rows);
    expect(prisma.financeRequest.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.payment.findMany).toHaveBeenCalledTimes(1);
  });
});
