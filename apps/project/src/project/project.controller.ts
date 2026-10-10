import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission, type AuthzScope, type AuthzUser } from '@ipms/authz';
import { ScopeOf } from '../http/scope.decorator.js';
import { SiteRefsRequestSchema, AssignTaskSchema, CreateMilestoneSchema, CreateProjectSchema, CreateSiteSchema, CreateTaskSchema, CreateTaskTypeSchema, ListTasksQuerySchema, UpdateMilestoneSchema, UpdateProjectSchema, UpdateSiteSchema, UpdateTaskSchema, UpdateTaskTypeSchema, UuidSchema } from '@ipms/contracts';
import { SiteImportCommitSchema } from '@ipms/contracts';
import { buildTemplate } from './import/template.js';
import { SiteImportService } from './import/site-import.service.js';
import { ProjectService } from './project.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };
@Controller() export class ProjectController { constructor(private readonly service: ProjectService, private readonly imports: SiteImportService) {}
  @Get('dashboard') @RequirePermission('project.view') dashboard(@ScopeOf() scope: AuthzScope){ return this.service.dashboard(scope); }
  /** For the Project Director's home. */
  @Get('dashboard/portfolio') @RequirePermission('project.view') portfolio(@ScopeOf() scope: AuthzScope){ return this.service.portfolio(scope); }
  /** Service-to-service only: the gateway refuses every '/internal/' path. Still permission-checked, because the caller forwards the submitting user's own token. */
  @Get('internal/sites/:id/geofence') @RequirePermission('site.view') siteGeofence(@Param('id') id:string){ return this.service.siteGeofence(UuidSchema.parse(id)); }
  /** For qc: the caller's own replicated scope, which qc filters work orders by. task.view because every work order read needs it. */
  @Get('internal/scope') @RequirePermission('task.view') internalScope(@ScopeOf() scope: AuthzScope){ return scope; }
  /** For qc, before it assigns work: which of these sites the caller can see, and what they are called. */
  @Post('internal/projects/:id/site-refs') @RequirePermission('site.view') siteRefs(@ScopeOf() scope: AuthzScope, @Param('id') id:string, @Body() body:unknown){ return this.service.siteRefs(scope, UuidSchema.parse(id), SiteRefsRequestSchema.parse(body).siteIds); }
  /** Who can be given work in this project. Read by the work order composer and by qc's assignee check. */
  @Get('projects/:id/assignable') @RequirePermission('task.assign') assignable(@ScopeOf() scope: AuthzScope, @Param('id') id:string){ return this.service.assignable(scope, UuidSchema.parse(id)); }
  @Get('projects') @RequirePermission('project.view') list(@ScopeOf() scope: AuthzScope){ return this.service.listProjects(scope); }
  @Get('projects/:id') @RequirePermission('project.view') get(@ScopeOf() scope: AuthzScope, @Param('id') id:string){ return this.service.getProject(scope, UuidSchema.parse(id)); }
  @Get('projects/:id/tasks') @RequirePermission('task.view') tasks(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Query() query:unknown){ return this.service.listTasks(scope, UuidSchema.parse(id),ListTasksQuerySchema.parse(query)); }
  @Post('projects') @RequirePermission('project.create') create(@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.service.createProject(CreateProjectSchema.parse(body), req.user.id); }
  @Patch('projects/:id') @RequirePermission('project.update') update(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.service.updateProject(scope, UuidSchema.parse(id),UpdateProjectSchema.parse(body), req.user.id); }
  @Post('projects/:id/sites') @RequirePermission('site.create') site(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.service.createSite(scope, UuidSchema.parse(id),CreateSiteSchema.parse(body), req.user.id); }
  @Get('projects/:id/sites/import/template') @RequirePermission('site.import') async template(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Res() reply:FastifyReply){ const project=await this.service.getProject(scope, UuidSchema.parse(id)); const file=await buildTemplate(project.defaultGeofenceRadiusM); return reply.header('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition',`attachment; filename="sites-${project.code}.xlsx"`).send(file); }
  @Post('projects/:id/sites/import/preview') @RequirePermission('site.import') async previewImport(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Req() req:FastifyRequest){ const file=await req.file(); if(!file) throw new BadRequestException('Attach an .xlsx file in a "file" field'); return this.imports.preview(scope, UuidSchema.parse(id),await file.toBuffer()); }
  @Post('projects/:id/sites/import/commit') @RequirePermission('site.import') commitImport(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.imports.commit(scope, UuidSchema.parse(id),SiteImportCommitSchema.parse(body), req.user.id); }
  @Post('projects/:id/task-types') @RequirePermission('task.create') taskType(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.service.createTaskType(scope, UuidSchema.parse(id),CreateTaskTypeSchema.parse(body), req.user.id); }
  @Post('projects/:id/milestones') @RequirePermission('milestone.create') milestone(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.service.createMilestone(scope, UuidSchema.parse(id),CreateMilestoneSchema.parse(body), req.user.id); }
  @Post('projects/:id/tasks') @RequirePermission('task.create') task(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown,@Req() req:{user:AuthzUser}){ return this.service.createTask(scope, UuidSchema.parse(id),CreateTaskSchema.parse(body),req.user.id); }
  @Post('projects/:id/archive') @RequirePermission('project.archive') archive(@ScopeOf() scope: AuthzScope, @Param('id') id:string, @Req() req: { user: AuthzUser }){ return this.service.archiveProject(scope, UuidSchema.parse(id), req.user.id); }
  @Delete('projects/:id') @RequirePermission('project.delete') remove(@ScopeOf() scope: AuthzScope, @Param('id') id:string, @Req() req: Authed){ return this.service.deleteProject(scope, UuidSchema.parse(id), req.user.id, req.headers['authorization'] ?? ''); }
  @Delete('sites/:id') @RequirePermission('site.delete') removeSite(@ScopeOf() scope: AuthzScope, @Param('id') id:string, @Req() req: Authed){ return this.service.deleteSite(scope, UuidSchema.parse(id), req.user.id, req.headers['authorization'] ?? ''); }
  @Delete('task-types/:id') @RequirePermission('task.update') removeTaskType(@ScopeOf() scope: AuthzScope, @Param('id') id:string, @Req() req: { user: AuthzUser }){ return this.service.deleteTaskType(scope, UuidSchema.parse(id), req.user.id); }
  @Delete('milestones/:id') @RequirePermission('milestone.update') removeMilestone(@ScopeOf() scope: AuthzScope, @Param('id') id:string, @Req() req: { user: AuthzUser }){ return this.service.deleteMilestone(scope, UuidSchema.parse(id), req.user.id); }
  @Delete('tasks/:id') @RequirePermission('task.delete') removeTask(@ScopeOf() scope: AuthzScope, @Param('id') id:string, @Req() req: { user: AuthzUser }){ return this.service.deleteTask(scope, UuidSchema.parse(id), req.user.id); }
  @Patch('sites/:id') @RequirePermission('site.update') updateSite(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.service.updateSite(scope, UuidSchema.parse(id),UpdateSiteSchema.parse(body), req.user.id); }
  @Patch('task-types/:id') @RequirePermission('task.update') updateTaskType(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.service.updateTaskType(scope, UuidSchema.parse(id),UpdateTaskTypeSchema.parse(body), req.user.id); }
  @Patch('milestones/:id') @RequirePermission('milestone.update') updateMilestone(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.service.updateMilestone(scope, UuidSchema.parse(id),UpdateMilestoneSchema.parse(body), req.user.id); }
  @Patch('tasks/:id') @RequirePermission('task.update') updateTask(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.service.updateTask(scope, UuidSchema.parse(id),UpdateTaskSchema.parse(body), req.user.id); }
  @Post('tasks/:id/assign') @RequirePermission('task.assign') assign(@ScopeOf() scope: AuthzScope, @Param('id') id:string,@Body() body:unknown, @Req() req: { user: AuthzUser }){ return this.service.assignTask(scope, UuidSchema.parse(id),AssignTaskSchema.parse(body), req.user.id); }
}
