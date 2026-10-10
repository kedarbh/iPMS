import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { RequestFlag } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { findDuplicates, type DuplicateHit } from '../duplicates.js';
import { sumMoney, toMinor } from '../money.js';
import { isPending } from '../workflow.js';
import { loadOpenAdvances, type OpenAdvance } from './advances.js';
import { categoryNorms, normKey } from './norms.js';

export const WAITING_LONG_DAYS = 3;
export const UNUSUAL_RATIO = 2;
const DAY_MS = 86_400_000;

type Money = { toFixed(digits: number): string };

/** The fields a flag is computed from; a Prisma row with its category satisfies it. */
export interface FlaggedRow {
  id: string; kind: string; status: string; categoryId: string; requesterId: string; advanceId: string | null;
  requestedAmount: Money; approvedAmount: Money | null; updatedAt: Date; category: { name: string };
}

/** What the requester still holds, leaving out this request and the advance a settlement settles. */
export function standingOf(row: Pick<FlaggedRow, 'id' | 'requesterId' | 'advanceId'>, open: readonly OpenAdvance[]) {
  const held = open.filter((a) => a.requesterId === row.requesterId && a.id !== row.id && a.id !== row.advanceId);
  const overdue = held.filter((a) => a.overdue);
  return {
    openAdvances: held.length,
    outstanding: sumMoney(held.map((a) => a.outstanding)),
    overdue: overdue.length,
    oldestOverdueDays: overdue.length > 0 ? Math.max(...overdue.map((a) => a.daysOverdue)) : null,
  };
}

/**
 * Warnings for requests waiting on an approver: a bill that may already have
 * been claimed, a requester already holding unsettled cash, an amount well
 * above the usual for its kind and category, and a long wait at the current
 * step. Only pending rows are flagged, and everything counted is in the
 * caller's scope, so a flag reveals nothing the caller could not open.
 */
export async function requestFlags(prisma: PrismaClient, rows: readonly FlaggedRow[], scope: AuthzScope, now: Date): Promise<Map<string, RequestFlag[]>> {
  const pending = rows.filter((r) => isPending(r.status));
  const flags = new Map<string, RequestFlag[]>();
  if (pending.length === 0) return flags;

  const withBills = pending.filter((r) => r.kind !== 'ADVANCE');
  const [open, norms, bills] = await Promise.all([
    loadOpenAdvances(prisma, scope, now, [...new Set(pending.map((r) => r.requesterId))]),
    categoryNorms(prisma, scope, pending.map((r) => ({ kind: r.kind, categoryId: r.categoryId })), now),
    withBills.length === 0 ? Promise.resolve([]) : prisma.requestInvoice.findMany({
      where: { requestId: { in: withBills.map((r) => r.id) } },
      select: { requestId: true, vendor: true, invoiceNumber: true, invoiceDate: true, amount: true },
    }),
  ]);

  // findDuplicates looks at anyone's requests; keep only matches the caller could open.
  const found = new Map<string, DuplicateHit[]>(await Promise.all(withBills.map(async (row) => {
    const mine = bills.filter((b) => b.requestId === row.id).map((b) => ({ vendor: b.vendor, invoiceNumber: b.invoiceNumber, invoiceDate: b.invoiceDate, amount: b.amount.toFixed(2) }));
    return [row.id, (await findDuplicates(prisma, row.id, mine)).filter((h) => h.reason !== 'NUMBER_OTHER_YEAR')] as const;
  })));
  const hitIds = [...new Set([...found.values()].flat().map((h) => h.requestId))];
  const visible = new Set(hitIds.length === 0 ? [] : (await prisma.financeRequest.findMany({
    where: { AND: [{ id: { in: hitIds } }, scopeWhere(scope, { project: 'projectId', site: null }) as Prisma.FinanceRequestWhereInput] },
    select: { id: true },
  })).map((r) => r.id));

  for (const row of pending) {
    const list: RequestFlag[] = [];

    const hits = (found.get(row.id) ?? []).filter((h) => visible.has(h.requestId));
    if (hits.length > 0) {
      list.push({ code: 'DUPLICATE_BILL', tone: 'red', matches: [...new Map(hits.map((h) => [h.requestId, { requestId: h.requestId, number: h.number }])).values()] });
    }

    const standing = standingOf(row, open);
    if (standing.openAdvances > 0) {
      list.push({ code: 'REQUESTER_HOLDS_CASH', tone: standing.overdue > 0 ? 'red' : 'amber', outstanding: standing.outstanding, advances: standing.openAdvances, overdue: standing.overdue, oldestOverdueDays: standing.oldestOverdueDays });
    }

    const amount = (row.approvedAmount ?? row.requestedAmount).toFixed(2);
    const norm = norms.get(normKey(row.kind, row.categoryId));
    if (norm && toMinor(norm.median) > 0n && toMinor(amount) > BigInt(UNUSUAL_RATIO) * toMinor(norm.median)) {
      list.push({ code: 'UNUSUAL_AMOUNT', tone: 'amber', ratio: Math.round((Number(amount) / Number(norm.median)) * 10) / 10, median: norm.median, category: row.category.name });
    }

    const days = Math.floor((now.getTime() - row.updatedAt.getTime()) / DAY_MS);
    if (days > WAITING_LONG_DAYS) list.push({ code: 'WAITING_LONG', tone: 'amber', days });

    flags.set(row.id, list);
  }
  return flags;
}
