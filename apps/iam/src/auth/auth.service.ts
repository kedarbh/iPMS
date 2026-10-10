import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
// This app's own generated client, not the shared @prisma/client package — see
// the `output` comment in prisma/schema.prisma.
import type { PrismaClient } from '@prisma-clients/iam';
import type { ChangePasswordDto, LoginDto, TokenPair } from '@ipms/contracts';
import { financeOptOutOverrides, resolvePermissions, type AuthzOverride } from '@ipms/authz';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

/**
 * Identical for every failure mode, so responses never reveal whether an
 * email exists. Exported because the controller answers a body the schema
 * refuses with this same message, for the same reason.
 */
export const GENERIC_FAILURE = 'Invalid email or password';

export const CURRENT_PASSWORD_WRONG = 'Your current password is incorrect';

/**
 * Publishes each user's current token version to the shared cache the gateway
 * reads when deciding whether a token has been revoked.
 *
 * Written on every issuance, not only on revocation. The gateway treats a
 * missing entry as "revoked" and refuses the request, which is only safe
 * because this invariant holds: any user who holds a live token has an entry.
 * Were the entry written only by `revokeAll`, a cache eviction or a Redis
 * restart would erase every revocation on record and silently reinstate the
 * tokens it was meant to kill.
 */
export interface TokenVersionStore {
  /** `ttlSeconds` must be at least a refresh token's lifetime, or live sessions expire early. */
  publish(userId: string, tokenVersion: number, ttlSeconds: number): Promise<void>;
}

interface RoleAssignment {
  role: { code: string; isActive: boolean; permissions: Array<{ permission: { code: string } }> };
  validFrom: Date | null;
  validUntil: Date | null;
}

interface OverrideRow {
  permission: { code: string };
  effect: string;
  projectId: string | null;
  siteId: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
}

/**
 * Loaded on both login and refresh, because both mint a `permissions` claim.
 *
 * The finance opt-out reads `financeEnabled` from the user row's scalar
 * columns, which `include` returns. If this is ever changed to a `select` it
 * must name `financeEnabled`, or the opt-out silently stops applying
 * (`claimsFor` is called with `user as never`, so the compiler will not notice).
 */
