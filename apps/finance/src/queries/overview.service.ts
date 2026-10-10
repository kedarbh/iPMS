import { ForbiddenException } from '@nestjs/common';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { recentMonths, type FinanceOverview, type PendingStatus, type ProjectMoney, type RequestKind } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import type { Actor } from '../common.js';
import { compareMoney, subMoney, sumMoney } from '../money.js';
import { PENDING_STATUSES, awaitingStatuses } from '../workflow.js';
import { loadOpenAdvances } from './advances.js';
import { requestFlags } from './flags.js';
import { loadClosed, spendByMonth } from './spend.js';

const VIEW_ALL = 'finance_request.view_all';
const DAY_MS = 86_400_000;
export const OVERVIEW_MONTHS = 6;
export const QUEUE_SIZE = 5;
export const TOP_HOLDERS = 5;
export const DECISION_WINDOW_DAYS = 30;

type Money = { toFixed(digits: number): string };
const amountOf = (r: { approvedAmount: Money | null; requestedAmount: Money }): string => (r.approvedAmount ?? r.requestedAmount).toFixed(2);

/** The middle value, to one decimal; null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

/**
 * An approver's money at a glance: where requests stand, what waits on them,
 * what each project has spent and still has out, and what they decided.
 * Everything is in the caller's project scope.
 */
export class OverviewService {
  constructor(private readonly prisma: PrismaClient) {}

