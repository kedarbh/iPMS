import { NotFoundException } from '@nestjs/common';
import type { Notification, PrismaClient } from '@prisma-clients/notification';
import { uuidv7, type NotificationDto, type NotificationPage } from '@ipms/contracts';
import { decodeCursor, encodeCursor } from './cursor.js';

export interface NewNotification {
  recipientId: string;
  eventId: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  workOrderId: string | null;
}

export interface ListQuery {
  limit: number;
  cursor?: string | undefined;
  unreadOnly: boolean;
}

function toDto(row: Notification): NotificationDto {
  return {
    id: row.id, type: row.type, title: row.title, body: row.body, actionUrl: row.actionUrl,
    workOrderId: row.workOrderId, isRead: row.isRead, createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Every method takes the caller's id and puts it in the query's `where`. That is
 * the whole authorization model for this service: a notification is readable and
 * writable by its recipient only, so a row that is someone else's is
 * indistinguishable from one that does not exist.
 */
export class NotificationService {
  /** `afterCreate` runs with the rows this call newly stored (never a redelivered duplicate); push hangs off it. */
  constructor(private readonly prisma: PrismaClient, private readonly afterCreate?: (rows: Notification[]) => void) {}

  /**
   * One row per recipient. `skipDuplicates` leans on the unique
   * `(recipientId, eventId)` key, so a redelivered event, or a retry after a
   * partial write, adds only what is missing.
   *
   * `createdAt` is set here rather than by the database default: Postgres keeps
   * microseconds, JavaScript keeps milliseconds, and the list cursor compares
   * timestamps it has round-tripped through JavaScript.
   */
  async createMany(items: NewNotification[]): Promise<number> {
    if (items.length === 0) return 0;
    const createdAt = new Date();
    const result = await this.prisma.notification.createMany({
      data: items.map((item) => ({ id: uuidv7(), createdAt, ...item })),
      skipDuplicates: true,
    });
    if (this.afterCreate && result.count > 0) {
      // Rows from this call all carry `createdAt`; a duplicate that was skipped keeps its original time.
      const stored = await this.prisma.notification.findMany({
        where: { createdAt, OR: items.map((i) => ({ recipientId: i.recipientId, eventId: i.eventId })) },
      });
      if (stored.length > 0) this.afterCreate(stored);
    }
    return result.count;
  }

  async list(recipientId: string, query: ListQuery): Promise<NotificationPage> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientId,
        ...(query.unreadOnly ? { isRead: false } : {}),
        ...(after
          ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One extra row says whether another page exists without a second query.
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toDto),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  unreadCount(recipientId: string): Promise<number> {
    return this.prisma.notification.count({ where: { recipientId, isRead: false } });
  }

  async markRead(recipientId: string, id: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id, recipientId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    if (result.count > 0) return;
    // Nothing changed: either it was already read (success) or it is not theirs (not found).
    const existing = await this.prisma.notification.findFirst({ where: { id, recipientId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Notification not found');
  }

  async markAllRead(recipientId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return result.count;
  }
}
