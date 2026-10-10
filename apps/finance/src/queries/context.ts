import type { AuthzScope } from '@ipms/authz';
import { recentMonths, type DecisionContext } from '@ipms/contracts';
import type { PrismaClient } from '@prisma-clients/finance';
import type { Actor } from '../common.js';
import { fromMinor, sumMoney, toMinor } from '../money.js';
import { STEP_PERMISSION, stepOf } from '../workflow.js';
import { loadOpenAdvances } from './advances.js';
import { requestFlags, standingOf, type FlaggedRow } from './flags.js';
import { categoryNorms, normKey } from './norms.js';
import { loadClosed, spendByMonth } from './spend.js';

/**
 * What an approver should weigh before deciding: what the requester already
 * holds, what requests like this usually come to, and how the project's
 * spend is running. Only for the approver at the request's current step;
 * null for anyone else, the requester included.
 */
export async function decisionContext(
  prisma: PrismaClient, row: FlaggedRow & { projectId: string }, actor: Actor, scope: AuthzScope, now: Date,
): Promise<DecisionContext | null> {
  const step = stepOf(row.status);
  if (step === null || row.requesterId === actor.id || !actor.permissions.includes(STEP_PERMISSION[step])) return null;

  const months = recentMonths(now, 4);
  const since = new Date(`${months[0]!}-01T00:00:00+05:45`);
  const [open, norms, closed, flags] = await Promise.all([
    loadOpenAdvances(prisma, scope, now, [row.requesterId]),
    categoryNorms(prisma, scope, [{ kind: row.kind, categoryId: row.categoryId }], now),
    loadClosed(prisma, { projectId: row.projectId }, since),
    requestFlags(prisma, [row], scope, now),
  ]);
  const spend = spendByMonth(closed, months);
  return {
    requester: standingOf(row, open),
    category: norms.get(normKey(row.kind, row.categoryId)) ?? null,
    project: { thisMonth: spend[3] ?? '0.00', average3: fromMinor(toMinor(sumMoney(spend.slice(0, 3))) / 3n) },
    flags: flags.get(row.id) ?? [],
  };
}
