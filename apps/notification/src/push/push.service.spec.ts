import { describe, expect, it, vi } from 'vitest';
import { PushService, dataOf } from './push.service.js';
import type { PushSender } from './push.sender.js';

const row = (recipientId: string, extra: Record<string, unknown> = {}) => ({
  id: `n-${recipientId}`, recipientId, eventId: 'e', type: 'FINANCE_APPROVAL_NEEDED', title: 'Approval needed', body: 'Waiting for you',
  actionUrl: '/finance/requests/r-1', workOrderId: null, isRead: false, readAt: null, createdAt: new Date(), ...extra,
});

function build(sender: PushSender, devices: Array<{ userId: string; token: string }> = []) {
  const prisma = {
    devicePushToken: {
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue(devices),
    },
  };
  return { service: new PushService(prisma as never, sender), prisma };
}

const sender = (invalid: string[] = []): PushSender & { send: ReturnType<typeof vi.fn> } => ({ enabled: true, send: vi.fn().mockResolvedValue({ invalidTokens: invalid }) });

describe('registering', () => {
  it('stores a token once, moving it to whoever registers it last and switching it back on', async () => {
    const { service, prisma } = build(sender());
    await service.register('u-1', { token: 't'.repeat(30), platform: 'ANDROID' });
    const arg = prisma.devicePushToken.upsert.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ token: 't'.repeat(30) });
    expect(arg.update).toEqual({ userId: 'u-1', platform: 'ANDROID', isActive: true });
    expect(arg.create).toMatchObject({ userId: 'u-1', isActive: true });
  });

  it('switches a device off only for its own user', async () => {
    const { service, prisma } = build(sender());
    await service.unregister('u-1', 'tok');
    expect(prisma.devicePushToken.updateMany).toHaveBeenCalledWith({ where: { token: 'tok', userId: 'u-1' }, data: { isActive: false } });
  });
});

describe('dispatch', () => {
  it('sends each notification to its recipient\'s devices, with what the app needs to open it', async () => {
    const s = sender();
    const { service } = build(s, [{ userId: 'u-1', token: 'a' }, { userId: 'u-1', token: 'b' }, { userId: 'u-2', token: 'c' }]);
    await service.dispatch([row('u-1'), row('u-2')]);
    expect(s.send).toHaveBeenCalledTimes(2);
    expect(s.send).toHaveBeenCalledWith(['a', 'b'], { title: 'Approval needed', body: 'Waiting for you', data: { notificationId: 'n-u-1', type: 'FINANCE_APPROVAL_NEEDED', actionUrl: '/finance/requests/r-1' } });
    expect(s.send).toHaveBeenCalledWith(['c'], expect.anything());
  });

  it('skips people with no device, and does nothing when push is off', async () => {
    const s = sender();
    await build(s, []).service.dispatch([row('u-1')]);
    expect(s.send).not.toHaveBeenCalled();
    const off = { enabled: false, send: vi.fn() };
    const { service, prisma } = build(off, [{ userId: 'u-1', token: 'a' }]);
    await service.dispatch([row('u-1')]);
    expect(off.send).not.toHaveBeenCalled();
    expect(prisma.devicePushToken.findMany).not.toHaveBeenCalled();
  });

  it('switches off tokens the provider says are gone, and keeps the rest', async () => {
    const s = sender(['a']);
    const { service, prisma } = build(s, [{ userId: 'u-1', token: 'a' }, { userId: 'u-1', token: 'b' }]);
    await service.dispatch([row('u-1')]);
    expect(prisma.devicePushToken.updateMany).toHaveBeenCalledWith({ where: { token: { in: ['a'] } }, data: { isActive: false } });
  });

  it('never throws, so a push failure cannot undo the stored notification', async () => {
    const s = { enabled: true, send: vi.fn().mockRejectedValue(new Error('network down')) };
    const { service } = build(s as never, [{ userId: 'u-1', token: 'a' }]);
    await expect(service.dispatch([row('u-1')])).resolves.toBeUndefined();
  });
});

describe('dataOf', () => {
  it('carries the work order for QC notifications and leaves out what is missing', () => {
    expect(dataOf({ id: 'n', type: 'QC_X', actionUrl: null, workOrderId: 'w-1' })).toEqual({ notificationId: 'n', type: 'QC_X', workOrderId: 'w-1' });
  });
});