const USER_INCLUDE = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  overrides: { include: { permission: true } },
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly versions: TokenVersionStore,
  ) {}

  /**
   * Mints a pair and records the version the pair was minted at, in that
   * order. The record is written before the tokens reach the client so there
   * is no window in which a live token has no cache entry — the gateway would
   * refuse it.
   */
  private async issue(
    user: { id: string; tokenVersion: number },
    roles: string[],
    permissions: string[],
    mustChangePassword = false,
  ): Promise<TokenPair> {
    await this.versions.publish(user.id, user.tokenVersion, this.tokens.refreshTtlSeconds);
    return this.tokens.issue(user, roles, permissions, mustChangePassword);
  }

  private isLive(assignment: RoleAssignment, now: Date): boolean {
    if (!assignment.role.isActive) return false;
    if (assignment.validFrom && now < assignment.validFrom) return false;
    if (assignment.validUntil && now > assignment.validUntil) return false;
    return true;
  }

  /**
   * The `roles` and `permissions` claims for a user, with global overrides
   * already applied.
   *
   * Deriving the permission claim from role assignments alone is what made a
   * DENY override cosmetic — the row existed, the audit event fired, both read
   * endpoints reported the suspension, and the token still carried the
   * permission. `resolvePermissions` is shared with `EffectiveService.forUser`
   * so the claim and the report cannot disagree; it also drops project- and
   * site-scoped overrides, which cannot live in a claim that carries no
   * resource (`AuthzGuard`'s `OVERRIDE_PROVIDER` applies those).
   *
   * A change to an override therefore has to bump `tokenVersion` to take effect
   * inside the access token's TTL — `ScopesService` does that in the same
   * transaction as the override write.
   */
  private claimsFor(
    user: { roles: unknown; overrides?: unknown; financeEnabled?: boolean },
    now: Date,
  ): { roles: string[]; permissions: string[] } {
    const live = (user.roles as RoleAssignment[]).filter((a) => this.isLive(a, now));
    const rolePermissions = live.flatMap((a) => a.role.permissions.map((rp) => rp.permission.code));
    const stored: AuthzOverride[] = ((user.overrides ?? []) as OverrideRow[]).map((o) => ({
      permission: o.permission.code,
      effect: o.effect === 'DENY' ? 'DENY' : 'ALLOW',
      projectId: o.projectId,
      siteId: o.siteId,
      validFrom: o.validFrom,
      validUntil: o.validUntil,
    }));
    // A Field Engineer whose own company handles their money holds no finance
    // permission. Synthesised here, never stored; a DENY outranks any role grant
    // or ALLOW override, so nothing else needs to know.
    const overrides = user.financeEnabled === false ? [...stored, ...financeOptOutOverrides()] : stored;

    return {
      roles: [...new Set(live.map((a) => a.role.code))],
      permissions: resolvePermissions(rolePermissions, overrides, now),
    };
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: USER_INCLUDE,
    });

    // Hash a dummy value when the user is missing so response timing does not leak existence.
    if (!user) {
      await this.passwords.verify('$argon2id$v=19$m=19456,t=2,p=1$aaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', dto.password);
      throw new UnauthorizedException(GENERIC_FAILURE);
    }
    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException(GENERIC_FAILURE);
    }
    if (!user.isActive) throw new UnauthorizedException(GENERIC_FAILURE);

    const now = new Date();
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });

    /**
     * An account that owes a password change gets a token with no roles and no
     * permissions.
     *
     * The creator of the account — or the administrator who reset it — knows
     * this password, so the account must be unusable until its holder replaces
     * it. Every service's `AuthzGuard` already refuses a permission absent from
     * the claim, so an empty claim disables every guarded route in the platform
     * with no new enforcement code anywhere. `GET /auth/me` and
     * `POST /auth/change-password` need authentication but no permission, which
     * is exactly the surface the holder needs to fix it.
     */
    if (user.mustChangePassword) return this.issue(user, [], [], true);

    const { roles, permissions } = this.claimsFor(user as never, now);
    return this.issue(user, roles, permissions);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload;
    try {
      // verifyRefresh, not verifyAccess: only a refresh token may be redeemed
      // for a new pair, or a leaked 15-minute access token would roll itself
      // forward indefinitely and never expire.
      payload = this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: USER_INCLUDE,
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid refresh token');

    // A revoked session presents an old version and must not be refreshable.
    if (user.tokenVersion !== payload.tokenVersion) throw new UnauthorizedException('Session revoked');

    // Same branch as login: a refresh must not roll an authority-free token
    // forward into a real one.
    if (user.mustChangePassword) return this.issue(user, [], [], true);

    const now = new Date();
    const { roles, permissions } = this.claimsFor(user as never, now);
    return this.issue(user, roles, permissions);
  }

  /**
   * Invalidates every outstanding token for the user, immediately.
   *
   * Any path that deactivates a user, changes their roles, or ends their
   * session must call this. The gateway trusts the published version to decide
   * revocation and every service's `JwtUserGuard` populates
   * `AuthzUser.isActive` as `true` on the strength of a valid token, so a
   * deactivation that skips this leaves the account usable until its token
   * expires.
   */
  async revokeAll(userId: string): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await this.versions.publish(userId, updated.tokenVersion, this.tokens.refreshTtlSeconds);
  }

  /**
   * Self-service password change. Requires authentication but no permission,
   * which is what keeps it reachable by a holder whose token carries neither.
   *
   * Ends by revoking every session, including the caller's own. That is
   * deliberate: their current token carries no authority, and signing in again
   * is the only way to obtain one that does.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException(GENERIC_FAILURE);

    // 400, not 401. The caller is already authenticated, so there is no
    // email to protect, and every client reads a 401 as "session expired":
    // the web app answered one by sending the user to sign in, which looked
    // exactly like a successful change.
    if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw new BadRequestException(CURRENT_PASSWORD_WRONG);
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('The new password must differ from the current one');
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    await this.revokeAll(userId);
  }
}
