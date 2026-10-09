import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ListNotificationsQuerySchema, NotificationIdSchema, RegisterPushTokenSchema, UnregisterPushTokenSchema,
  type NotificationPage, type UnreadCount,
} from '@ipms/contracts';
import { CurrentUserId } from '../http/current-user.js';
import { PushService } from '../push/push.service.js';
import { NotificationService } from './notification.service.js';

/**
 * No `@RequirePermission` here, on purpose. A signed-in user may read and mark
 * their own notifications and nobody else's, and that boundary is the
 * `recipientId` filter in `NotificationService`, not a permission code.
 * `JwtUserGuard` still runs on every route, so the caller is always verified.
 * Do not add `@Public()` to anything in this class.
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService, private readonly push: PushService) {}

  @Get()
  async list(@CurrentUserId() userId: string, @Query() query: unknown): Promise<NotificationPage> {
    return this.notifications.list(userId, ListNotificationsQuerySchema.parse(query));
  }

  @Get('unread-count')
  async unreadCount(@CurrentUserId() userId: string): Promise<UnreadCount> {
    return { count: await this.notifications.unreadCount(userId) };
  }

  /** The device says where pushes for the caller should go. Safe to repeat: a token is one row. */
  @Post('push-tokens')
  @HttpCode(204)
  async registerPushToken(@CurrentUserId() userId: string, @Body() body: unknown): Promise<void> {
    await this.push.register(userId, RegisterPushTokenSchema.parse(body));
  }

  /** A POST rather than a DELETE with a body: some proxies drop DELETE bodies. */
  @Post('push-tokens/unregister')
  @HttpCode(204)
  async unregisterPushToken(@CurrentUserId() userId: string, @Body() body: unknown): Promise<void> {
    await this.push.unregister(userId, UnregisterPushTokenSchema.parse(body).token);
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUserId() userId: string): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(userId) };
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(@CurrentUserId() userId: string, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(userId, NotificationIdSchema.parse(id));
  }
}
