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
