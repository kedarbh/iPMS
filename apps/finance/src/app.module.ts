import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
  type AuthzScope, type ScopeProvider,
} from '@ipms/authz';
import { EventBus } from '@ipms/events';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { ApprovalService } from './approvals/approval.service.js';
import { CategoryService } from './categories/category.service.js';
import { MediaClient } from './directory/media.client.js';
import { ProjectDirectoryClient } from './directory/project-directory.client.js';
import { CategoryController } from './http/category.controller.js';
import { OverviewController } from './http/overview.controller.js';
import { ReportController } from './http/report.controller.js';
import { RequestController } from './http/request.controller.js';
import { OutboxDrainer } from './outbox/outbox.drainer.js';
import { PaymentService } from './payments/payment.service.js';
import { PrismaService } from './prisma.service.js';
import { OverviewService } from './queries/overview.service.js';
import { QueryService } from './queries/query.service.js';
import { ReportService } from './queries/report.service.js';
import { ReminderService } from './reminders/reminder.service.js';
import { RequestService } from './requests/request.service.js';

// Least-permissive scope: no finance route passes a resource to check(), so scope is never consulted
// by the guard. Each request resolves the caller's real scope from project, per request.
const scopeProvider: ScopeProvider = { async for(): Promise<AuthzScope> { return { global: false, projectIds: [], siteIds: [] }; } };

const projectInternalUrl = (): string => process.env['PROJECT_INTERNAL_URL'] ?? 'http://project:3004';
const mediaInternalUrl = (): string => process.env['MEDIA_INTERNAL_URL'] ?? 'http://media:3006';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const service = <T>(cls: new (db: PrismaService['db']) => T) => ({
  provide: cls,
  useFactory: (prisma: PrismaService) => new cls(prisma.db),
  inject: [PrismaService],
});

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [RequestController, CategoryController, ReportController, OverviewController, HealthController, MetricsController],
  providers: [
    // Order matters: JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: scopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: () => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
    { provide: ProjectDirectoryClient, useFactory: () => new ProjectDirectoryClient(projectInternalUrl()) },
    { provide: MediaClient, useFactory: () => new MediaClient(mediaInternalUrl()) },
    {
      provide: RequestService,
      useFactory: (prisma: PrismaService, media: MediaClient) => new RequestService(prisma.db, media),
      inject: [PrismaService, MediaClient],
    },
    service(ApprovalService),
    service(PaymentService),
    service(QueryService),
    service(CategoryService),
    service(ReportService),
    service(OverviewService),
    service(ReminderService),
    {
      provide: EventBus,
      useFactory: async (): Promise<EventBus> => {
        const bus = new EventBus();
        await bus.connect(requireEnv('NATS_URL'));
        await bus.ensureStreams();
        registerReadinessCheck('nats', () => bus.isHealthy());
        return bus;
      },
    },
    { provide: OutboxDrainer, useFactory: (prisma: PrismaService, bus: EventBus) => new OutboxDrainer(prisma.db, bus), inject: [PrismaService, EventBus] },
  ],
})
export class AppModule {}
