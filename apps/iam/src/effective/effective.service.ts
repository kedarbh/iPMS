import { Injectable, NotFoundException } from '@nestjs/common';
// This app's own generated client, not the shared @prisma/client package — see
// the `output` comment in prisma/schema.prisma.
import type { PrismaClient } from '@prisma-clients/iam';
import {
  check, FINANCE_OPT_OUT_REASON, financeOptOutOverrides, resolvePermissions,
  type AuthzOverride, type AuthzResource, type AuthzScope, type AuthzUser,
} from '@ipms/authz';
import type { AccessCheckDto, AccessCheckResult, EffectivePermission } from '@ipms/contracts';

/** Everything `check()` needs about one user; shared by `load` and `holders`. */
const USER_INCLUDE = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  globalScopes: true,
  projectScopes: true,
  siteScopes: true,
  overrides: { include: { permission: true } },
} as const;

interface LoadedUser {
  id: string;
  isActive: boolean;
  tokenVersion: number;
  /** Absent on a row that predates the column; only an explicit false opts out. */
  financeEnabled?: boolean;
  roles: Array<{
    role: { code: string; isActive: boolean; permissions: Array<{ permission: { code: string } }> };
    validFrom: Date | null; validUntil: Date | null;
  }>;
  globalScopes: Array<{ id: string }>;
  projectScopes: Array<{ projectId: string; expiresAt?: Date | null }>;
  siteScopes: Array<{ siteId: string }>;
  overrides: Array<{
    permission: { code: string }; effect: string;
    projectId: string | null; siteId: string | null;
    validFrom: Date | null; validUntil: Date | null; reason: string;
  }>;
}

function isLive(validFrom: Date | null, validUntil: Date | null, now: Date): boolean {
  if (validFrom && now < validFrom) return false;
  if (validUntil && now > validUntil) return false;
  return true;
}

/**
 * A Field Engineer whose own company handles their money gets a global DENY on
 * every finance permission, appended to their overrides in memory. Everything
 * downstream (`forUser`, `simulate`, `holders`, `check()`) already honours a
 * DENY over any role grant, so none of it needs to know why. Matches the token
 * claim, which applies the same overrides in `AuthService.claimsFor`.
 */
function withFinanceOptOut(user: LoadedUser): LoadedUser {
  if (user.financeEnabled !== false) return user;
  const denied = financeOptOutOverrides().map((o) => ({
    permission: { code: o.permission }, effect: o.effect,
    projectId: null, siteId: null, validFrom: null, validUntil: null,
    reason: FINANCE_OPT_OUT_REASON,
  }));
  return { ...user, overrides: [...user.overrides, ...denied] };
}

@Injectable()
export class EffectiveService {
  constructor(private readonly prisma: PrismaClient) {}

