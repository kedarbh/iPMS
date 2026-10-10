import { SUMMARY_WEEKS, TaskStatusSchema, weeklyCounts, type WorkOrderProjectSummary } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/qc';
import { OPEN, reachWhere, type WorkOrderScope } from './view.js';

const DAY_MS = 86_400_000;
/** First-time approval is measured over this many days. */
export const FIRST_TIME_DAYS = 90;

interface Tally { summary: WorkOrderProjectSummary; completions: Date[]; approved: Set<string> }

/**
 * Work orders per project, for the Director's portfolio: status counts,
 * overdue work, how much is approved first time, how long review is taking,
 * and completions per rolling week. Reads only what the caller may read.
 */
export async function summarizeWorkOrders(prisma: PrismaClient, scope: WorkOrderScope, now = new Date()): Promise<WorkOrderProjectSummary[]> {
  const reach: Prisma.WorkOrderWhereInput = { AND: reachWhere(scope) };
  const since90 = new Date(now.getTime() - FIRST_TIME_DAYS * DAY_MS);
  const sinceWeeks = new Date(now.getTime() - SUMMARY_WEEKS * 7 * DAY_MS);

  const [statuses, overdue, approvals, reviewing, completed] = await Promise.all([
    prisma.workOrder.groupBy({ by: ['projectId', 'status'], where: reach, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ['projectId'], where: { AND: [reach, { status: { in: OPEN } }, { plannedCompletionAt: { lt: now } }] }, _count: { _all: true } }),
    prisma.workOrderEvent.findMany({
      where: { kind: 'APPROVED', at: { gte: since90 }, workOrder: reach },
      select: { workOrderId: true, workOrder: { select: { projectId: true, events: { where: { kind: 'REJECTED' }, select: { id: true }, take: 1 } } } },
    }),
    prisma.workOrder.findMany({
      where: { AND: [reach, { status: 'REVIEWING' }] },
      select: { projectId: true, events: { where: { kind: 'SUBMITTED' }, orderBy: { at: 'desc' }, take: 1, select: { at: true } } },
    }),
    prisma.workOrder.findMany({
      where: { AND: [reach, { status: 'COMPLETED' }, { actualCompletionAt: { gte: sinceWeeks } }] },
      select: { projectId: true, actualCompletionAt: true },
    }),
  ]);

  const tallies = new Map<string, Tally>();
  const of = (projectId: string): Tally => {
    let tally = tallies.get(projectId);
    if (!tally) {
      tally = {
        summary: {
          projectId, byStatus: Object.fromEntries(TaskStatusSchema.options.map((status) => [status, 0])), overdue: 0,
          approved90: 0, firstTime90: 0, reviewing: { count: 0, oldestSubmittedAt: null }, completedByWeek: [],
        },
        completions: [],
        approved: new Set(),
      };
      tallies.set(projectId, tally);
    }
    return tally;
  };

  for (const row of statuses) of(row.projectId).summary.byStatus[row.status] = row._count._all;
  for (const row of overdue) of(row.projectId).summary.overdue = row._count._all;
  for (const event of approvals) {
    const tally = of(event.workOrder.projectId);
    if (tally.approved.has(event.workOrderId)) continue;
    tally.approved.add(event.workOrderId);
    tally.summary.approved90 += 1;
    if (event.workOrder.events.length === 0) tally.summary.firstTime90 += 1;
  }
  for (const order of reviewing) {
    const { summary } = of(order.projectId);
    summary.reviewing.count += 1;
    const submitted = order.events[0]?.at.toISOString() ?? null;
    if (submitted && (!summary.reviewing.oldestSubmittedAt || submitted < summary.reviewing.oldestSubmittedAt)) summary.reviewing.oldestSubmittedAt = submitted;
  }
  for (const order of completed) if (order.actualCompletionAt) of(order.projectId).completions.push(order.actualCompletionAt);

  return [...tallies.values()]
    .map(({ summary, completions }) => ({ ...summary, completedByWeek: weeklyCounts(completions, now, SUMMARY_WEEKS) }))
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
}
