import { describe, expect, it, vi } from 'vitest';
import { EffectiveService } from './effective.service.js';
import { uuidv7 } from '@ipms/contracts';
import { FINANCE_OPT_OUT_REASON } from '@ipms/authz';

const USER = uuidv7();
const FUTURE = new Date('2027-01-01T00:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');

function build(overrides: unknown[] = [], globalScopes: unknown[] = []) {
  const user = {
    id: USER, isActive: true, tokenVersion: 0,
    globalScopes,
    roles: [{
      role: { code: 'FIELD_ENGINEER', isActive: true, permissions: [
        { permission: { code: 'task.view' } }, { permission: { code: 'task.update' } },
      ] },
      validFrom: null, validUntil: null,
    }],
    projectScopes: [{ projectId: 'p-1' }],
    siteScopes: [{ siteId: 's-1' }],
    overrides,
  };
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } };
  return { service: new EffectiveService(prisma as never), prisma };
}

describe('EffectiveService.forUser', () => {
  it('lists permissions granted by roles with their source', async () => {
    const { service } = build();
    const result = await service.forUser(USER);
    const taskView = result.find((p) => p.code === 'task.view');
    expect(taskView).toMatchObject({ granted: true, source: 'ROLE', sourceDetail: 'FIELD_ENGINEER' });
  });

  it('adds a permission granted by a live ALLOW override', async () => {
    const { service } = build([{
      permission: { code: 'qc_review.approve' }, effect: 'ALLOW',
      projectId: null, siteId: null, validFrom: null, validUntil: FUTURE, reason: 'cover',
    }]);
    const result = await service.forUser(USER);
    expect(result.find((p) => p.code === 'qc_review.approve')).toMatchObject({
      granted: true, source: 'OVERRIDE_ALLOW',
    });
  });

  it('marks a permission denied by an override as not granted', async () => {
    const { service } = build([{
      permission: { code: 'task.update' }, effect: 'DENY',
      projectId: null, siteId: null, validFrom: null, validUntil: null, reason: 'suspended',
    }]);
    const result = await service.forUser(USER);
    expect(result.find((p) => p.code === 'task.update')).toMatchObject({
      granted: false, source: 'OVERRIDE_DENY',
    });
  });

  it('ignores an expired override', async () => {
    const { service } = build([{
      permission: { code: 'qc_review.approve' }, effect: 'ALLOW',
      projectId: null, siteId: null, validFrom: null, validUntil: PAST, reason: 'old',
    }]);
    const result = await service.forUser(USER);
    expect(result.find((p) => p.code === 'qc_review.approve')).toBeUndefined();
  });

  it('reports the scope level a permission is effective at', async () => {
    const { service } = build();
    const result = await service.forUser(USER);
    expect(result.find((p) => p.code === 'task.view')!.scopeLevel).toBe('SITE');
  });
});

/**
 * This screen is what an operator reads to confirm a suspension took effect, so
 * it must not give a different answer from `POST /access/check` or from the
 * guard. `forUser` resolved conflicting overrides last-one-wins: with an ALLOW
 * and a DENY on one code it reported whichever row Prisma returned last, so the
 * same user was `granted: true` here and `DENIED_BY_OVERRIDE` there. No existing
 * test supplied both rows, which is how it survived. Both now route through
 * `resolvePermissions`, whose DENY pass runs second and unconditionally.
 */
