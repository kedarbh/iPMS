import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { ACTORS, PROJECT, scopes } from '../../prisma/fixtures.js';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@ipms/observability', () => ({ createLogger: () => ({ warn }) }));
vi.mock('./context.js', () => ({ decisionContext: vi.fn().mockRejectedValue(new Error('context blew up')) }));

const { QueryService } = await import('./query.service.js');

const money = (value: string) => ({ toFixed: () => value });

const pendingAdvance = {
  id: '0190a7a0-0000-7000-8000-0000000000b1', number: 'ADV-2026-0001', kind: 'ADVANCE', status: 'PENDING_PM', revision: 1, entryStatus: 'PENDING_PM',
  projectId: PROJECT.id, projectCode: PROJECT.code, projectName: PROJECT.name, workOrderId: null, categoryId: '0190a7a0-0000-7000-8000-0000000000c1',
  requesterId: '0190a7a0-0000-7000-8000-0000000000d1', advanceId: null, purpose: 'Travel',
  requestedAmount: money('1000.00'), approvedAmount: null, appliedAmount: null,
  submittedAt: new Date('2026-10-09T05:00:00Z'), createdAt: new Date('2026-10-09T04:00:00Z'), updatedAt: new Date('2026-10-09T05:00:00Z'),
  invoices: [], actions: [], payments: [], category: { code: 'TRV', name: 'Travel' },
};

describe('QueryService.get', () => {
  it('still returns the request when the decision context cannot be built', async () => {
    const prisma = { financeRequest: { findUnique: vi.fn().mockResolvedValue(pendingAdvance) } } as unknown as PrismaClient;
    const detail = await new QueryService(prisma).get(pendingAdvance.id, ACTORS.pm, scopes.project);

    expect(detail.id).toBe(pendingAdvance.id);
    expect(detail).not.toHaveProperty('context');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('QueryService.list order', () => {
  const row = (id: string, status: string) => ({ ...pendingAdvance, id, status, requesterId: ACTORS.engineer.id });
  /** Five requests waiting on the caller and seven not; `findMany` answers from whichever set the where names. */
  function build() {
    const first = Array.from({ length: 5 }, (_, i) => row(`a${i}`, 'RETURNED'));
    const rest = Array.from({ length: 7 }, (_, i) => row(`b${i}`, 'PENDING_PM'));
    const isAction = (where: { AND: unknown[] }) => !('NOT' in (where.AND[1] as object));
    const findMany = vi.fn(async ({ where, skip, take }: { where: { AND: unknown[] }; skip: number; take: number }) =>
      (isAction(where) ? first : rest).slice(skip, skip + take));
    const count = vi.fn(async ({ where }: { where: { AND: unknown[] } }) => (isAction(where) ? first : rest).length);
    const prisma = { financeRequest: { findMany, count } } as unknown as PrismaClient;
    return { svc: new QueryService(prisma), findMany };
  }

  it('lists what waits on the caller before the rest, latest change first', async () => {
    const { svc, findMany } = build();
    const page = await svc.list(ACTORS.engineer, scopes.project, { view: 'mine', page: 1, limit: 3 });
    expect(page.items.map((r) => r.id)).toEqual(['a0', 'a1', 'a2']);
    expect(page.total).toBe(12);
    expect(findMany.mock.calls[0]![0]).toMatchObject({ orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] });
  });

  it('carries on into the rest across a page boundary', async () => {
    const { svc } = build();
    const second = await svc.list(ACTORS.engineer, scopes.project, { view: 'mine', page: 2, limit: 3 });
    expect(second.items.map((r) => r.id)).toEqual(['a3', 'a4', 'b0']);
    const third = await svc.list(ACTORS.engineer, scopes.project, { view: 'mine', page: 3, limit: 3 });
    expect(third.items.map((r) => r.id)).toEqual(['b1', 'b2', 'b3']);
  });
});
