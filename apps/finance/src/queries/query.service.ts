import { ForbiddenException } from '@nestjs/common';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { ListRequestsQuery } from '@ipms/contracts';
import { createLogger } from '@ipms/observability';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { inScope, notFound, type Actor } from '../common.js';
import { findDuplicates } from '../duplicates.js';
import { loadBalance } from '../ledger.js';
import { serializeDetail, serializeRequest } from '../serialize.js';
import { advanceSettlementDue } from '../settlement.js';
import { decisionContext } from './context.js';
import { requestFlags } from './flags.js';
import { listFacts } from './list-facts.js';
import { awaitingStatuses } from '../workflow.js';

const log = createLogger('finance');
const VIEW_ALL = 'finance_request.view_all';
const PROJECT_ONLY = { project: 'projectId', site: null } as const;

/** The requester's own move: a draft to send, or a request sent back to fix. */
const REQUESTER_ACTION = ['DRAFT', 'RETURNED'];

/** Requests waiting on [actor]: their own drafts and returns, or others' requests at a step they approve or pay. */
export function needsActionWhere(actor: Actor): Prisma.FinanceRequestWhereInput {
  const steps = actor.permissions.includes(VIEW_ALL) ? awaitingStatuses(actor.permissions) : [];
  return {
    OR: [
      { requesterId: actor.id, status: { in: REQUESTER_ACTION } },
      ...(steps.length > 0 ? [{ requesterId: { not: actor.id }, status: { in: steps } }] : []),
    ],
  };
}

const STAGE_STATUSES = { approval: ['PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE'], closed: ['PAID', 'SETTLED'] } as const;

/**
 * Reads. Visibility is the caller's own requests, or, with view_all, every
 * request in their project scope. Out of scope reads as "not found".
 */
