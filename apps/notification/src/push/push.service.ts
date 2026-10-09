import type { Notification, PrismaClient } from '@prisma-clients/notification';
import { uuidv7, type RegisterPushTokenDto } from '@ipms/contracts';
import { createLogger } from '@ipms/observability';
import type { PushSender } from './push.sender.js';

const log = createLogger('notification');

/** What the app is told with each push, so tapping it can open the right screen. */
export function dataOf(n: Pick<Notification, 'id' | 'type' | 'actionUrl' | 'workOrderId'>): Record<string, string> {
  return {
    notificationId: n.id,
    type: n.type,
    ...(n.actionUrl ? { actionUrl: n.actionUrl } : {}),
    ...(n.workOrderId ? { workOrderId: n.workOrderId } : {}),
  };
}

/**
 * Device registrations, and the push that follows each stored notification.
 * Push is an extra sink for what is already decided and saved: a failure here
 * is logged and never undoes or delays the in-app notification.
 */
export class PushService {
  constructor(private readonly prisma: PrismaClient, private readonly sender: PushSender) {}

  get enabled(): boolean {
    return this.sender.enabled;
  }

  /** Remembers a device for [userId]. A token seen again moves to whoever registers it last (a shared phone) and is switched back on. */
  async register(userId: string, dto: RegisterPushTokenDto): Promise<void> {
    await this.prisma.devicePushToken.upsert({
      where: { token: dto.token },
      create: { id: uuidv7(), userId, token: dto.token, platform: dto.platform, isActive: true },
      update: { userId, platform: dto.platform, isActive: true },
    });
  }

  /** Stops pushes to a device, but only if it is this user's. */
  async unregister(userId: string, token: string): Promise<void> {
    await this.prisma.devicePushToken.updateMany({ where: { token, userId }, data: { isActive: false } });
  }

  /** Pushes each freshly stored notification to its recipient's devices. Never throws. */
  async dispatch(rows: readonly Notification[]): Promise<void> {
    if (!this.sender.enabled || rows.length === 0) return;
    try {
      const devices = await this.prisma.devicePushToken.findMany({
        where: { userId: { in: [...new Set(rows.map((r) => r.recipientId))] }, isActive: true },
        select: { userId: true, token: true },
      });
      const dead = new Set<string>();
      for (const row of rows) {
        const tokens = devices.filter((d) => d.userId === row.recipientId && !dead.has(d.token)).map((d) => d.token);
        if (tokens.length === 0) continue;
        const result = await this.sender.send(tokens, { title: row.title, body: row.body, data: dataOf(row) });
        for (const token of result.invalidTokens) dead.add(token);
      }
      if (dead.size > 0) await this.prisma.devicePushToken.updateMany({ where: { token: { in: [...dead] } }, data: { isActive: false } });
    } catch (error) {
      log.warn({ err: error }, 'push dispatch failed');
    }
  }
}
