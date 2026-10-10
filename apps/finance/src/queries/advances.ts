import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { kathmanduDay } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { advanceBalance } from '../balance.js';
import { compareMoney } from '../money.js';
import { settlementDueOn } from '../settlement.js';
import { PENDING_STATUSES } from '../workflow.js';

const DAY_MS = 86_400_000;

/** A paid advance with money still out. */
export interface OpenAdvance {
  id: string; requesterId: string; projectId: string; projectCode: string; projectName: string;
  outstanding: string;
  /** The last day to settle, `YYYY-MM-DD`; null if no payout is recorded. */
  dueOn: string | null;
  /** A settlement against it is waiting for approval. */
  inReview: boolean;
  /** Past its settle-by day with no settlement under review. */
  overdue: boolean;
  /** Whole days past the settle-by day; 0 when not overdue. */
  daysOverdue: number;
}

/**
 * Paid advances in the caller's project scope that still have money out,
 * optionally only those of some requesters. Overdue means past the
 * settle-by day (in Kathmandu) with no settlement under review, the rule
 * mobile uses.
 */
export async function loadOpenAdvances(prisma: PrismaClient, scope: AuthzScope, now: Date, requesterIds?: readonly string[]): Promise<OpenAdvance[]> {
  const advances = await prisma.financeRequest.findMany({
    where: {
      AND: [
        scopeWhere(scope, { project: 'projectId', site: null }) as Prisma.FinanceRequestWhereInput,
        { kind: 'ADVANCE', status: 'PAID' },
        requesterIds ? { requesterId: { in: [...requesterIds] } } : {},
      ],
    },
    select: { id: true, requesterId: true, projectId: true, projectCode: true, projectName: true, approvedAmount: true },
  });
  if (advances.length === 0) return [];
  const ids = advances.map((a) => a.id);
  const [settled, payments, pending] = await Promise.all([
    prisma.financeRequest.findMany({ where: { advanceId: { in: ids }, status: 'SETTLED' }, select: { advanceId: true, appliedAmount: true } }),
    prisma.payment.findMany({ where: { requestId: { in: ids } }, select: { requestId: true, kind: true, amount: true, paidOn: true } }),
    prisma.financeRequest.findMany({ where: { advanceId: { in: ids }, status: { in: [...PENDING_STATUSES] } }, select: { advanceId: true } }),
  ]);
  const today = kathmanduDay(now);
  const open: OpenAdvance[] = [];
  for (const advance of advances) {
    const mine = payments.filter((p) => p.requestId === advance.id);
    const balance = advanceBalance({
      paid: advance.approvedAmount?.toFixed(2) ?? '0.00',
      applied: settled.filter((s) => s.advanceId === advance.id).map((s) => s.appliedAmount?.toFixed(2) ?? '0.00'),
      cashReturned: mine.filter((p) => p.kind === 'CASH_RETURN').map((p) => p.amount.toFixed(2)),
    });
    if (compareMoney(balance.outstanding, '0') <= 0) continue;
    const payout = mine.find((p) => p.kind === 'PAYOUT');
    const dueOn = payout ? settlementDueOn(payout.paidOn) : null;
    const inReview = pending.some((s) => s.advanceId === advance.id);
    const overdue = dueOn !== null && dueOn < today && !inReview;
    open.push({
      id: advance.id, requesterId: advance.requesterId, projectId: advance.projectId, projectCode: advance.projectCode, projectName: advance.projectName,
      outstanding: balance.outstanding, dueOn, inReview, overdue,
      daysOverdue: overdue && dueOn ? Math.round((Date.parse(today) - Date.parse(dueOn)) / DAY_MS) : 0,
    });
  }
  return open;
}
