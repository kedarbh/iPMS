import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import {
  CancelWorkOrderSchema, CreateWorkOrdersSchema, ListWorkOrdersQuerySchema, UpdateWorkOrderSchema, UuidSchema,
} from '@ipms/contracts';
import { ProjectDirectoryClient, required } from './project-directory.client.js';
import { WorkOrderService, type WorkOrderScope } from './work-order.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

const bearerOf = (req: Authed): string => req.headers['authorization'] ?? '';

/**
 * The work order queue and its lifecycle, reached through the gateway's
 * `/api/v1/work-orders` prefix.
 *
 * Scope is project's to decide: project and site grants are replicated there,
 * and so are the sites they name. Each read asks it for the caller's scope and
 * filters on the project and site ids every work order carries.
 */
@Controller('work-orders')
export class WorkOrderController {
  constructor(private readonly workOrders: WorkOrderService, private readonly projects: ProjectDirectoryClient) {}

  @Get() @RequirePermission('task.view')
  async list(@Query() query: unknown, @Req() req: Authed) {
    const parsed = ListWorkOrdersQuerySchema.parse(query);
    return this.workOrders.list(await this.readScope(req), parsed);
  }

  @Get('by-project/:projectId') @RequirePermission('task.view')
  async brief(@Param('projectId') projectId: string, @Req() req: Authed) {
    const id = UuidSchema.parse(projectId);
    return this.workOrders.brief(await this.readScope(req), id);
  }

  /** Per-project counts for the Director's portfolio, within what the caller may read. */
  @Get('summary') @RequirePermission('task.view')
  async summary(@Req() req: Authed) {
    return this.workOrders.summary(await this.readScope(req));
  }

  @Get(':id') @RequirePermission('task.view')
  async get(@Param('id') id: string, @Req() req: Authed) {
    const parsed = UuidSchema.parse(id);
    return this.workOrders.get(await this.readScope(req), parsed);
  }

  /**
   * A work order is created already assigned, so it takes both verbs. The
   * guard checks one permission per route; the second is checked here, against
   * the same resolved permission set.
   */
  @Post() @RequirePermission('task.create')
  create(@Body() body: unknown, @Req() req: Authed) {
    if (!req.user.permissions.includes('task.assign')) throw new ForbiddenException('Creating a work order assigns it, which needs task.assign');
    return this.workOrders.create(CreateWorkOrdersSchema.parse(body), req.user.id, bearerOf(req));
  }

  /** Reassigning is the assign verb; moving the date goes with it, since both decide who does what by when. */
  @Patch(':id') @RequirePermission('task.assign')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    const parsed = UuidSchema.parse(id);
    const dto = UpdateWorkOrderSchema.parse(body);
    return this.workOrders.update(await this.scope(req), parsed, dto, req.user.id, bearerOf(req));
  }

  @Post(':id/cancel') @RequirePermission('task.cancel')
  async cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    const parsed = UuidSchema.parse(id);
    const dto = CancelWorkOrderSchema.parse(body);
    return this.workOrders.cancel(await this.scope(req), parsed, dto, req.user.id);
  }

  /**
   * The scope reads use. `task.view` alone reaches only the caller's own,
   * uncancelled work; `task.view_all` lifts that to everything in scope.
   * Enforced here rather than in the web, so the field app and direct API
   * calls get the same answer.
   */
  private async readScope(req: Authed): Promise<WorkOrderScope> {
    const scope = await this.scope(req);
    return req.user.permissions.includes('task.view_all') ? scope : { ...scope, onlyAssignee: req.user.id };
  }

  private async scope(req: Authed) {
    return required(await this.projects.scope(bearerOf(req)), 'Scope');
  }
}
