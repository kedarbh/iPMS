import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService, CURRENT_PASSWORD_WRONG } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { uuidv7 } from '@ipms/contracts';

const passwords = new PasswordService();
const tokens = new TokenService({ secret: 'a'.repeat(32), accessTtl: 900, refreshTtl: 2_592_000 });

async function build(userOverrides: Record<string, unknown> = {}) {
  const user = {
    id: uuidv7(), email: 'engineer@ipms.local', isActive: true, tokenVersion: 0,
    passwordHash: await passwords.hash('demo12345'),
    roles: [{ role: { code: 'FIELD_ENGINEER', isActive: true, permissions: [{ permission: { code: 'task.view' } }] },
             validFrom: null, validUntil: null }],
    overrides: [],
    ...userOverrides,
  };
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({ ...user, tokenVersion: (user['tokenVersion'] as number) + 1 }),
    },
  };
  const versions = { publish: vi.fn().mockResolvedValue(undefined) };
  return { service: new AuthService(prisma as never, passwords, tokens, versions), prisma, versions, user };
}

describe('AuthService.login', () => {
  it('returns a token pair for valid credentials', async () => {
    const { service } = await build();
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(pair.accessToken).toBeTruthy();
  });

  it('embeds the permissions derived from active roles', async () => {
    const { service } = await build();
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('task.view');
  });

  it('rejects a wrong password with 401', async () => {
    const { service } = await build();
    await expect(service.login({ email: 'engineer@ipms.local', password: 'wrong-password' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown user with 401', async () => {
    const { service, prisma } = await build();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login({ email: 'ghost@ipms.local', password: 'demo12345' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('gives the same message for unknown user and wrong password, to avoid enumeration', async () => {
    const { service, prisma } = await build();
    const wrongPassword = await service.login({ email: 'engineer@ipms.local', password: 'wrong-password' }).catch((e: Error) => e.message);
    prisma.user.findUnique.mockResolvedValue(null);
    const unknownUser = await service.login({ email: 'ghost@ipms.local', password: 'demo12345' }).catch((e: Error) => e.message);
    expect(wrongPassword).toBe(unknownUser);
  });

  it('rejects a deactivated user', async () => {
    const { service } = await build({ isActive: false });
    await expect(service.login({ email: 'engineer@ipms.local', password: 'demo12345' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('excludes permissions from an expired role assignment', async () => {
    const { service } = await build({
      roles: [{
        role: { code: 'QC_MANAGER', isActive: true, permissions: [{ permission: { code: 'qc_review.approve' } }] },
        validFrom: null, validUntil: new Date('2026-01-01T00:00:00Z'),
      }],
    });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).not.toContain('qc_review.approve');
  });

  it('excludes permissions from an inactive role', async () => {
    const { service } = await build({
      roles: [{
        role: { code: 'QC_MANAGER', isActive: false, permissions: [{ permission: { code: 'qc_review.approve' } }] },
        validFrom: null, validUntil: null,
      }],
    });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toEqual([]);
  });
});

/**
 * The JWT `permissions` claim is where the architecture puts permission codes,
 * so it is where a global override has to land. Deriving the claim from role
 * assignments alone is what made a DENY override cosmetic: the row was written
 * and audited, both read endpoints reported the suspension, and the user's token
 * still carried the permission.
 */
function globalOverride(
  code: string, effect: 'ALLOW' | 'DENY', extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    permission: { code }, effect,
    projectId: null, siteId: null, validFrom: null, validUntil: null, reason: 'test', ...extra,
  };
}

describe('AuthService — overrides in the permission claim', () => {
  it('drops a role-granted permission denied by a live global override', async () => {
    const { service } = await build({ overrides: [globalOverride('task.view', 'DENY')] });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).not.toContain('task.view');
  });

  it('adds a permission granted by a live global ALLOW override', async () => {
    const { service } = await build({ overrides: [globalOverride('qc_review.approve', 'ALLOW')] });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('qc_review.approve');
  });

  it('lets a DENY win over an ALLOW for the same permission', async () => {
    const { service } = await build({
      overrides: [
        globalOverride('qc_review.approve', 'ALLOW'),
        globalOverride('qc_review.approve', 'DENY'),
      ],
    });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).not.toContain('qc_review.approve');
  });

  it('ignores an expired override', async () => {
    const { service } = await build({
      overrides: [globalOverride('task.view', 'DENY', { validUntil: new Date('2026-01-01T00:00:00Z') })],
    });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('task.view');
  });

  /**
   * A project-scoped override must not reach the claim: the claim carries no
   * resource, so folding one in would apply it in every project. Those are
   * enforced by `AuthzGuard` through `OVERRIDE_PROVIDER`, where a resource is
   * in hand.
   */
  it('leaves a project-scoped override out of the claim', async () => {
    const { service } = await build({
      overrides: [globalOverride('task.view', 'DENY', { projectId: 'p-1' })],
    });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('task.view');
  });

  it('applies overrides on refresh too, not only on login', async () => {
    const { service, prisma, user } = await build();
    const { refreshToken } = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    prisma.user.findUnique.mockResolvedValue({ ...user, overrides: [globalOverride('task.view', 'DENY')] });
    const pair = await service.refresh(refreshToken);
    expect(tokens.verifyAccess(pair.accessToken).permissions).not.toContain('task.view');
  });
});

describe('AuthService.revokeAll', () => {
  it('bumps the token version and publishes it', async () => {
    const { service, prisma, versions, user } = await build();
    await service.revokeAll(user.id as string);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tokenVersion: { increment: 1 } } }),
    );
    expect(versions.publish).toHaveBeenCalled();
  });

  it('publishes the incremented version, not the stale one', async () => {
    const { service, versions, user } = await build({ tokenVersion: 4 });
    await service.revokeAll(user.id as string);
    expect(versions.publish).toHaveBeenCalledWith(user.id, 5, expect.any(Number));
  });
});

/**
 * The gateway refuses any token whose user has no published version, so the
 * cache entry is not an optimisation — it is a precondition for the token
 * being usable at all. Publishing only on revocation (the original shape) meant
 * a Redis eviction or restart erased every revocation on record and quietly
 * reinstated the tokens it was meant to kill.
 */
describe('AuthService — session version publication', () => {
  it('publishes the token version on login, not only on revocation', async () => {
    const { service, versions, user } = await build({ tokenVersion: 2 });
    await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(versions.publish).toHaveBeenCalledWith(user.id, 2, expect.any(Number));
  });

  it('publishes the token version on refresh too', async () => {
    const { service, versions, user } = await build({ tokenVersion: 2 });
    const { refreshToken } = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    versions.publish.mockClear();
    await service.refresh(refreshToken);
    expect(versions.publish).toHaveBeenCalledWith(user.id, 2, expect.any(Number));
  });

  it('gives the entry a TTL at least as long as a refresh token lives', async () => {
    const { service, versions } = await build();
    await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    const ttl = versions.publish.mock.calls[0]?.[2] as number;
    expect(ttl).toBeGreaterThanOrEqual(2_592_000);
  });
});

describe('AuthService.refresh', () => {
  it('rejects an access token presented as a refresh token', async () => {
    const { service } = await build();
    const { accessToken } = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    await expect(service.refresh(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token whose version no longer matches the user', async () => {
    const { service, prisma, user } = await build({ tokenVersion: 1 });
    const { refreshToken } = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    prisma.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 2 });
    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token for a user deactivated since it was issued', async () => {
    const { service, prisma, user } = await build();
    const { refreshToken } = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false });
    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues a fresh pair for a valid refresh token', async () => {
    const { service } = await build();
    const { refreshToken } = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    const pair = await service.refresh(refreshToken);
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('task.view');
  });
});

/**
 * The creator of an account knows its password, so the account must carry no
 * authority until its holder replaces it. Minting an empty claim is what makes
 * that an enforced rule rather than a browser-side suggestion: every AuthzGuard
 * already refuses a permission absent from the claim, so no new enforcement
 * code exists anywhere to be forgotten.
 */
describe('AuthService and mustChangePassword', () => {
  it('issues a token with no roles and no permissions', async () => {
    const { service } = await build({ mustChangePassword: true });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    const claims = tokens.verifyAccess(pair.accessToken);
    expect(claims.roles).toEqual([]);
    expect(claims.permissions).toEqual([]);
    expect(claims.mustChangePassword).toBe(true);
  });

  it('reports the flag on the pair so the browser can redirect at login', async () => {
    const { service } = await build({ mustChangePassword: true });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(pair.mustChangePassword).toBe(true);
  });

  it('keeps the branch on refresh, so the token cannot be rolled forward into a real one', async () => {
    const { service } = await build({ mustChangePassword: true });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    const refreshed = await service.refresh(pair.refreshToken);
    expect(tokens.verifyAccess(refreshed.accessToken).permissions).toEqual([]);
  });

  it('issues a normal token once the flag is clear', async () => {
    const { service } = await build();
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    const claims = tokens.verifyAccess(pair.accessToken);
    expect(claims.permissions).toContain('task.view');
    expect(claims.mustChangePassword).toBeUndefined();
  });
});

describe('AuthService.changePassword', () => {
  // A 400 the form can show, not a 401 every client reads as an expired session.
  it('refuses a wrong current password without touching the row', async () => {
    const { service, prisma, user } = await build();
    await expect(service.changePassword(user.id as string, {
      currentPassword: 'not-the-password', newPassword: 'Long-enough-1',
    })).rejects.toThrow(new BadRequestException(CURRENT_PASSWORD_WRONG));
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses a new password identical to the current one', async () => {
    const { service, prisma, user } = await build();
    await expect(service.changePassword(user.id as string, {
      currentPassword: 'demo12345', newPassword: 'demo12345',
    })).rejects.toThrow(/must differ/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('stores a new hash and clears the flag', async () => {
    const { service, prisma, user } = await build({ mustChangePassword: true });
    await service.changePassword(user.id as string, {
      currentPassword: 'demo12345', newPassword: 'Long-enough-1',
    });
    const data = prisma.user.update.mock.calls[0]![0].data;
    expect(data.mustChangePassword).toBe(false);
    expect(await passwords.verify(data.passwordHash as string, 'Long-enough-1')).toBe(true);
  });

  // The bump kills the caller's own token, which is the point: the next sign-in
  // is the only way to obtain one carrying their real permissions.
  it('revokes every outstanding session', async () => {
    const { service, versions, user } = await build();
    await service.changePassword(user.id as string, {
      currentPassword: 'demo12345', newPassword: 'Long-enough-1',
    });
    expect(versions.publish).toHaveBeenCalled();
  });

  it('refuses a deactivated user', async () => {
    const { service, user } = await build({ isActive: false });
    await expect(service.changePassword(user.id as string, {
      currentPassword: 'demo12345', newPassword: 'Long-enough-1',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

/**
 * A Field Engineer whose own company handles their money gets a token with no
 * finance permission in it, so every service's guard refuses finance for them
 * without a line of finance-specific code. A DENY outranks the role grant.
 */
describe('AuthService and the finance switch', () => {
  const ENGINEER_ROLE = {
    role: {
      code: 'FIELD_ENGINEER', isActive: true,
      permissions: [
        { permission: { code: 'task.view' } },
        { permission: { code: 'finance_request.view' } },
        { permission: { code: 'finance_request.create' } },
        { permission: { code: 'finance_settlement.submit' } },
      ],
    },
    validFrom: null, validUntil: null,
  };

  it('keeps finance in the token when the switch is on', async () => {
    const { service } = await build({ roles: [ENGINEER_ROLE], financeEnabled: true });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('finance_request.create');
  });

  it('keeps finance in the token for a row that predates the switch', async () => {
    const { service } = await build({ roles: [ENGINEER_ROLE] });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('finance_request.create');
  });

  it('leaves every finance permission out of the token, and keeps the rest', async () => {
    const { service } = await build({ roles: [ENGINEER_ROLE], financeEnabled: false });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toEqual(['task.view']);
  });

  it('leaves finance out after a refresh as well', async () => {
    const { service } = await build({ roles: [ENGINEER_ROLE], financeEnabled: false });
    const { refreshToken } = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    const pair = await service.refresh(refreshToken);
    expect(tokens.verifyAccess(pair.accessToken).permissions).toEqual(['task.view']);
  });
});
