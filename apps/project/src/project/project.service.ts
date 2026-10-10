import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import { resolveGeofenceRadius, type GeofenceMode } from '@ipms/geo';
import type { AuthzScope } from '@ipms/authz';
import { projectScope, siteScope, visibleProject, visibleSite, visibleTask, visibleViaProject } from '../scope/project-scope.js';
import { scopeWhere } from '@ipms/authz';
import type { JsonObject } from '@ipms/persistence';
import { asJson, recordAudit, type AuditObject, type Tx } from '../outbox/audit.js';
import type { WorkOrderUsageClient } from './work-order-usage.client.js';
import { summarizePortfolio } from './portfolio.js';
import { uuidv7, type AssignableUser, type SiteRefs, type AssignTaskDto, type CreateMilestoneDto, type CreateProjectDto, type CreateSiteDto, type CreateTaskDto, type CreateTaskTypeDto, type ListTasksQueryDto, type UpdateMilestoneDto, type UpdateProjectDto, type UpdateSiteDto, type UpdateTaskDto, type UpdateTaskTypeDto } from '@ipms/contracts';

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaClient, private readonly workOrders: WorkOrderUsageClient) {}

  /**
   * Runs a mutation and its ledger entry in one transaction.
   *
   * Every mutating method goes through this or `auditedDelete`, so "was this
   * audited?" has one answer rather than seventeen. The atomicity is the point:
   * a ledger entry written outside the mutation's transaction can be lost while
   * the mutation survives, which is the one failure an append-only ledger must
   * not have.
   */
  private async audited<T extends { id: string }>(
    ctx: { actorId: string; action: string; objectType: AuditObject; previousState?: JsonObject; newState?: JsonObject },
    run: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const row = await run(tx);
      await recordAudit(tx, {
        actorId: ctx.actorId, action: ctx.action, objectType: ctx.objectType, objectId: row.id,
        previousState: ctx.previousState ?? {}, newState: ctx.newState ?? {},
      });
      return row;
    });
  }

  /** A delete returns no row, so the id and the pre-image are supplied by the caller. */
  private async auditedDelete(
    ctx: { actorId: string; action: string; objectType: AuditObject; objectId: string; previousState: JsonObject },
    run: (tx: Tx) => Promise<unknown>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await run(tx);
      await recordAudit(tx, { ...ctx, newState: {} });
    });
  }
  async listProjects(scope: AuthzScope) { return this.prisma.project.findMany({ where: projectScope(scope), orderBy: { updatedAt: 'desc' }, include: { _count: { select: { sites: true, tasks: true } } } }); }
  /**
   * The nested `sites` list is scoped as well as the project itself. Reaching a
   * project through a single site grant must not hand back every other site in
   * it -- without the inner filter, one site grant reads the whole project's
   * site list.
   */
  async getProject(scope: AuthzScope, id: string) {
    const project = await this.prisma.project.findFirst({
      where: visibleProject(scope, id),
      include: {
        sites: { where: siteScope(scope), include: { region: true }, orderBy: { siteCode: 'asc' } },
        taskTypes: { orderBy: { order: 'asc' } },
        milestones: { include: { requirements: true }, orderBy: { sequence: 'asc' } },
        _count: { select: { tasks: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }
  /** Ordered by id, which is a uuidv7 and therefore time-ordered — Task has no createdAt column. */
  async listTasks(scope: AuthzScope, projectId: string, query: ListTasksQueryDto) {
    await this.requireProject(scope, projectId);
    // The caller's own filters are ANDed with the scope fragment rather than
    // spread beside it: scopeWhere returns an `OR` key, and a sibling `OR` from
    // a future filter would collide and silently drop one of them.
    return this.prisma.task.findMany({
      where: {
        AND: [
          { projectId },
          scopeWhere(scope),
          ...(query.siteId ? [{ siteId: query.siteId }] : []),
          ...(query.status ? [{ status: query.status }] : []),
        ],
      },
      orderBy: { id: 'desc' },
    });
  }
  async createProject(dto: CreateProjectDto, actorId: string) {
    try {
      return await this.audited(
        { actorId, action: 'project.created', objectType: 'Project', newState: asJson(dto) },
        (tx) => tx.project.create({ data: { id: uuidv7(), code: dto.code, name: dto.name, clientName: dto.clientName ?? null, phase: dto.phase ?? null, startDate: dto.startDate ?? null, targetDate: dto.targetDate ?? null, defaultGeofenceRadiusM: dto.defaultGeofenceRadiusM === undefined ? 500 : dto.defaultGeofenceRadiusM, status: 'DRAFT' } }),
      );
    } catch (err) {
      // Narrow: only a unique violation on `code` means "already in use". A bare
      // catch reports a connection failure as a duplicate code.
      if ((err as { code?: string }).code === 'P2002') throw new BadRequestException('Project code is already in use');
      throw err;
    }
  }
  async updateProject(scope: AuthzScope, id: string, dto: UpdateProjectDto, actorId: string) {
    const project = await this.requireProject(scope, id);
    return this.audited(
      {
        actorId, action: 'project.updated', objectType: 'Project',
        previousState: asJson({ code: project.code, name: project.name, status: project.status }),
        newState: asJson(dto),
      },
      (tx) => tx.project.update({ where: { id }, data: { ...(dto.name === undefined ? {} : { name: dto.name }), ...(dto.clientName === undefined ? {} : { clientName: dto.clientName }), ...(dto.phase === undefined ? {} : { phase: dto.phase }), ...(dto.startDate === undefined ? {} : { startDate: dto.startDate }), ...(dto.targetDate === undefined ? {} : { targetDate: dto.targetDate }), ...(dto.defaultGeofenceRadiusM === undefined ? {} : { defaultGeofenceRadiusM: dto.defaultGeofenceRadiusM }), ...(dto.status === undefined ? {} : { status: dto.status }) } }),
    );
  }
  async createSite(scope: AuthzScope, projectId: string, dto: CreateSiteDto, actorId: string) {
    await this.requireProject(scope, projectId);

    // The region upsert stays outside the audited transaction on purpose: it is
    // a lookup-or-create of a shared row, not part of the accountable act, and
    // holding it inside would widen the transaction for every site created.
    let regionId: string | null = null;
    if (dto.regionName) {
      const region = await this.prisma.region.upsert({
        where: { projectId_name: { projectId, name: dto.regionName } },
        update: {},
        create: { id: uuidv7(), projectId, name: dto.regionName },
      });
      regionId = region.id;
    }

    try {
      return await this.audited(
        { actorId, action: 'site.created', objectType: 'Site', newState: asJson({ projectId, ...dto }) },
        (tx) => tx.site.create({ data: { id: uuidv7(), projectId, regionId, siteCode: dto.siteCode, name: dto.name, latitude: dto.latitude ?? null, longitude: dto.longitude ?? null, geofenceMode: dto.geofenceMode, geofenceRadiusM: dto.geofenceRadiusM ?? null, address: dto.address ?? null, city: dto.city ?? null, area: dto.area ?? null, scopeVariant: dto.scopeVariant ?? null } }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new BadRequestException('Site code is already in use in this project');
      throw err;
    }
  }
  async createTaskType(scope: AuthzScope, projectId: string, dto: CreateTaskTypeDto, actorId: string) {
    await this.requireProject(scope, projectId);
    try {
      return await this.audited(
        { actorId, action: 'task_type.created', objectType: 'TaskType', newState: asJson({ projectId, ...dto }) },
        (tx) => tx.taskType.create({ data: { id: uuidv7(), projectId, code: dto.code, name: dto.name, category: dto.category, templateId: dto.templateId ?? null, order: dto.order ?? 0 } }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new BadRequestException('Task type code is already in use in this project');
      throw err;
    }
  }
  async createMilestone(scope: AuthzScope, projectId: string, dto: CreateMilestoneDto, actorId: string) {
    await this.requireProject(scope, projectId);
    const types = dto.taskTypeIds.length
      ? await this.prisma.taskType.count({ where: { id: { in: dto.taskTypeIds }, projectId } })
      : 0;
    if (types !== dto.taskTypeIds.length) throw new BadRequestException('Every required task type must belong to this project');

    try {
      return await this.audited(
        { actorId, action: 'milestone.created', objectType: 'Milestone', newState: asJson({ projectId, ...dto }) },
        async (tx) => {
          const milestone = await tx.milestone.create({ data: { id: uuidv7(), projectId, code: dto.code, name: dto.name, kind: dto.kind, sequence: dto.sequence, targetDate: dto.targetDate ?? null } });
          if (dto.taskTypeIds.length) {
            await tx.milestoneRequirement.createMany({ data: dto.taskTypeIds.map((taskTypeId) => ({ milestoneId: milestone.id, taskTypeId })) });
          }
          return milestone;
        },
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if ((error as { code?: string }).code === 'P2002') throw new BadRequestException('Milestone code is already in use in this project');
      throw error;
    }
  }
  async createTask(scope: AuthzScope, projectId: string, dto: CreateTaskDto, actorId: string) {
    await this.requireProject(scope, projectId);
    const [site, taskType] = await Promise.all([
      this.prisma.site.findFirst({ where: { AND: [{ id: dto.siteId, projectId }, siteScope(scope)] } }),
      this.prisma.taskType.findFirst({ where: { id: dto.taskTypeId, projectId } }),
    ]);
    if (!site || !taskType) throw new BadRequestException('Site and task type must belong to this project');
    if (dto.origin === 'PLANNED') {
      const existing = await this.prisma.task.findFirst({ where: { siteId: dto.siteId, taskTypeId: dto.taskTypeId, origin: 'PLANNED' } });
      if (existing) throw new BadRequestException('A planned task already exists for this site and task type');
    }
    return this.audited(
      { actorId, action: 'task.created', objectType: 'Task', newState: asJson({ projectId, ...dto }) },
      (tx) => tx.task.create({ data: { id: uuidv7(), projectId, siteId: dto.siteId, taskTypeId: dto.taskTypeId, title: dto.title, origin: dto.origin, assigneeId: dto.assigneeId ?? null, plannedCompletionAt: dto.plannedCompletionAt ?? null, createdBy: actorId, templateId: dto.templateId ?? taskType.templateId } }),
    );
  }
  async assignTask(scope: AuthzScope, id: string, dto: AssignTaskDto, actorId: string) {
    const task = await this.requireTask(scope, id);
    return this.audited(
      {
        actorId, action: 'task.assigned', objectType: 'Task',
        previousState: asJson({ assigneeId: task.assigneeId }),
        newState: asJson({ assigneeId: dto.assigneeId }),
      },
      (tx) => tx.task.update({ where: { id }, data: { assigneeId: dto.assigneeId } }),
    );
  }
  async updateSite(scope: AuthzScope, id: string, dto: UpdateSiteDto, actorId: string) {
    const site = await this.requireSite(scope, id);

    // Outside the audited transaction, as in createSite: a shared lookup-or-create,
    // not part of the accountable act.
    let regionId: string | null | undefined;
    if (dto.regionName === null) {
      regionId = null;
    } else if (dto.regionName) {
      const region = await this.prisma.region.upsert({
        where: { projectId_name: { projectId: site.projectId, name: dto.regionName } },
        update: {},
        create: { id: uuidv7(), projectId: site.projectId, name: dto.regionName },
      });
      regionId = region.id;
    }

    const data = { ...(dto.siteCode === undefined ? {} : { siteCode: dto.siteCode }), ...(dto.name === undefined ? {} : { name: dto.name }), ...(dto.latitude === undefined ? {} : { latitude: dto.latitude }), ...(dto.longitude === undefined ? {} : { longitude: dto.longitude }), ...(dto.geofenceMode === undefined ? {} : { geofenceMode: dto.geofenceMode }), ...(dto.geofenceRadiusM === undefined ? {} : { geofenceRadiusM: dto.geofenceRadiusM }), ...(dto.address === undefined ? {} : { address: dto.address }), ...(dto.city === undefined ? {} : { city: dto.city }), ...(dto.area === undefined ? {} : { area: dto.area }), ...(dto.scopeVariant === undefined ? {} : { scopeVariant: dto.scopeVariant }), ...(dto.status === undefined ? {} : { status: dto.status }), ...(regionId === undefined ? {} : { regionId }) };

    try {
      return await this.audited(
        {
          actorId, action: 'site.updated', objectType: 'Site',
          previousState: asJson({ siteCode: site.siteCode, name: site.name, status: site.status, geofenceMode: site.geofenceMode }),
          newState: asJson(dto),
        },
        (tx) => tx.site.update({ where: { id }, data }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new BadRequestException('Site code is already in use in this project');
      throw err;
    }
  }
  async updateTaskType(scope: AuthzScope, id: string, dto: UpdateTaskTypeDto, actorId: string) {
    const taskType = await this.requireTaskType(scope, id);
    try {
      return await this.audited(
        {
          actorId, action: 'task_type.updated', objectType: 'TaskType',
          previousState: asJson({ code: taskType.code, name: taskType.name, isActive: taskType.isActive }),
          newState: asJson(dto),
        },
        (tx) => tx.taskType.update({ where: { id }, data: {...(dto.code===undefined?{}:{code:dto.code}),...(dto.name===undefined?{}:{name:dto.name}),...(dto.category===undefined?{}:{category:dto.category}),...(dto.templateId===undefined?{}:{templateId:dto.templateId}),...(dto.order===undefined?{}:{order:dto.order}),...(dto.isActive===undefined?{}:{isActive:dto.isActive})} }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new BadRequestException('Task type code is already in use in this project');
      throw err;
    }
  }
  async updateMilestone(scope: AuthzScope, id: string, dto: UpdateMilestoneDto, actorId: string) {
    const milestone = await this.requireMilestone(scope, id);
    if (dto.taskTypeIds) {
      const found = dto.taskTypeIds.length
        ? await this.prisma.taskType.count({ where: { id: { in: dto.taskTypeIds }, projectId: milestone.projectId } })
        : 0;
      if (found !== dto.taskTypeIds.length) throw new BadRequestException('Every required task type must belong to this project');
    }
    const data = { ...(dto.code === undefined ? {} : { code: dto.code }), ...(dto.name === undefined ? {} : { name: dto.name }), ...(dto.kind === undefined ? {} : { kind: dto.kind }), ...(dto.sequence === undefined ? {} : { sequence: dto.sequence }), ...(dto.targetDate === undefined ? {} : { targetDate: dto.targetDate }) };

    return this.audited(
      {
        actorId, action: 'milestone.updated', objectType: 'Milestone',
        previousState: asJson({ code: milestone.code, name: milestone.name, kind: milestone.kind, sequence: milestone.sequence }),
        newState: asJson(dto),
      },
      async (tx) => {
        const saved = await tx.milestone.update({ where: { id }, data });
        if (dto.taskTypeIds) {
          await tx.milestoneRequirement.deleteMany({ where: { milestoneId: id } });
          if (dto.taskTypeIds.length) {
            await tx.milestoneRequirement.createMany({ data: dto.taskTypeIds.map((taskTypeId) => ({ milestoneId: id, taskTypeId })) });
          }
        }
        return saved;
      },
    );
  }
  /** Sets status; it does not police transitions — that is the tracking plan's Task 11. */
  async updateTask(scope: AuthzScope, id: string, dto: UpdateTaskDto, actorId: string) {
    const task = await this.requireTask(scope, id);
    return this.audited(
      {
        actorId, action: 'task.updated', objectType: 'Task',
        previousState: asJson({ title: task.title, status: task.status, assigneeId: task.assigneeId }),
        newState: asJson(dto),
      },
      (tx) => tx.task.update({ where: { id }, data: { ...(dto.title === undefined ? {} : { title: dto.title }), ...(dto.status === undefined ? {} : { status: dto.status }), ...(dto.assigneeId === undefined ? {} : { assigneeId: dto.assigneeId }), ...(dto.plannedCompletionAt === undefined ? {} : { plannedCompletionAt: dto.plannedCompletionAt }) } }),
    );
  }
  async archiveProject(scope: AuthzScope, id: string, actorId: string) {
    const project = await this.requireProject(scope, id);
    return this.audited(
      {
        actorId, action: 'project.archived', objectType: 'Project',
        previousState: asJson({ status: project.status }),
        newState: asJson({ status: 'CANCELLED' }),
      },
      (tx) => tx.project.update({ where: { id }, data: { status: 'CANCELLED' } }),
    );
  }
  /**
   * Refuses while tasks or work orders remain: the schema cascades Project to
   * its sites, task types, milestones and tasks, so this would take the lot,
   * and qc's work orders would be left pointing at nothing.
   */
  async deleteProject(scope: AuthzScope, id: string, actorId: string, bearer: string) {
    const project = await this.requireProject(scope, id);
    const tasks = await this.prisma.task.count({ where: { projectId: id } });
    if (tasks > 0) throw new ConflictException(`This project still has ${tasks} task(s). Delete them, or archive the project instead.`);
    const workOrders = await this.workOrders.count({ projectId: id }, bearer);
    if (workOrders > 0) throw new ConflictException(`This project still has ${workOrders} work order(s). Archive the project instead.`);
    await this.auditedDelete(
      { actorId, action: 'project.deleted', objectType: 'Project', objectId: id, previousState: asJson(project) },
      (tx) => tx.project.delete({ where: { id } }),
    );
  }
  async deleteSite(scope: AuthzScope, id: string, actorId: string, bearer: string) {
    const site = await this.requireSite(scope, id);
    const tasks = await this.prisma.task.count({ where: { siteId: id } });
    if (tasks > 0) throw new ConflictException(`This site still has ${tasks} task(s). Delete them first.`);
    const workOrders = await this.workOrders.count({ siteId: id }, bearer);
    if (workOrders > 0) throw new ConflictException(`This site has ${workOrders} work order(s) in Quality & EHS, which keep its history. It cannot be deleted.`);
    await this.auditedDelete(
      { actorId, action: 'site.deleted', objectType: 'Site', objectId: id, previousState: asJson({ siteCode: site.siteCode, name: site.name, projectId: site.projectId }) },
      (tx) => tx.site.delete({ where: { id } }),
    );
  }
  /** Checked here rather than caught from Prisma's onDelete:Restrict, so the message can say which way out there is. */
  async deleteTaskType(scope: AuthzScope, id: string, actorId: string) {
    const taskType = await this.requireTaskType(scope, id);
    const tasks = await this.prisma.task.count({ where: { taskTypeId: id } });
    if (tasks > 0) throw new ConflictException(`This task type is used by ${tasks} task(s). Deactivate it instead.`);
    await this.auditedDelete(
      { actorId, action: 'task_type.deleted', objectType: 'TaskType', objectId: id, previousState: asJson({ code: taskType.code, name: taskType.name, projectId: taskType.projectId }) },
      (tx) => tx.taskType.delete({ where: { id } }),
    );
  }
  async deleteMilestone(scope: AuthzScope, id: string, actorId: string) {
    const milestone = await this.requireMilestone(scope, id);
    await this.auditedDelete(
      { actorId, action: 'milestone.deleted', objectType: 'Milestone', objectId: id, previousState: asJson({ code: milestone.code, name: milestone.name, projectId: milestone.projectId }) },
      (tx) => tx.milestone.delete({ where: { id } }),
    );
  }
  async deleteTask(scope: AuthzScope, id: string, actorId: string) {
    const task = await this.requireTask(scope, id);
    await this.auditedDelete(
      { actorId, action: 'task.deleted', objectType: 'Task', objectId: id, previousState: asJson({ title: task.title, status: task.status, siteId: task.siteId }) },
      (tx) => tx.task.delete({ where: { id } }),
    );
  }
  /**
   * Coordinates and effective radius for one site, for the qc service.
   *
   * Decimal columns arrive as Prisma `Decimal`; they are narrowed to `number`
   * here so the caller never has to know which driver produced them.
   */
  async siteGeofence(id: string): Promise<{ latitude: number | null; longitude: number | null; effectiveRadiusM: number | null }> {
    const site = await this.prisma.site.findUnique({ where: { id }, include: { project: { select: { defaultGeofenceRadiusM: true } } } });
    if (!site) throw new NotFoundException('Site not found');
    return {
      latitude: site.latitude === null ? null : Number(site.latitude),
      longitude: site.longitude === null ? null : Number(site.longitude),
      effectiveRadiusM: resolveGeofenceRadius(
        { geofenceMode: site.geofenceMode as GeofenceMode, geofenceRadiusM: site.geofenceRadiusM },
        { defaultGeofenceRadiusM: site.project.defaultGeofenceRadiusM },
      ),
    };
  }
  /**
   * For qc, before it assigns work: the project, and those of `siteIds` in it
   * that the caller can see. A site the caller cannot see is simply absent, so
   * qc's count check refuses it without learning whether it exists.
   */
  async siteRefs(scope: AuthzScope, projectId: string, siteIds: string[]): Promise<SiteRefs> {
    const project = await this.requireProject(scope, projectId);
    const sites = await this.prisma.site.findMany({
      where: { AND: [{ id: { in: siteIds }, projectId }, siteScope(scope)] },
      select: { id: true, siteCode: true, name: true, city: true, area: true },
    });
    return { project, sites };
  }
  /**
   * Who could be made responsible for work in this project: every user whose
   * replicated scope reaches it, with how far. The web intersects this with the
   * name directory, and qc checks a work order's assignee against it.
   */
  async assignable(scope: AuthzScope, projectId: string): Promise<AssignableUser[]> {
    await this.requireProject(scope, projectId);
    const siteIds = (await this.prisma.site.findMany({ where: { projectId }, select: { id: true } })).map((site) => site.id);
    const rows = await this.prisma.userScope.findMany({
      where: { OR: [{ level: 'GLOBAL' }, { level: 'PROJECT', projectId }, { level: 'SITE', siteId: { in: siteIds } }] },
      select: { userId: true, level: true, siteId: true },
    });
    const byUser = new Map<string, AssignableUser>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? { userId: row.userId, wholeProject: false, siteIds: [] };
      if (row.level === 'SITE' && row.siteId) entry.siteIds.push(row.siteId);
      else entry.wholeProject = true;
      byUser.set(row.userId, entry);
    }
    return [...byUser.values()];
  }
  /**
   * Every count is scoped: an unscoped tally leaks the shape of the whole
   * platform. Review and rework counts are qc's, since work orders live there.
   */
  async dashboard(scope: AuthzScope) {
    const projects = await this.prisma.project.findMany({ where: { AND: [{ status: 'ACTIVE' }, projectScope(scope)] }, include: { _count: { select: { sites: { where: siteScope(scope) } } } }, take: 12, orderBy: { updatedAt: 'desc' } });
    return { activeProjectCount: projects.length, sitesInDelivery: projects.reduce((total, p) => total + p._count.sites, 0), projects };
  }
  /** The Director's portfolio: every ACTIVE or ON_HOLD project in scope, with the counts its health is judged by. */
  portfolio(scope: AuthzScope) { return summarizePortfolio(this.prisma, scope); }
  /**
   * The five guards below are where scope is enforced for almost every method
   * in this service: each one already funnelled through them, so they are the
   * one place that has to be right.
   *
   * NotFound, never Forbidden, and the scope filter is part of the lookup
   * rather than a check after it. A 403 would confirm the id names something
   * real, which is exactly what an enumeration attack is looking for, and a
   * fetch-then-check would have already read the row it is meant to protect.
   */
  /** Returns the row, not void: callers need a pre-image for the ledger and this query already reads one. */
  private async requireProject(scope: AuthzScope, id: string) {
    const project = await this.prisma.project.findFirst({
      where: visibleProject(scope, id),
      select: { id: true, code: true, name: true, status: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }
  private async requireSite(scope: AuthzScope, id: string) {
    const site = await this.prisma.site.findFirst({ where: visibleSite(scope, id) });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }
  private async requireTaskType(scope: AuthzScope, id: string) {
    const taskType = await this.prisma.taskType.findFirst({ where: visibleViaProject(scope, id) });
    if (!taskType) throw new NotFoundException('Task type not found');
    return taskType;
  }
  private async requireMilestone(scope: AuthzScope, id: string) {
    const milestone = await this.prisma.milestone.findFirst({ where: visibleViaProject(scope, id) });
    if (!milestone) throw new NotFoundException('Milestone not found');
    return milestone;
  }
  private async requireTask(scope: AuthzScope, id: string) {
    const task = await this.prisma.task.findFirst({ where: visibleTask(scope, id) });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }
}