describe('EffectiveService.forUser — conflicting overrides', () => {
  const allow = {
    permission: { code: 'qc_review.approve' }, effect: 'ALLOW',
    projectId: null, siteId: null, validFrom: null, validUntil: null, reason: 'cover',
  };
  const deny = {
    permission: { code: 'qc_review.approve' }, effect: 'DENY',
    projectId: null, siteId: null, validFrom: null, validUntil: null, reason: 'suspended pending review',
  };

  it('reports DENY over ALLOW when the DENY row sorts first', async () => {
    const { service } = build([deny, allow]);
    expect((await service.forUser(USER)).find((p) => p.code === 'qc_review.approve')).toMatchObject({
      granted: false, source: 'OVERRIDE_DENY',
    });
  });

  it('reports DENY over ALLOW when the ALLOW row sorts last', async () => {
    const { service } = build([allow, deny]);
    expect((await service.forUser(USER)).find((p) => p.code === 'qc_review.approve')).toMatchObject({
      granted: false, source: 'OVERRIDE_DENY',
    });
  });

  it('reports a global DENY over a project ALLOW, agreeing with POST /access/check', async () => {
    const overrides = [{ ...allow, projectId: 'p-1' }, deny];
    const { service } = build(overrides);

    const reported = (await service.forUser(USER)).find((p) => p.code === 'qc_review.approve');
    const simulated = await service.simulate({ userId: USER, permissionCode: 'qc_review.approve' });

    expect(reported).toMatchObject({ granted: false, source: 'OVERRIDE_DENY' });
    expect(simulated.reason).toBe('DENIED_BY_OVERRIDE');
  });

  it('lets a global DENY strip a role-granted permission', async () => {
    const { service } = build([{ ...deny, permission: { code: 'task.update' } }]);
    expect((await service.forUser(USER)).find((p) => p.code === 'task.update')).toMatchObject({
      granted: false, source: 'OVERRIDE_DENY',
    });
  });

  it('carries the DENY reason as the source detail, not the ALLOW reason', async () => {
    const { service } = build([allow, deny]);
    expect((await service.forUser(USER)).find((p) => p.code === 'qc_review.approve')?.sourceDetail)
      .toBe('suspended pending review');
  });
});

