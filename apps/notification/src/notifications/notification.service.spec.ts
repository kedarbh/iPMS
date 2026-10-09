import { describe, expect, it, vi } from 'vitest';
import { NotificationService, type NewNotification } from './notification.service.js';
import { encodeCursor } from './cursor.js';

const ME = '0192f7a0-0000-7000-8000-0000000000aa';

function row(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `0192f7a0-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`,
    recipientId: ME, eventId: null, type: 'QC_SUBMISSION_SUBMITTED', title: `t${n}`, body: `b${n}`,
    actionUrl: '/quality/work-orders/x', workOrderId: null, isRead: false, readAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 2, 8, 0, 60 - n)), ...extra,
  };
}

function build() {
  const prisma = {
    notification: {
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(3),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { service: new NotificationService(prisma as never), prisma };
}

const NEW: NewNotification = {
  recipientId: ME, eventId: '0192f7a0-0000-7000-8000-0000000000e1', type: 'QC_SUBMISSION_SUBMITTED',
  title: 'T', body: 'B', actionUrl: '/quality/work-orders/w', workOrderId: '0192f7a0-0000-7000-8000-0000000000b1',
};

describe('NotificationService.createMany after-create hook', () => {
  it('hands over the rows this call stored, and not when nothing was new', async () => {
    const prisma = {
      notification: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([row(1)]),
      },
    };
    const after = vi.fn();
    const service = new NotificationService(prisma as never, after);
    await service.createMany([NEW]);
    expect(after).toHaveBeenCalledWith([row(1)]);
    const where = prisma.notification.findMany.mock.calls[0]?.[0].where;
    expect(where.OR).toEqual([{ recipientId: ME, eventId: NEW.eventId }]);

    prisma.notification.createMany.mockResolvedValue({ count: 0 });
    after.mockClear();
    await service.createMany([NEW]);
    expect(after).not.toHaveBeenCalled();
  });
});

describe('NotificationService.createMany', () => {
  it('writes one row per recipient, skipping duplicates, and returns how many were new', async () => {
    const { service, prisma } = build();
    const count = await service.createMany([NEW, { ...NEW, recipientId: '0192f7a0-0000-7000-8000-0000000000ab' }]);
    expect(count).toBe(2);
    const arg = prisma.notification.createMany.mock.calls[0]?.[0];
    expect(arg?.skipDuplicates).toBe(true);
    expect(arg?.data).toHaveLength(2);
    expect(arg?.data?.[0]).toMatchObject({ recipientId: ME, eventId: NEW.eventId, type: NEW.type, workOrderId: NEW.workOrderId });
    expect(new Set((arg?.data as { id: string }[])?.map((d: { id: string }) => d.id)).size).toBe(2);
  });

  it('does nothing for an empty list', async () => {
    const { service, prisma } = build();
    expect(await service.createMany([])).toBe(0);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });
});

describe('NotificationService.list', () => {
  it("only ever asks for the caller's own rows, newest first", async () => {
    const { service, prisma } = build();
    await service.list(ME, { limit: 20, unreadOnly: false });
    const arg = prisma.notification.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ recipientId: ME });
    expect(arg?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(arg?.take).toBe(21);
  });

  it('narrows to unread when asked', async () => {
    const { service, prisma } = build();
    await service.list(ME, { limit: 20, unreadOnly: true });
    expect(prisma.notification.findMany.mock.calls[0]?.[0]?.where).toEqual({ recipientId: ME, isRead: false });
  });

  it('continues from a cursor without dropping rows that share a timestamp', async () => {
    const { service, prisma } = build();
    const last = row(5);
    await service.list(ME, { limit: 20, unreadOnly: false, cursor: encodeCursor(last) });
    expect(prisma.notification.findMany.mock.calls[0]?.[0]?.where).toEqual({
      recipientId: ME,
      OR: [{ createdAt: { lt: last.createdAt } }, { createdAt: last.createdAt, id: { lt: last.id } }],
    });
  });

  it('returns a next cursor only when a further page exists, and never the extra row', async () => {
    const { service, prisma } = build();
    prisma.notification.findMany.mockResolvedValue([row(1), row(2), row(3)]);
    const page = await service.list(ME, { limit: 2, unreadOnly: false });
    expect(page.items.map((i) => i.title)).toEqual(['t1', 't2']);
    expect(page.nextCursor).toBe(encodeCursor(row(2)));

    prisma.notification.findMany.mockResolvedValue([row(1)]);
    expect((await service.list(ME, { limit: 2, unreadOnly: false })).nextCursor).toBeNull();
  });

  it('shapes rows for the wire', async () => {
    const { service, prisma } = build();
    prisma.notification.findMany.mockResolvedValue([row(1)]);
    const [item] = (await service.list(ME, { limit: 20, unreadOnly: false })).items;
    expect(item).toEqual({
      id: row(1).id, type: 'QC_SUBMISSION_SUBMITTED', title: 't1', body: 'b1', actionUrl: '/quality/work-orders/x',
      workOrderId: null, isRead: false, createdAt: row(1).createdAt.toISOString(),
    });
  });
});

describe('NotificationService read state', () => {
  it("counts only the caller's unread rows", async () => {
    const { service, prisma } = build();
    expect(await service.unreadCount(ME)).toBe(3);
    expect(prisma.notification.count).toHaveBeenCalledWith({ where: { recipientId: ME, isRead: false } });
  });

  it('marks one row read, scoped to its recipient', async () => {
    const { service, prisma } = build();
    await service.markRead(ME, row(1).id);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: row(1).id, recipientId: ME, isRead: false },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });

  it('treats an already-read row as success', async () => {
    const { service, prisma } = build();
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    prisma.notification.findFirst.mockResolvedValue({ id: row(1).id });
    await expect(service.markRead(ME, row(1).id)).resolves.toBeUndefined();
  });

  it("answers not found for someone else's row, the same as for a missing one", async () => {
    const { service, prisma } = build();
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead(ME, row(1).id)).rejects.toMatchObject({ status: 404 });
    expect(prisma.notification.findFirst).toHaveBeenCalledWith({ where: { id: row(1).id, recipientId: ME }, select: { id: true } });
  });

  it("marks all of the caller's unread rows read and reports how many", async () => {
    const { service, prisma } = build();
    prisma.notification.updateMany.mockResolvedValue({ count: 4 });
    expect(await service.markAllRead(ME)).toBe(4);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { recipientId: ME, isRead: false },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });
});
