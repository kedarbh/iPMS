import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { fromMinor, toMinor } from '../money.js';

export const NORM_WINDOW_DAYS = 180;
export const NORM_MIN_SAMPLES = 5;
const DAY_MS = 86_400_000;

export interface CategoryNorm { median: string; p25: string; p75: string; samples: number }

export const normKey = (kind: string, categoryId: string): string => `${kind}:${categoryId}`;

/** The nearest-rank quantile of amounts already sorted ascending. */
export function quantile(sorted: readonly bigint[], q: number): bigint {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0n;
}

/** The spread of a sample of amounts; null below the minimum sample size. */
export function normOf(amounts: readonly string[]): CategoryNorm | null {
  if (amounts.length < NORM_MIN_SAMPLES) return null;
  const sorted = amounts.map((a) => toMinor(a)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { median: fromMinor(quantile(sorted, 0.5)), p25: fromMinor(quantile(sorted, 0.25)), p75: fromMinor(quantile(sorted, 0.75)), samples: sorted.length };
}

/**
 * What requests of each kind and category usually come to: the approved
 * amounts of those Finance closed in the last 180 days, in the caller's scope.
 * Keyed by normKey; a key is absent when there are too few to compare.
 */
export async function categoryNorms(
  prisma: PrismaClient, scope: AuthzScope, keys: readonly { kind: string; categoryId: string }[], now: Date,
): Promise<Map<string, CategoryNorm>> {
  const wanted = [...new Map(keys.map((k) => [normKey(k.kind, k.categoryId), k])).values()];
  if (wanted.length === 0) return new Map();
  const since = new Date(now.getTime() - NORM_WINDOW_DAYS * DAY_MS);
  const rows = await prisma.financeRequest.findMany({
    where: {
      AND: [
        scopeWhere(scope, { project: 'projectId', site: null }) as Prisma.FinanceRequestWhereInput,
        { OR: wanted.map((k) => ({ kind: k.kind, categoryId: k.categoryId })) },
        { actions: { some: { step: 'FINANCE', action: 'PAID', at: { gte: since } } } },
      ],
    },
    select: { kind: true, categoryId: true, approvedAmount: true },
  });
  const samples = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.approvedAmount) continue;
    const key = normKey(row.kind, row.categoryId);
    samples.set(key, [...(samples.get(key) ?? []), row.approvedAmount.toFixed(2)]);
  }
  const norms = new Map<string, CategoryNorm>();
  for (const [key, amounts] of samples) {
    const norm = normOf(amounts);
    if (norm) norms.set(key, norm);
  }
  return norms;
}
