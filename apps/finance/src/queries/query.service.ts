import { ForbiddenException } from '@nestjs/common';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { ListRequestsQuery } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { inScope, notFound, type Actor } from '../common.js';
import { findDuplicates } from '../duplicates.js';
import { loadBalance } from '../ledger.js';
import { serializeDetail, serializeRequest } from '../serialize.js';
import { advanceSettlementDue } from '../settlement.js';
import { listFacts } from './list-facts.js';
import { awaitingStatuses } from '../workflow.js';

const VIEW_ALL = 'finance_request.view_all';
const PROJECT_ONLY = { project: 'projectId', site: null } as const;

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
    const full: Prisma.FinanceRequestWhereInput = { AND: [where, filters] };
    const [items, total] = await Promise.all([
      this.prisma.financeRequest.findMany({
        where: full, orderBy: query.view === 'handled' ? { updatedAt: 'desc' } : { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit,
        include: { category: { select: { code: true, name: true } } },
      }),
      this.prisma.financeRequest.count({ where: full }),
    ]);
    const facts = await listFacts(this.prisma, items);
    return { items: items.map((row) => ({ ...serializeRequest(row), category: row.category, ...facts.get(row.id) })), total, page: query.page, limit: query.limit };
  }

  async get(id: string, actor: Actor, scope: AuthzScope) {
    const row = await this.prisma.financeRequest.findUnique({
      where: { id },
      include: { invoices: true, actions: { orderBy: { at: 'asc' } }, payments: true, category: { select: { code: true, name: true } } },
    });
    if (!row || !this.mayRead(row, actor, scope)) throw notFound('Request');
    const bills = row.invoices.map((b) => ({ vendor: b.vendor, invoiceNumber: b.invoiceNumber, invoiceDate: b.invoiceDate, amount: b.amount.toFixed(2) }));
    const detail = { ...serializeDetail(row), category: row.category, duplicates: await findDuplicates(this.prisma, id, bills) };
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