export class QueryService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(actor: Actor, scope: AuthzScope, query: ListRequestsQuery) {
    const where = this.visibility(actor, scope, query.view);
    const filters: Prisma.FinanceRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
    };
    const extra: Prisma.FinanceRequestWhereInput[] = [];
    if (query.stage) extra.push({ status: { in: [...STAGE_STATUSES[query.stage]] } });
    if (query.q) {
      const has = { contains: query.q, mode: 'insensitive' as const };
      extra.push({ OR: [{ number: has }, { purpose: has }, { projectCode: has }, { projectName: has }] });
    }
    const full: Prisma.FinanceRequestWhereInput = { AND: [where, filters, ...extra] };
    const include = { category: { select: { code: true, name: true } } } as const;
    const skip = (query.page - 1) * query.limit;
    let items: Prisma.FinanceRequestGetPayload<{ include: typeof include }>[];
    let total: number;
    if (query.view === 'awaiting' || query.view === 'handled') {
      // The awaiting queue is read oldest-waiting first; a pending request changes only when it moves, so updatedAt is when it arrived.
      // The id breaks ties, so rows with the same timestamp keep one order from page to page.
      const orderBy: Prisma.FinanceRequestOrderByWithRelationInput[] = query.view === 'handled'
        ? [{ updatedAt: 'desc' }, { id: 'desc' }]
        : [{ updatedAt: 'asc' }, { id: 'asc' }];
      [items, total] = await Promise.all([
        this.prisma.financeRequest.findMany({ where: full, orderBy, skip, take: query.limit, include }),
        this.prisma.financeRequest.count({ where: full }),
      ]);
    } else {
      // Everything else: what waits on the caller first (their own returned or draft requests, or
      // others' requests at their step), then the rest; each part latest change first.
      const action = needsActionWhere(actor);
      const orderBy: Prisma.FinanceRequestOrderByWithRelationInput[] = [{ updatedAt: 'desc' }, { id: 'desc' }];
      const first: Prisma.FinanceRequestWhereInput = { AND: [full, action] };
      const rest: Prisma.FinanceRequestWhereInput = { AND: [full, { NOT: action }] };
      const [firstCount, restCount] = await Promise.all([
        this.prisma.financeRequest.count({ where: first }),
        this.prisma.financeRequest.count({ where: rest }),
      ]);
      total = firstCount + restCount;
      const fromFirst = Math.max(0, Math.min(query.limit, firstCount - skip));
      const [head, tail] = await Promise.all([
        fromFirst > 0 ? this.prisma.financeRequest.findMany({ where: first, orderBy, skip, take: fromFirst, include }) : Promise.resolve([]),
        fromFirst < query.limit
          ? this.prisma.financeRequest.findMany({ where: rest, orderBy, skip: Math.max(0, skip - firstCount), take: query.limit - fromFirst, include })
          : Promise.resolve([]),
      ]);
      items = [...head, ...tail];
    }
    const [facts, flags] = await Promise.all([
      listFacts(this.prisma, items),
      query.view === 'awaiting' ? requestFlags(this.prisma, items, scope, new Date()) : Promise.resolve(new Map<string, never[]>()),
    ]);
    return {
      items: items.map((row) => {
        const rowFlags = flags.get(row.id);
        return { ...serializeRequest(row), category: row.category, ...facts.get(row.id), ...(rowFlags ? { flags: rowFlags } : {}) };
      }),
      total, page: query.page, limit: query.limit,
    };
  }

  async get(id: string, actor: Actor, scope: AuthzScope, now = new Date()) {
    const row = await this.prisma.financeRequest.findUnique({
      where: { id },
      include: { invoices: true, actions: { orderBy: { at: 'asc' } }, payments: true, category: { select: { code: true, name: true } } },
    });
    if (!row || !this.mayRead(row, actor, scope)) throw notFound('Request');
    const bills = row.invoices.map((b) => ({ vendor: b.vendor, invoiceNumber: b.invoiceNumber, invoiceDate: b.invoiceDate, amount: b.amount.toFixed(2) }));
    // The context only helps an approver decide; if it cannot be built, the request still opens, without it.
    const [duplicates, context] = await Promise.all([
      findDuplicates(this.prisma, id, bills),
      decisionContext(this.prisma, row, actor, scope, now).catch((err: unknown) => {
        log.warn({ err, requestId: id }, 'decision context failed; returning the request without it');
        return null;
      }),
    ]);
    const detail = { ...serializeDetail(row), category: row.category, duplicates, ...(context ? { context } : {}) };
    if (row.kind !== 'ADVANCE' || row.status !== 'PAID') return detail;
    // The due day is a fact about the advance (paid day plus the window); whether it is overdue is for the reader's clock.
    return { ...detail, balance: await loadBalance(this.prisma, id), settlementDueOn: advanceSettlementDue(row, row.payments) };
  }

  /** An advance's balance and the settlements raised against it. */
  async advance(id: string, actor: Actor, scope: AuthzScope) {
    const advance = await this.prisma.financeRequest.findUnique({ where: { id }, include: { settlements: { orderBy: { createdAt: 'asc' } }, payments: true } });
    if (!advance || advance.kind !== 'ADVANCE' || !this.mayRead(advance, actor, scope)) throw notFound('Advance');
    return {
      advance: serializeRequest(advance),
      balance: advance.status === 'PAID' ? await loadBalance(this.prisma, id) : null,
      settlementDueOn: advanceSettlementDue(advance, advance.payments),
      settlements: advance.settlements.map(serializeRequest),
    };
  }

  private mayRead(row: { requesterId: string; projectId: string }, actor: Actor, scope: AuthzScope): boolean {
    if (row.requesterId === actor.id) return true;
    return actor.permissions.includes(VIEW_ALL) && inScope(scope, row.projectId);
  }

  private visibility(actor: Actor, scope: AuthzScope, view: ListRequestsQuery['view']): Prisma.FinanceRequestWhereInput {
    if (view === 'mine') return { requesterId: actor.id };
    const inProjects = scopeWhere(scope, PROJECT_ONLY) as Prisma.FinanceRequestWhereInput;
    if (view === 'all') {
      if (!actor.permissions.includes(VIEW_ALL)) throw new ForbiddenException(`This view needs the ${VIEW_ALL} permission`);
      return inProjects;
    }
    if (view === 'handled') {
      if (!actor.permissions.includes(VIEW_ALL)) return { id: { in: [] } };
      return { AND: [inProjects, { requesterId: { not: actor.id } }, { actions: { some: { actorId: actor.id, step: { not: 'REQUESTER' }, action: { not: 'REMINDED' } } } }] };
    }
    // 'awaiting' is a view over everyone's requests, so it needs view_all itself; without it the list is empty, not an error.
    if (!actor.permissions.includes(VIEW_ALL)) return { id: { in: [] } };
    const statuses = awaitingStatuses(actor.permissions);
    return { AND: [inProjects, { status: { in: statuses } }, { requesterId: { not: actor.id } }] };
  }
}
