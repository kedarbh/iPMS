import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma-clients/qc';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { SUBJECTS, type QcWorkOrderCancelled } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord } from '@ipms/persistence';
import {
  TaskStatusSchema, WORK_ORDER_TEMPLATE_CATEGORY, WORK_ORDER_TYPE_LABEL, uuidv7, workOrderTitle,
  type AssignableUser, type CancelWorkOrderDto, type CreateWorkOrdersDto, type ListWorkOrdersQueryDto,
  type UpdateWorkOrderDto, type WorkOrderBrief, type WorkOrderEventKind, type WorkOrderStatusCounts, type WorkOrderType,
} from '@ipms/contracts';
import { asJson, recordAudit } from '../templates/audit.js';
import type { TemplateQueries } from '../templates/template.queries.js';
import { required, type ProjectDirectoryClient } from './project-directory.client.js';
import { OPEN, CLOSED, reachWhere, toView, type WorkOrderRow, type WorkOrderScope } from './view.js';
import { summarizeWorkOrders } from './work-order-summary.js';

export type { WorkOrderScope } from './view.js';

const CATEGORY_LABEL: Record<string, string> = { QUALITY: 'Quality', EHS: 'EHS', OTHER: 'Other' };

type Tx = Prisma.TransactionClient;

/**
 * Work orders: a checklist template assigned to one site of a project.
 *
 * qc owns them, and moves their status itself when a submission or review
 * lands. Project owns the sites and who can see them, so creating one, and
 * every read, asks project with the caller's own token: which sites exist,
 * what the caller's scope is, and whether the assignee can reach the sites.
 */
