import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import {
  ApproveSchema, CashReturnSchema, CommentSchema, CreateRequestSchema, ListRequestsQuerySchema, OptionalCommentSchema,
  PayRequestSchema, UpdateRequestSchema, UuidSchema,
} from '@ipms/contracts';
import { ApprovalService } from '../approvals/approval.service.js';
import { ProjectDirectoryClient, required } from '../directory/project-directory.client.js';
import { PaymentService } from '../payments/payment.service.js';
import { QueryService } from '../queries/query.service.js';
import { ReminderService } from '../reminders/reminder.service.js';
import { RequestService } from '../requests/request.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };
const bearerOf = (req: Authed): string => req.headers['authorization'] ?? '';

/**
 * Requests, approvals and payments, reached through the gateway's
 * `/api/v1/finance` prefix.
 *
 * The route-level permission is the broad gate (any finance user). The verb
 * that actually decides, create versus settle, PM versus Director, is checked
 * in the service against the request, because one route serves several of
 * them. Project scope is project's to decide, so each handler asks it.
 */
@Controller('finance')
export class RequestController {
  constructor(
    private readonly requests: RequestService,
    private readonly approvals: ApprovalService,
    private readonly payments: PaymentService,
    private readonly queries: QueryService,
    private readonly reminders: ReminderService,
    private readonly projects: ProjectDirectoryClient,
  ) {}

  private async scope(req: Authed) {
    return required(await this.projects.scope(bearerOf(req)), 'Scope');
  }

  @Post('requests') @RequirePermission('finance_request.view')
  async create(@Body() body: unknown, @Req() req: Authed) {
    const dto = CreateRequestSchema.parse(body);
    const scope = await this.scope(req);
    const project = dto.kind === 'SETTLEMENT' ? undefined : required(await this.projects.project(dto.projectId, bearerOf(req)), 'Project');
    return this.requests.create(dto, req.user, scope, project);
  }

  @Patch('requests/:id') @RequirePermission('finance_request.view')
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.requests.update(UuidSchema.parse(id), UpdateRequestSchema.parse(body), req.user);
  }

  @Post('requests/:id/submit') @RequirePermission('finance_request.view')
  submit(@Param('id') id: string, @Req() req: Authed) {
    return this.requests.submit(UuidSchema.parse(id), req.user, bearerOf(req));
  }

  @Post('requests/:id/cancel') @RequirePermission('finance_request.view')
  cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.requests.cancel(UuidSchema.parse(id), OptionalCommentSchema.parse(body ?? {}).comment, req.user);
  }

  @Post('requests/:id/approve') @RequirePermission('finance_request.view')
  async approve(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.approvals.approve(UuidSchema.parse(id), ApproveSchema.parse(body ?? {}), req.user, await this.scope(req));
  }

  @Post('requests/:id/return') @RequirePermission('finance_request.view')
  async returnToRequester(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.approvals.returnToRequester(UuidSchema.parse(id), CommentSchema.parse(body).comment, req.user, await this.scope(req));
  }

  @Post('requests/:id/reject') @RequirePermission('finance_request.view')
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.approvals.reject(UuidSchema.parse(id), CommentSchema.parse(body).comment, req.user, await this.scope(req));
  }

  @Post('requests/:id/pay') @RequirePermission('finance_payment.record')
  async pay(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.payments.pay(UuidSchema.parse(id), PayRequestSchema.parse(body ?? {}), req.user, await this.scope(req));
  }

  @Post('advances/:id/cash-return') @RequirePermission('finance_payment.record')
  async returnCash(@Param('id') id: string, @Body() body: unknown, @Req() req: Authed) {
    return this.payments.returnCash(UuidSchema.parse(id), CashReturnSchema.parse(body), req.user, await this.scope(req));
  }

  @Post('advances/:id/remind') @RequirePermission('finance_request.view')
  async remind(@Param('id') id: string, @Req() req: Authed) {
    return this.reminders.remind(UuidSchema.parse(id), req.user, await this.scope(req));
  }

  @Get('requests') @RequirePermission('finance_request.view')
  async list(@Query() query: unknown, @Req() req: Authed) {
    return this.queries.list(req.user, await this.scope(req), ListRequestsQuerySchema.parse(query));
  }

  @Get('requests/:id') @RequirePermission('finance_request.view')
  async get(@Param('id') id: string, @Req() req: Authed) {
    return this.queries.get(UuidSchema.parse(id), req.user, await this.scope(req));
  }

  @Get('advances/:id') @RequirePermission('finance_request.view')
  async advance(@Param('id') id: string, @Req() req: Authed) {
    return this.queries.advance(UuidSchema.parse(id), req.user, await this.scope(req));
  }
}
