import { kathmanduMonth } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { sumMoney } from '../money.js';

/** A request Finance has closed, with the month it closed and what it spent. */
export interface ClosedRequest {
  id: string; kind: string; projectId: string; projectCode: string; projectName: string;
  categoryId: string; category: string; requesterId: string;
  /** `YYYY-MM` in Kathmandu of Finance's PAID action. */
  month: string;
  /** Expense as the spend report counts it: a reimbursement's or settlement's approved amount. Null for an advance, whose cash is held, not spent. */
  spent: string | null;
  /** What Finance paid out when it closed the request. */
  paidOut: string;
}

/** Requests matching `where` that Finance has closed, optionally only since a moment. */
export async function loadClosed(prisma: PrismaClient, where: Prisma.FinanceRequestWhereInput, since?: Date): Promise<ClosedRequest[]> {
  const actions = await prisma.approvalAction.findMany({
    where: { step: 'FINANCE', action: 'PAID', ...(since ? { at: { gte: since } } : {}), request: where },
    select: {
      at: true, amount: true,
      request: { select: { id: true, kind: true, projectId: true, projectCode: true, projectName: true, categoryId: true, requesterId: true, approvedAmount: true, category: { select: { name: true } } } },
    },
  });
  return actions.map(({ at, amount, request }) => ({
    id: request.id, kind: request.kind, projectId: request.projectId, projectCode: request.projectCode, projectName: request.projectName,
    categoryId: request.categoryId, category: request.category.name, requesterId: request.requesterId,
    month: kathmanduMonth(at),
    spent: request.kind === 'ADVANCE' ? null : request.approvedAmount?.toFixed(2) ?? '0.00',
    paidOut: amount?.toFixed(2) ?? '0.00',
  }));
}

/** Spend in each of these months. */
export function spendByMonth(closed: readonly ClosedRequest[], months: readonly string[]): string[] {
  return months.map((month) => sumMoney(closed.flatMap((c) => (c.month === month && c.spent !== null ? [c.spent] : []))));
}