@Injectable()
export class WorkOrderService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly templates: TemplateQueries,
    private readonly projects: ProjectDirectoryClient,
  ) {}

  /** One work order per site, all or none. */
  async create(dto: CreateWorkOrdersDto, actorId: string, bearer: string) {
    const refs = required(await this.projects.siteRefs(dto.projectId, dto.siteIds, bearer), 'Project');
    if (refs.sites.length !== dto.siteIds.length) throw new BadRequestException('Every site must belong to this project');

    const template = await this.templates.reference(dto.templateId);
    // 400 rather than 404: the work order is what was requested, and its template is a bad field in it.
    if (!template) throw new BadRequestException('The selected checklist template does not exist');
    if (template.disabled) throw new ConflictException(`The checklist "${template.name}" has been disabled`);
    if (template.publishedVersion === null) throw new ConflictException(`The checklist "${template.name}" has not been published yet`);
    const needed = WORK_ORDER_TEMPLATE_CATEGORY[dto.workOrderType];
    if (template.category !== needed) {
      throw new BadRequestException(
        `A ${WORK_ORDER_TYPE_LABEL[dto.workOrderType]} needs a ${CATEGORY_LABEL[needed]} checklist; "${template.name}" is ${CATEGORY_LABEL[template.category] ?? template.category}`,
      );
    }
    // Ordered as the caller listed the sites, so refusals and the response read back in that order.
    const bySite = new Map(refs.sites.map((site) => [site.id, site]));
    const sites = dto.siteIds.map((id) => bySite.get(id)!);
    await this.requireReach(dto.assigneeId, dto.projectId, sites, bearer);

    const now = new Date();
    const rows = sites.map((site) => ({
      id: uuidv7(),
      projectId: refs.project.id, projectCode: refs.project.code, projectName: refs.project.name,
      siteId: site.id, siteCode: site.siteCode, siteName: site.name, siteCity: site.city, siteArea: site.area,
      templateId: template.id, templateName: template.name, workOrderType: dto.workOrderType,
      title: workOrderTitle(dto.workOrderType, site.siteCode, dto.note),
      status: 'NOT_STARTED', assigneeId: dto.assigneeId, plannedCompletionAt: dto.plannedCompletionAt,
      createdBy: actorId, createdAt: now,
    }));
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.workOrder.createMany({ data: rows });
      // One ledger entry per work order: each is its own accountable assignment.
      for (const row of rows) {
        await recordAudit(tx, {
          actorId, action: 'work_order.created', objectType: 'WorkOrder', objectId: row.id, previousState: {},
          newState: asJson({ projectId: row.projectId, siteId: row.siteId, templateId: template.id, workOrderType: dto.workOrderType, assigneeId: dto.assigneeId, plannedCompletionAt: dto.plannedCompletionAt, title: row.title }),
        });
      }
      await tx.workOrderEvent.createMany({
        data: rows.map((row) => ({
          id: uuidv7(), workOrderId: row.id, kind: 'CREATED', at: now, actorId,
          detail: { assigneeId: dto.assigneeId, plannedCompletionAt: dto.plannedCompletionAt.toISOString(), templateVersion: template.publishedVersion },
        })),
      });
      return tx.workOrder.findMany({ where: { id: { in: rows.map((row) => row.id) } } });
    });
    const order = new Map(rows.map((row, index) => [row.id, index]));
    return { created: created.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map(toView) };
  }

  /** Per-project work order counts for the Director's portfolio. */
  summary(scope: WorkOrderScope, now = new Date()) {
    return summarizeWorkOrders(this.prisma, scope, now);
  }

  /**
   * One page of work orders across every project the caller can see, with the
   * counts the filter pills show. The counts ignore the status and view
   * filters — every pill shows its own number whichever one is selected — but
   * honour the project, type, assignee and search, so they always describe
   * what those found.
   */
  async list(scope: WorkOrderScope, query: ListWorkOrdersQueryDto, now = new Date()) {
    const q = query.q || undefined;
    const contains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    // ANDed rather than spread: scopeWhere and the search both use an `OR` key.
    const base: Prisma.WorkOrderWhereInput = {
      AND: [
        ...reachWhere(scope),
        ...(query.workOrderType ? [{ workOrderType: query.workOrderType }] : []),
        ...(query.projectId ? [{ projectId: query.projectId }] : []),
        ...(query.assigneeId ? [{ assigneeId: query.assigneeId }] : []),
        ...(q ? [{ OR: [
          { title: contains(q) }, { templateName: contains(q) },
          { siteCode: contains(q) }, { siteName: contains(q) }, { projectCode: contains(q) },
        ] }] : []),
      ],
    };
    const overdue: Prisma.WorkOrderWhereInput = { status: { in: OPEN }, plannedCompletionAt: { lt: now } };
    const view: Prisma.WorkOrderWhereInput | null =
      query.view === 'open' ? { status: { in: OPEN } }
        : query.view === 'overdue' ? overdue
          : query.view === 'closed' ? { status: { in: CLOSED } }
            : null;
    const where: Prisma.WorkOrderWhereInput = { AND: [base, ...(query.status ? [{ status: query.status }] : []), ...(view ? [view] : [])] };

    // Open work is read by what is due next; closed work by what finished last.
    const closedOnly = query.view === 'closed' || (query.status !== undefined && CLOSED.includes(query.status));
    const openOnly = query.view === 'open' || query.view === 'overdue' || (query.status !== undefined && OPEN.includes(query.status));
    const orderBy: Prisma.WorkOrderOrderByWithRelationInput[] = closedOnly
      ? [{ actualCompletionAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
      : openOnly ? [{ plannedCompletionAt: 'asc' }, { id: 'desc' }]
        : [{ id: 'desc' }];

    const [items, total, grouped, overdueCount] = await Promise.all([
      this.prisma.workOrder.findMany({ where, orderBy, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.workOrder.count({ where }),
      this.prisma.workOrder.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.workOrder.count({ where: { AND: [base, overdue] } }),
    ]);
    const counts = Object.fromEntries([['ALL', 0], ['OVERDUE', overdueCount], ...TaskStatusSchema.options.map((status) => [status, 0])]) as WorkOrderStatusCounts;
    for (const row of grouped) {
      const status = row.status as keyof WorkOrderStatusCounts;
      if (status in counts) counts[status] = row._count._all;
      counts.ALL += row._count._all;
    }
    return { items: items.map(toView), total, page: query.page, limit: query.limit, counts };
  }

  /** Every work order of one project the caller can see, in brief — the project dashboard's input. */
  async brief(scope: WorkOrderScope, projectId: string): Promise<WorkOrderBrief[]> {
    const rows = await this.prisma.workOrder.findMany({
      where: { AND: [{ projectId }, ...reachWhere(scope)] },
      select: { id: true, siteId: true, siteCode: true, title: true, workOrderType: true, status: true, assigneeId: true, plannedCompletionAt: true },
      orderBy: [{ plannedCompletionAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({ ...row, workOrderType: row.workOrderType as WorkOrderType, status: row.status as WorkOrderBrief['status'] }));
  }

  async get(scope: WorkOrderScope, id: string) {
    const found = await this.prisma.workOrder.findFirst({
      where: { AND: [{ id }, ...reachWhere(scope)] },
      include: { events: { orderBy: [{ at: 'asc' }, { id: 'asc' }] } },
    });
    if (!found) throw new NotFoundException('Work order not found');
    return { ...toView(found), events: found.events };
  }

  /** Reassign and/or reschedule. Closed work orders are history and stay as they were. */
  async update(scope: AuthzScope, id: string, dto: UpdateWorkOrderDto, actorId: string, bearer: string) {
    const current = await this.requireOpen(scope, id);
    const reassign = dto.assigneeId !== undefined && dto.assigneeId !== current.assigneeId;
    const reschedule = dto.plannedCompletionAt !== undefined && dto.plannedCompletionAt.getTime() !== current.plannedCompletionAt.getTime();
    if (!reassign && !reschedule) return this.get(scope, id);
    if (reassign) await this.requireReach(dto.assigneeId!, current.projectId, [{ id: current.siteId, siteCode: current.siteCode }], bearer);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.workOrder.update({
        where: { id },
        data: { ...(reassign ? { assigneeId: dto.assigneeId! } : {}), ...(reschedule ? { plannedCompletionAt: dto.plannedCompletionAt! } : {}) },
      });
      await recordAudit(tx, {
        actorId, action: 'work_order.updated', objectType: 'WorkOrder', objectId: id,
        previousState: asJson({ ...(reassign ? { assigneeId: current.assigneeId } : {}), ...(reschedule ? { plannedCompletionAt: current.plannedCompletionAt } : {}) }),
        newState: asJson({ ...(reassign ? { assigneeId: dto.assigneeId } : {}), ...(reschedule ? { plannedCompletionAt: dto.plannedCompletionAt } : {}) }),
      });
      // The draft was the previous assignee's; the new one starts from the checklist. Its files stay with the work order.
      if (reassign) await tx.workOrderDraft.deleteMany({ where: { workOrderId: id } });
      if (reassign) await event(tx, id, 'REASSIGNED', now, actorId, { from: current.assigneeId, to: dto.assigneeId! });
      if (reschedule) {
        await event(tx, id, 'RESCHEDULED', now, actorId, { from: current.plannedCompletionAt.toISOString(), to: dto.plannedCompletionAt!.toISOString() });
      }
    });
    return this.get(scope, id);
  }

  async cancel(scope: AuthzScope, id: string, dto: CancelWorkOrderDto, actorId: string) {
    const current = await this.requireOpen(scope, id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Conditional, so a review landing between the check and the write is not overwritten.
      const changed = await tx.workOrder.updateMany({ where: { id, status: { in: OPEN } }, data: { status: 'CANCELLED', cancelReason: dto.reason } });
      if (changed.count === 0) throw new ConflictException('This work order has just been closed');
      await tx.workOrderDraft.deleteMany({ where: { workOrderId: id } });
      await recordAudit(tx, {
        actorId, action: 'work_order.cancelled', objectType: 'WorkOrder', objectId: id,
        previousState: { status: current.status }, newState: { status: 'CANCELLED', reason: dto.reason },
      });
      await event(tx, id, 'CANCELLED', now, actorId, { reason: dto.reason });
      const cancelled: QcWorkOrderCancelled = {
        workOrderId: id, projectId: current.projectId, siteId: current.siteId, cancelledAt: now.toISOString(),
      };
      await tx.outboxEvent.create({
        data: buildOutboxRecord(SUBJECTS.QC_WORK_ORDER_CANCELLED, { ...cancelled }, getCorrelationId() ?? 'unknown', actorId),
      });
    });
    return this.get(scope, id);
  }

  /** How many work orders a project, or one of its sites, still has — project refuses to delete either while any remain. */
  async usage(filter: { projectId?: string | undefined; siteId?: string | undefined }): Promise<{ count: number }> {
    if (!filter.projectId && !filter.siteId) throw new BadRequestException('Give a projectId or a siteId');
    const count = await this.prisma.workOrder.count({
      where: { ...(filter.projectId ? { projectId: filter.projectId } : {}), ...(filter.siteId ? { siteId: filter.siteId } : {}) },
    });
    return { count };
  }

  /**
   * The responsible person must be able to see every site they are given:
   * otherwise the work order lands on a list they cannot open. Checked against
   * project's replicated scope, the same one that decides what they can see.
   */
  private async requireReach(userId: string, projectId: string, sites: { id: string; siteCode: string }[], bearer: string): Promise<void> {
    const people = required(await this.projects.assignable(projectId, bearer), 'Project');
    const reach: AssignableUser | undefined = people.find((person) => person.userId === userId);
    const missing = sites.filter((site) => !reach || !(reach.wholeProject || reach.siteIds.includes(site.id)));
    if (missing.length > 0) {
      const codes = missing.slice(0, 5).map((site) => site.siteCode).join(', ');
      throw new BadRequestException(
        `The responsible person has no access to ${missing.length === 1 ? 'site' : 'sites'} ${codes}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}. Grant them access to the project or those sites first.`,
      );
    }
  }

  private async requireOpen(scope: AuthzScope, id: string): Promise<WorkOrderRow> {
    const found = await this.prisma.workOrder.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] } });
    if (!found) throw new NotFoundException('Work order not found');
    if (CLOSED.includes(found.status)) throw new ConflictException(`This work order is ${found.status === 'COMPLETED' ? 'completed' : 'cancelled'} and can no longer be changed`);
    return found;
  }
}

export async function event(tx: Tx, workOrderId: string, kind: WorkOrderEventKind, at: Date, actorId: string | null, detail: Prisma.InputJsonObject): Promise<void> {
  await tx.workOrderEvent.create({ data: { id: uuidv7(), workOrderId, kind, at, actorId, detail } });
}
