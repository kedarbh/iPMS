import type { PrismaClient } from '@prisma-clients/finance';
import { advanceBalance, type AdvanceBalance } from '../balance.js';
import { sumMoney, vatIncluded } from '../money.js';
import { settlementDueOn } from '../settlement.js';

/** What a list row carries beyond the request itself, so a screen can show standing without a request per row. */
export interface ListFacts {
  /** A paid advance's balance: what is outstanding, returned, applied. */
  balance?: AdvanceBalance;
  /** A paid advance's last day to settle. */
  settlementDueOn?: string;
  /** The VAT inside a settlement's or reimbursement's VAT bills, when it has any. */
  vatAmount?: string;
}

type Row = { id: string; kind: string; status: string; approvedAmount: { toFixed(digits: number): string } | null };

/**
 * Facts for one page of requests, in a handful of queries however many rows:
 * paid advances get their balance and settle-by day, settlements and
 * reimbursements the VAT on their VAT bills.
 */
export async function listFacts(prisma: PrismaClient, rows: readonly Row[]): Promise<Map<string, ListFacts>> {
  const facts = new Map<string, ListFacts>();
  const advances = rows.filter((r) => r.kind === 'ADVANCE' && r.status === 'PAID');
  const others = rows.filter((r) => r.kind !== 'ADVANCE');

  if (advances.length > 0) {
    const ids = advances.map((r) => r.id);
    const [settled, payments] = await Promise.all([
      prisma.financeRequest.findMany({ where: { advanceId: { in: ids }, status: 'SETTLED' }, select: { advanceId: true, appliedAmount: true } }),
      prisma.payment.findMany({ where: { requestId: { in: ids } }, select: { requestId: true, kind: true, amount: true, paidOn: true } }),
    ]);
    for (const advance of advances) {
      const applied = settled.filter((s) => s.advanceId === advance.id).map((s) => s.appliedAmount?.toFixed(2) ?? '0.00');
      const mine = payments.filter((p) => p.requestId === advance.id);
      const payout = mine.find((p) => p.kind === 'PAYOUT');
      facts.set(advance.id, {
        balance: advanceBalance({
          paid: advance.approvedAmount?.toFixed(2) ?? '0.00',
          applied,
          cashReturned: mine.filter((p) => p.kind === 'CASH_RETURN').map((p) => p.amount.toFixed(2)),
        }),
        ...(payout ? { settlementDueOn: settlementDueOn(payout.paidOn) } : {}),
      });
    }
  }

  if (others.length > 0) {
    const bills = await prisma.requestInvoice.findMany({
      where: { requestId: { in: others.map((r) => r.id) }, vat: true },
      select: { requestId: true, amount: true },
    });
    for (const row of others) {
      const mine = bills.filter((b) => b.requestId === row.id);
      if (mine.length > 0) facts.set(row.id, { vatAmount: sumMoney(mine.map((b) => vatIncluded(b.amount.toFixed(2)))) });
    }
  }
  return facts;
}
