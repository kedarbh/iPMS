import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
  type AuthzScope, type ScopeProvider,
} from '@ipms/authz';
import { EventBus } from '@ipms/events';
import { HealthController, MetricsController, createLogger, registerReadinessCheck } from '@ipms/observability';
import { IamDirectoryClient } from './directory/iam-directory.client.js';
import { IamNotificationConsumer } from './events/iam-notification.consumer.js';
import { FinanceNotificationConsumer } from './events/finance-notification.consumer.js';
import { QcNotificationConsumer } from './events/qc-notification.consumer.js';
import { NotificationController } from './notifications/notification.controller.js';
import { NotificationService } from './notifications/notification.service.js';
import { PrismaService } from './prisma.service.js';
import { FcmSender, parseServiceAccount } from './push/fcm.sender.js';
import { PushService } from './push/push.service.js';
import { NoopPushSender, type PushSender } from './push/push.sender.js';

const log = createLogger('notification');

/**
 * Push goes out through FCM when `FCM_SERVICE_ACCOUNT_JSON` holds a Firebase service-account key;
 * without it, notifications stay in-app and devices can still register (so pushes start the day a key is set).
 */
function pushSender(): PushSender {
  const raw = process.env['FCM_SERVICE_ACCOUNT_JSON'];
  if (!raw) {
    log.info('FCM_SERVICE_ACCOUNT_JSON is not set: push is off, notifications stay in-app');
    return new NoopPushSender();
  }
  const account = parseServiceAccount(raw);
  if (!account) {
    log.error('FCM_SERVICE_ACCOUNT_JSON is not a service-account key: push is off');
    return new NoopPushSender();
  }
  log.info({ project: account.project_id }, 'push enabled through FCM');
  return new FcmSender(account);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * `notification`'s routes return only the caller's own rows, enforced by the
 * `recipientId` filter in `NotificationService`, and none passes a resource to
 * `check()`. An empty, non-global scope is therefore the *least* permissive value
 * available to it, not a stub. Do NOT "fix" this into `global: true` — that would
 * silently grant scope-based access to every project and site the moment a future
 * change passes a resource into `check()`.
 */
const notificationScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

/**
 * Push (FCM; Android, with iOS through the APNs bridge) is a sink beside in-app delivery for the same
 * decision: `NotificationService` stores a notification, then `PushService` sends it to the recipient's
 * registered devices. Email transport is still deferred (spec 2026-09-20 §6.2).
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, MetricsController, NotificationController],
  providers: [
    // Registration order matters: APP_GUARD providers run in the order they are
    // listed. JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: notificationScopeProvider },
    /**
     * `AuthzGuard` passes overrides to `check()`, so every service must provide
     * this token or fail at bootstrap. notification returns none, which is the
     * *least* permissive option rather than a gap: global overrides are already
     * resolved into the JWT `permissions` claim at issuance, and this service
     * has no routes passing a `resource` for a scoped override to apply to.
     */
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
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
    {
      provide: PushService,
      useFactory: (prisma: PrismaService): PushService => new PushService(prisma.db, pushSender()),
      inject: [PrismaService],
    },
    {
      provide: NotificationService,
      useFactory: (prisma: PrismaService, push: PushService): NotificationService =>
        new NotificationService(prisma.db, (rows) => { void push.dispatch(rows); }),
      inject: [PrismaService, PushService],
    },
    {
      provide: IamDirectoryClient,
      useFactory: (): IamDirectoryClient => new IamDirectoryClient(
        requireEnv('IAM_INTERNAL_URL'),
        requireEnv('INTERNAL_SERVICE_KEY'),
      ),
    },
    {
      provide: QcNotificationConsumer,
      useFactory: (notifications: NotificationService, iam: IamDirectoryClient, bus: EventBus): QcNotificationConsumer =>
        new QcNotificationConsumer(notifications, iam, bus),
      inject: [NotificationService, IamDirectoryClient, EventBus],
    },
    {
      provide: FinanceNotificationConsumer,
      useFactory: (notifications: NotificationService, iam: IamDirectoryClient, bus: EventBus): FinanceNotificationConsumer =>
        new FinanceNotificationConsumer(notifications, iam, bus),
      inject: [NotificationService, IamDirectoryClient, EventBus],
    },
    {
      provide: IamNotificationConsumer,
      useFactory: (notifications: NotificationService, bus: EventBus): IamNotificationConsumer =>
        new IamNotificationConsumer(notifications, bus),
      inject: [NotificationService, EventBus],
    },
  ],
})
export class AppModule {}