describe('EffectiveService.simulate', () => {
  it('grants when the user holds the permission', async () => {
    const { service } = build();
    const result = await service.simulate({ userId: USER, permissionCode: 'task.view' });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('ALLOWED');
  });

  it('denies and names the reason when the permission is missing', async () => {
    const { service } = build();
    const result = await service.simulate({ userId: USER, permissionCode: 'task.delete' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('PERMISSION_MISSING');
  });

  it('returns the full ordered check chain for troubleshooting', async () => {
    const { service } = build();
    const result = await service.simulate({ userId: USER, permissionCode: 'task.view' });
    expect(result.checks.map((c) => c.name)).toEqual(['account_active', 'no_deny_override', 'permission_held']);
  });

  it('denies a deactivated user before anything else', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({
      id: USER, isActive: false, tokenVersion: 0, roles: [], globalScopes: [], projectScopes: [], siteScopes: [], overrides: [],
    });
    const result = await service.simulate({ userId: USER, permissionCode: 'task.view' });
    expect(result.reason).toBe('USER_INACTIVE');
  });

  it('reflects a DENY override in the simulation', async () => {
    const { service } = build([{
      permission: { code: 'task.update' }, effect: 'DENY',
      projectId: null, siteId: null, validFrom: null, validUntil: null, reason: 'suspended',
    }]);
    const result = await service.simulate({ userId: USER, permissionCode: 'task.update' });
    expect(result.reason).toBe('DENIED_BY_OVERRIDE');
  });
});

/**
 * `simulate` accepted `resourceType`/`resourceId` and silently discarded them,
 * then answered the unscoped question instead — reporting `allowed: true` for a
 * resource a real request would refuse with `OUT_OF_PROJECT_SCOPE`, because
 * project scope, assignment and resource state all live with the owning
 * service. Answering a narrower question with a broader, permissive result is
 * worse than refusing to answer.
 */
describe('EffectiveService.simulate — resource-scoped requests', () => {
  it('does not report a resource-scoped check as allowed', async () => {
    const { service } = build();
    const result = await service.simulate({
      userId: USER, permissionCode: 'task.view', resourceType: 'Task', resourceId: uuidv7(),
    });
    expect(result.allowed).toBe(false);
  });

  it('names the resource as the part it could not evaluate', async () => {
    const { service } = build();
    const result = await service.simulate({
      userId: USER, permissionCode: 'task.view', resourceType: 'Task', resourceId: uuidv7(),
    });
    expect(result.reason).toBe('RESOURCE_NOT_EVALUATED');
    const last = result.checks.at(-1);
    expect(last?.passed).toBe(false);
    expect(last?.detail).toMatch(/owning service/i);
  });

  it('still returns the identity and permission chain it could evaluate', async () => {
    const { service } = build();
    const result = await service.simulate({
      userId: USER, permissionCode: 'task.view', resourceType: 'Task', resourceId: uuidv7(),
    });
    expect(result.checks.map((c) => c.name)).toContain('permission_held');
  });

  it('reports a failure that precedes the resource, rather than the resource gap', async () => {
    const { service } = build();
    const result = await service.simulate({
      userId: USER, permissionCode: 'task.delete', resourceType: 'Task', resourceId: uuidv7(),
    });
    expect(result.reason).toBe('PERMISSION_MISSING');
  });

  it('answers a request with a resourceType but no resourceId normally', async () => {
    const { service } = build();
    const result = await service.simulate({
      userId: USER, permissionCode: 'task.view', resourceType: 'Task',
    });
    expect(result.allowed).toBe(true);
  });
});

/**
 * A Field Engineer whose own company handles their money. The effective read,
 * the simulator and `holders` must all say what the token says: no finance.
 */
describe('EffectiveService — finance switched off', () => {
  function buildEngineer(financeEnabled: boolean) {
    const user = {
      id: USER, isActive: true, tokenVersion: 0, financeEnabled,
      globalScopes: [],
      roles: [{
        role: {
          code: 'FIELD_ENGINEER', isActive: true,
          permissions: [
            { permission: { code: 'task.view' } },
            { permission: { code: 'finance_request.view' } },
            { permission: { code: 'finance_request.create' } },
          ],
        },
        validFrom: null, validUntil: null,
      }],
      projectScopes: [{ projectId: 'p-1' }],
      siteScopes: [],
      overrides: [],
    };
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user), findMany: vi.fn().mockResolvedValue([user]) } };
    return new EffectiveService(prisma as never);
  }

  it('reports each finance permission as denied, with the reason', async () => {
    const result = await buildEngineer(false).forUser(USER);
    expect(result.find((p) => p.code === 'finance_request.create')).toMatchObject({
      granted: false, source: 'OVERRIDE_DENY', sourceDetail: FINANCE_OPT_OUT_REASON,
    });
    expect(result.find((p) => p.code === 'finance_request.view')).toMatchObject({ granted: false });
  });

  it('still grants everything that is not finance', async () => {
    const result = await buildEngineer(false).forUser(USER);
    expect(result.find((p) => p.code === 'task.view')).toMatchObject({ granted: true, source: 'ROLE' });
  });

  it('leaves finance granted when the switch is on', async () => {
    const result = await buildEngineer(true).forUser(USER);
    expect(result.find((p) => p.code === 'finance_request.create')).toMatchObject({ granted: true, source: 'ROLE' });
  });

  it('refuses a finance permission in the simulator', async () => {
    const result = await buildEngineer(false).simulate({ userId: USER, permissionCode: 'finance_request.create' });
    expect(result).toMatchObject({ allowed: false, reason: 'DENIED_BY_OVERRIDE' });
  });

  it('allows the same permission in the simulator when the switch is on', async () => {
    const result = await buildEngineer(true).simulate({ userId: USER, permissionCode: 'finance_request.create' });
    expect(result.allowed).toBe(true);
  });

  it('never lists such an engineer as a holder of a finance permission', async () => {
    expect(await buildEngineer(false).holders('finance_request.view', 'p-1')).toEqual([]);
    expect(await buildEngineer(true).holders('finance_request.view', 'p-1')).toEqual([USER]);
  });
});
