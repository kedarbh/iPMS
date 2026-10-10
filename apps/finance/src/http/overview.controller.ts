import { Controller, Get, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { ProjectDirectoryClient, required } from '../directory/project-directory.client.js';
import { OverviewService } from '../queries/overview.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

/** The approver's money at a glance, reached through the gateway's `/api/v1/finance` prefix. */
@Controller('finance')
export class OverviewController {
  constructor(private readonly overviews: OverviewService, private readonly projects: ProjectDirectoryClient) {}

  @Get('overview') @RequirePermission('finance_request.view_all')
  async overview(@Req() req: Authed) {
    const scope = required(await this.projects.scope(req.headers['authorization'] ?? ''), 'Scope');
    return this.overviews.overview(req.user, scope);
  }
}