  async overview(actor: Actor, scope: AuthzScope, now = new Date()): Promise<FinanceOverview> {
    if (!actor.permissions.includes(VIEW_ALL)) throw new ForbiddenException(`The overview needs the ${VIEW_ALL} permission`);
    const inProjects = scopeWhere(scope, { project: 'projectId', site: null }) as Prisma.FinanceRequestWhereInput;
    const mine = new Set<string>(awaitingStatuses(actor.permissions));
    const months = recentMonths(now, OVERVIEW_MONTHS);
    const thisMonth = months[months.length - 1]!;

    const [pending, closed, open, decided] = await Promise.all([
      this.prisma.financeRequest.findMany({
        where: { AND: [inProjects, { status: { in: [...PENDING_STATUSES] } }] },
        include: { category: { select: { name: true } } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      }),
      loadClosed(this.prisma, inProjects),
      loadOpenAdvances(this.prisma, scope, now),
      this.prisma.approvalAction.findMany({
        where: {
          actorId: actor.id, step: { not: 'REQUESTER' }, action: { in: ['APPROVED', 'RETURNED', 'REJECTED'] },
          at: { gte: new Date(now.getTime() - DECISION_WINDOW_DAYS * DAY_MS) }, request: inProjects,
        },
        select: { requestId: true, revision: true, action: true, amount: true, at: true, request: { select: { requestedAmount: true } } },
      }),
    ]);

    // The caller's own requests are left out of their own steps, as they are from the queue.
    const visible = pending.filter((r) => !(mine.has(r.status) && r.requesterId === actor.id));
    const steps = PENDING_STATUSES.map((status) => {
      const here = visible.filter((r) => r.status === status);
      return { status, count: here.length, amount: sumMoney(here.map(amountOf)), oldestSince: here[0]?.updatedAt.toISOString() ?? null, mine: mine.has(status) };
    });

    const queueRows = visible.filter((r) => mine.has(r.status)).slice(0, QUEUE_SIZE);
    const flags = await requestFlags(this.prisma, queueRows, scope, now);
    const queue = queueRows.map((r) => ({
      id: r.id, number: r.number, kind: r.kind as RequestKind, status: r.status as PendingStatus,
      projectId: r.projectId, projectCode: r.projectCode, projectName: r.projectName,
      requesterId: r.requesterId, purpose: r.purpose, category: r.category.name,
      amount: amountOf(r), waitingSince: r.updatedAt.toISOString(), flags: flags.get(r.id) ?? [],
    }));

    const projects = new Map<string, ProjectMoney>();
    for (const p of [...closed, ...open]) {
      if (!projects.has(p.projectId)) {
        projects.set(p.projectId, { projectId: p.projectId, code: p.projectCode, name: p.projectName, spentToDate: '0.00', spentByMonth: [], cashHeld: '0.00', overdueSettlements: { count: 0, amount: '0.00' } });
      }
    }
    for (const entry of projects.values()) {
      const own = closed.filter((c) => c.projectId === entry.projectId);
      entry.spentToDate = sumMoney(own.flatMap((c) => (c.spent === null ? [] : [c.spent])));
      entry.spentByMonth = spendByMonth(own, months);
      const held = open.filter((a) => a.projectId === entry.projectId);
      entry.cashHeld = sumMoney(held.map((a) => a.outstanding));
      const late = held.filter((a) => a.overdue);
      entry.overdueSettlements = { count: late.length, amount: sumMoney(late.map((a) => a.outstanding)) };
    }

    const closedThisMonth = closed.filter((c) => c.month === thisMonth);
    const byCategory = new Map<string, { name: string; amounts: string[] }>();
    for (const c of closedThisMonth) {
      if (c.spent === null) continue;
      const entry = byCategory.get(c.categoryId) ?? { name: c.category, amounts: [] };
      entry.amounts.push(c.spent);
      byCategory.set(c.categoryId, entry);
    }

    const holders = new Map<string, { outstanding: string[]; open: number; overdue: number }>();
    for (const a of open) {
      if (a.requesterId === actor.id) continue;
      const h = holders.get(a.requesterId) ?? { outstanding: [], open: 0, overdue: 0 };
      h.outstanding.push(a.outstanding);
      h.open += 1;
      if (a.overdue) h.overdue += 1;
      holders.set(a.requesterId, h);
    }

    return {
      months,
      pipeline: { steps, paidThisMonth: { count: closedThisMonth.length, amount: sumMoney(closedThisMonth.map((c) => c.paidOut)) } },
      queue,
      projects: [...projects.values()].sort((a, b) => compareMoney(b.spentToDate, a.spentToDate) || a.code.localeCompare(b.code)),
      categories: [...byCategory.entries()]
        .map(([categoryId, { name, amounts }]) => ({ categoryId, name, amount: sumMoney(amounts) }))
        .sort((a, b) => compareMoney(b.amount, a.amount)),
      cashHolders: [...holders.entries()]
        .map(([requesterId, h]) => ({ requesterId, outstanding: sumMoney(h.outstanding), open: h.open, overdue: h.overdue }))
        .sort((a, b) => compareMoney(b.outstanding, a.outstanding))
        .slice(0, TOP_HOLDERS),
      decisions: await this.decisions(decided),
    };
  }

  /**
   * The caller's decisions. A request reached their step at the action that
   * moved it there in the same revision: the requester's submission or the
   * previous step's approval, whichever came last before the decision.
   */
  private async decisions(decided: { requestId: string; revision: number; action: string; amount: Money | null; at: Date; request: { requestedAmount: Money } }[]): Promise<FinanceOverview['decisions']> {
    const approved = decided.filter((d) => d.action === 'APPROVED');
    const trimmed = approved.flatMap((d) => {
      if (d.amount === null) return [];
      const asked = d.request.requestedAmount.toFixed(2);
      const given = d.amount.toFixed(2);
      return compareMoney(given, asked) < 0 ? [subMoney(asked, given)] : [];
    });
    const arrivals = decided.length === 0 ? [] : await this.prisma.approvalAction.findMany({
      where: { requestId: { in: [...new Set(decided.map((d) => d.requestId))] }, action: { in: ['SUBMITTED', 'APPROVED'] } },
      select: { requestId: true, revision: true, at: true },
    });
    const hours = decided.flatMap((d) => {
      const before = arrivals.filter((a) => a.requestId === d.requestId && a.revision === d.revision && a.at.getTime() < d.at.getTime());
      if (before.length === 0) return [];
      return [(d.at.getTime() - Math.max(...before.map((a) => a.at.getTime()))) / 3_600_000];
    });
    return {
      approved: { count: approved.length, amount: sumMoney(approved.map((d) => (d.amount ?? d.request.requestedAmount).toFixed(2))) },
      trimmed: { count: trimmed.length, saved: sumMoney(trimmed) },
      returned: decided.filter((d) => d.action === 'RETURNED').length,
      rejected: decided.filter((d) => d.action === 'REJECTED').length,
      medianHoursToDecide: median(hours),
    };
  }
}
