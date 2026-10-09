import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '@ipms/authz';
import { NotificationController } from './notification.controller.js';

const reflectMetadata = Reflect as unknown as { getMetadata(key: string, target: object): unknown };
const ME = 'u-1';
const ID = '0192f7a0-0000-7000-8000-000000000001';

function build() {
  const service = {
    list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    unreadCount: vi.fn().mockResolvedValue(4),
    markRead: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(2),
  };
  const push = { register: vi.fn().mockResolvedValue(undefined), unregister: vi.fn().mockResolvedValue(undefined) };
  return { controller: new NotificationController(service as never, push as never), service, push };
}

describe('NotificationController push tokens', () => {
  const TOKEN = 'fcm-token-0123456789abcdef0123456789';

  it('registers a device for the caller only', async () => {
    const { controller, push } = build();
    await controller.registerPushToken(ME, { token: TOKEN, platform: 'ANDROID' });
    expect(push.register).toHaveBeenCalledWith(ME, { token: TOKEN, platform: 'ANDROID' });
  });

  it('refuses a token that is too short, an unknown platform, or extra fields', async () => {
    const { controller } = build();
    await expect(controller.registerPushToken(ME, { token: 'x', platform: 'ANDROID' })).rejects.toThrow();
    await expect(controller.registerPushToken(ME, { token: TOKEN, platform: 'WINDOWS' })).rejects.toThrow();
    await expect(controller.registerPushToken(ME, { token: TOKEN, platform: 'IOS', userId: 'someone-else' })).rejects.toThrow();
  });

  it('unregisters a device for the caller only', async () => {
    const { controller, push } = build();
    await controller.unregisterPushToken(ME, { token: TOKEN });
    expect(push.unregister).toHaveBeenCalledWith(ME, TOKEN);
  });
});

describe('NotificationController', () => {
  it('lists for the caller, parsing the query string', async () => {
    const { controller, service } = build();
    await controller.list(ME, { limit: '5', unreadOnly: 'true' });
    expect(service.list).toHaveBeenCalledWith(ME, { limit: 5, unreadOnly: true });
  });

  it('refuses an out-of-range limit', async () => {
    const { controller } = build();
    await expect(controller.list(ME, { limit: '500' })).rejects.toThrow();
  });

  it('reports the caller’s unread count', async () => {
    const { controller } = build();
    expect(await controller.unreadCount(ME)).toEqual({ count: 4 });
  });

  it('marks one read for the caller', async () => {
    const { controller, service } = build();
    await controller.markRead(ME, ID);
    expect(service.markRead).toHaveBeenCalledWith(ME, ID);
  });

  it('refuses an id that is not a UUID before touching the service', async () => {
    const { controller, service } = build();
    await expect(controller.markRead(ME, 'nope')).rejects.toThrow();
    expect(service.markRead).not.toHaveBeenCalled();
  });

  it('marks all read and reports how many changed', async () => {
    const { controller } = build();
    expect(await controller.markAllRead(ME)).toEqual({ updated: 2 });
  });

  // These routes carry no @RequirePermission: any signed-in user may read their own
  // notifications. That is only safe while none is @Public, so pin it.
  it('leaves every route behind the token guard', () => {
    expect(reflectMetadata.getMetadata(IS_PUBLIC_KEY, NotificationController)).toBeUndefined();
    for (const handler of ['list', 'unreadCount', 'markRead', 'markAllRead'] as const) {
      expect(reflectMetadata.getMetadata(IS_PUBLIC_KEY, NotificationController.prototype[handler])).toBeUndefined();
    }
  });
});