  private async load(userId: string): Promise<LoadedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: USER_INCLUDE,
    });
    if (!user) throw new NotFoundException('User not found');
    return withFinanceOptOut(user as unknown as LoadedUser);
  }

  private toAuthzUser(user: LoadedUser, now: Date): AuthzUser {
    const live = user.roles.filter((a) => a.role.isActive && isLive(a.validFrom, a.validUntil, now));
    return {
      id: user.id,
      isActive: user.isActive,
      tokenVersion: user.tokenVersion,
      roles: [...new Set(live.map((a) => a.role.code))],
      permissions: [...new Set(live.flatMap((a) => a.role.permissions.map((rp) => rp.permission.code)))],
    };
  }

  private toScope(user: LoadedUser, now: Date = new Date()): AuthzScope {
    return {
      // Was hardcoded `false`, which meant nothing in the platform ever had
      // global reach. No service noticed because none enforced scope at query
      // level; `project` is the first, and a hardcoded false locks the
      // SUPER_ADMIN out of the system it administers.
      global: user.globalScopes.length > 0,
      projectIds: user.projectScopes.filter((s) => !s.expiresAt || s.expiresAt > now).map((s) => s.projectId),
      siteIds: user.siteScopes.map((s) => s.siteId),
    };
  }

  private toOverrides(user: LoadedUser, now: Date): AuthzOverride[] {
    return user.overrides
      .filter((o) => isLive(o.validFrom, o.validUntil, now))
      .map((o) => ({
        permission: o.permission.code,
        effect: o.effect as 'ALLOW' | 'DENY',
        projectId: o.projectId,
        siteId: o.siteId,
        validFrom: o.validFrom,
        validUntil: o.validUntil,
      }));
  }

  /**
   * Every effective permission with the source that produced it.
   *
   * An operator reads this to confirm a suspension took effect, so it must
   * never disagree with `simulate` or with the guard. It resolved conflicting
   * overrides last-one-wins, which meant an ALLOW and a DENY on one code
   * produced whichever row the database happened to return last — reported
   * `granted: true` here while `POST /access/check` said `DENIED_BY_OVERRIDE`.
   *
   * Global overrides are now resolved by `resolvePermissions`, the same
   * function that builds the JWT `permissions` claim, so the report, the token
   * and `check()` all apply DENY last and unconditionally. Attribution follows
   * the same rule: a live DENY is the reported source even when an ALLOW exists
   * for the same code.
   */
  async forUser(userId: string): Promise<EffectivePermission[]> {
    const now = new Date();
    const user = await this.load(userId);
    const scope = this.toScope(user);
    const scopeLevel = scope.siteIds.length > 0 ? 'SITE' : scope.projectIds.length > 0 ? 'PROJECT' : 'GLOBAL';

    const result = new Map<string, EffectivePermission>();

    const liveRoles = user.roles.filter((a) => a.role.isActive && isLive(a.validFrom, a.validUntil, now));
    const rolePermissions: string[] = [];
    for (const assignment of liveRoles) {
      for (const rp of assignment.role.permissions) {
        rolePermissions.push(rp.permission.code);
        result.set(rp.permission.code, {
          code: rp.permission.code, granted: true, source: 'ROLE',
          sourceDetail: assignment.role.code, scopeLevel,
        });
      }
    }

    const liveOverrides = user.overrides.filter((o) => isLive(o.validFrom, o.validUntil, now));
    const globals = liveOverrides.filter((o) => o.projectId === null && o.siteId === null);
    const scoped = liveOverrides.filter((o) => o.projectId !== null || o.siteId !== null);

    const granted = new Set(resolvePermissions(rolePermissions, this.toOverrides(user, now), now));

    for (const code of new Set(globals.map((o) => o.permission.code))) {
      // Deny-first attribution: a DENY is what an operator needs to see, and its
      // `reason` is the text explaining the suspension.
      const rows = globals.filter((o) => o.permission.code === code);
      const chosen = rows.find((o) => o.effect === 'DENY') ?? rows[0]!;
      result.set(code, {
        code,
        granted: granted.has(code),
        source: chosen.effect === 'DENY' ? 'OVERRIDE_DENY' : 'OVERRIDE_ALLOW',
        sourceDetail: chosen.reason,
        scopeLevel,
      });
    }

    /**
     * Project- and site-scoped overrides cannot be folded into a flat list of
     * codes — the answer depends on which resource is being acted on, and this
     * endpoint names no resource. They are reported, deny-first, at the scope
     * level they apply to, and only where no global override for the code has
     * already settled the question (a global DENY outranks a project ALLOW,
     * which is the case that produced the unsafe `granted: true`). A scoped
     * row's `granted` is therefore scope-local, not a platform-wide answer;
     * the resource-level answer comes from the owning service's
     * `/internal/authz/explain` (sub-project 2).
     */
    const settledGlobally = new Set(globals.map((o) => o.permission.code));
    for (const code of new Set(scoped.map((o) => o.permission.code))) {
      if (settledGlobally.has(code)) continue;
      const rows = scoped.filter((o) => o.permission.code === code);
      const chosen = rows.find((o) => o.effect === 'DENY') ?? rows[0]!;
      result.set(code, {
        code,
        granted: chosen.effect === 'ALLOW',
        source: chosen.effect === 'DENY' ? 'OVERRIDE_DENY' : 'OVERRIDE_ALLOW',
        sourceDetail: chosen.reason,
        scopeLevel: chosen.siteId ? 'SITE' : 'PROJECT',
      });
    }

    return [...result.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Runs the real authorization path. This calls the same `check` used by every
   * guard, so the simulator cannot drift from actual enforcement.
   *
   * **Resource-scoped checks are not answered here, by design.** `check()`'s
   * last four gates — project scope, site scope, assignment and resource state
   * — need the resource itself, and every resource in this platform is owned by
   * another service (`project`, `qc`, `task`); iam holds no copy of one. The DTO
   * has always accepted `resourceType`/`resourceId` and this method used to
   * discard them and answer the *unscoped* question instead, which reported
   * `allowed: true` for a resource a real request would refuse with
   * `OUT_OF_PROJECT_SCOPE`. A permissive answer to a question that was not
   * asked is the worst of the three options; refusing to answer that part is
   * the least bad one until the real path exists.
   *
   * **Extension point (sub-project 2):** the owning service exposes
   * `POST /internal/authz/explain`, which loads the resource and runs this same
   * `check()` with it. Replace the `RESOURCE_NOT_EVALUATED` branch below with a
   * call to that endpoint — routed by `resourceType` — and return its decision
   * chain. Nothing else in this method changes: the simulator must keep calling
   * the shared `check()` rather than reimplementing any gate, which is the
   * whole reason it cannot drift from enforcement (§6 of the architecture
   * design).
   */
  async simulate(dto: AccessCheckDto): Promise<AccessCheckResult> {
    const now = new Date();
    const user = await this.load(dto.userId);

    const decision = check({
      user: this.toAuthzUser(user, now),
      permission: dto.permissionCode,
      scope: this.toScope(user),
      overrides: this.toOverrides(user, now),
      now,
    });

    // A denial that precedes the resource gates is a complete answer already —
    // an inactive account or a missing permission denies the resource-scoped
    // request too. Only an otherwise-allowed check is left undecided.
    if (dto.resourceId !== undefined && decision.allowed) {
      return {
        allowed: false,
        reason: 'RESOURCE_NOT_EVALUATED',
        checks: [
          ...decision.checks,
          {
            name: 'resource_scope',
            passed: false,
            detail: `Project scope, assignment and resource state for ${dto.resourceType ?? 'this resource'} `
              + `${dto.resourceId} are held by the owning service and were not evaluated. `
              + 'The identity and permission checks above passed.',
          },
        ],
      };
    }

    return { allowed: decision.allowed, reason: decision.reason, checks: decision.checks };
  }

  /**
   * Users who hold `permission` with reach to `projectId`, for callers that act
   * on an event rather than a user's request and so have no token to forward.
   *
   * Runs the shared `check()` with the project as the resource, exactly as the
   * owning endpoint would, so "who may review" cannot drift from what review
   * enforces. Global-scope users pass the project gate; a user with only site
   * scopes does not, because `check()` decides that, not this method.
   *
   * Loads every active user with their relations. Fine while that is tens or
   * hundreds; if it grows into the thousands, narrow the query by role first.
   */
  async holders(permission: string, projectId: string, siteId?: string): Promise<string[]> {
    const now = new Date();
    const users = ((await this.prisma.user.findMany({
      where: { isActive: true },
      include: USER_INCLUDE,
    })) as unknown as LoadedUser[]).map(withFinanceOptOut);
    return users
      .filter((user) => {
        const authzUser = this.toAuthzUser(user, now);
        const scope = this.toScope(user);
        const overrides = this.toOverrides(user, now);
        const allowedFor = (resource: AuthzResource) =>
          check({ user: authzUser, permission, resource, scope, overrides, now }).allowed;
        // qc treats a project scope and a site scope as alternatives, so a
        // reviewer granted only the site must be found too.
        return allowedFor({ type: 'PROJECT', id: projectId, projectId })
          || (siteId !== undefined && allowedFor({ type: 'SITE', id: siteId, siteId }));
      })
      .map((user) => user.id);
  }
}
