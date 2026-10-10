import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const getRequest = vi.fn();
vi.mock('../lib/finance-api', () => ({ getRequest }));
const { DecidedNotice } = await import('./decided');

const ID = '0192f7a0-0000-7000-8000-000000000001';
const detail = { number: 'ADV-2026-0012', actions: [{ id: 'a', requestId: ID, revision: 1, step: 'DIRECTOR', action: 'APPROVED', actorId: 'u-dir', amount: '40000.00', comment: null, at: '2026-10-10T06:00:00Z' }] };

beforeEach(() => { getRequest.mockReset().mockResolvedValue({ state: 'ready', data: detail }); });

describe('DecidedNotice', () => {
  it('confirms the decision from a fresh read of the request', async () => {
    const out = renderToStaticMarkup(await DecidedNotice({ id: ID, viewerId: 'u-dir' }));
    expect(getRequest).toHaveBeenCalledWith(ID);
    expect(out).toContain('ADV-2026-0012 approved for NPR 40,000.00.');
    expect(out).toContain('role="status"');
  });

  it('renders nothing for no id, an id that is not a uuid, or a request that cannot be read', async () => {
    expect(await DecidedNotice({ id: undefined, viewerId: 'u-dir' })).toBeNull();
    expect(await DecidedNotice({ id: '../overview', viewerId: 'u-dir' })).toBeNull();
    expect(getRequest).not.toHaveBeenCalled();
    getRequest.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    expect(await DecidedNotice({ id: ID, viewerId: 'u-dir' })).toBeNull();
  });
});
