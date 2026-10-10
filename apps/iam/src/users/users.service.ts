import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
// This app's own generated client, not the shared @prisma/client package — see
// the `output` comment in prisma/schema.prisma.
import type { PrismaClient } from '@prisma-clients/iam';
import { mayAssign, mayManage } from '@ipms/authz';
import {
  uuidv7,
  type AssignRolesDto, type CreateUserDto, type ResetPasswordDto,
  type UpdateSelfProfileDto, type UpdateUserDto, type UserListQuery, type UserResponse,
} from '@ipms/contracts';
import { buildOutboxRecord, type JsonObject } from '@ipms/persistence';
import { SUBJECTS } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import type { PasswordService } from '../auth/password.service.js';
import type { TokenVersionStore } from '../auth/auth.service.js';
import type { TokenService } from '../auth/token.service.js';

/** A ceiling, not a page size: the directory is one list, and the platform's staff fits in it. */
const DIRECTORY_LIMIT = 5000;

/** The one role that may have finance turned off: vendor staff, whose own company handles their money. */
const FIELD_ENGINEER = 'FIELD_ENGINEER';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Every field a user response carries, and nothing else.
 *
 * Written as an explicit `select` rather than an `include` so `passwordHash`
 * cannot reach a client: an `include` returns every scalar column, and a
 * response built by spreading that row would start leaking the hash the first
 * time someone added a field to the response shape.
 */
const USER_SELECT = {
  id: true, email: true, fullName: true, employeeCode: true,
  isActive: true, mustChangePassword: true, financeEnabled: true, lastLoginAt: true, createdAt: true,
  roles: { select: { role: { select: { code: true, name: true } } } },
} as const;

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  employeeCode: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  financeEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: Array<{ role: { code: string; name: string } }>;
}

/**
 * Deduplicated, because a user can hold the same role globally and again scoped
 * to a project — two `UserRole` rows, one authority. The object gate must see
 * each code once or a project-scoped duplicate would read as a different role.
 */
function roleCodesOf(row: UserRow): string[] {
  return [...new Set(row.roles.map((assignment) => assignment.role.code))];
}

function toResponse(row: UserRow): UserResponse {
  const seen = new Map<string, string>();
  for (const assignment of row.roles) seen.set(assignment.role.code, assignment.role.name);
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    employeeCode: row.employeeCode,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    financeEnabled: row.financeEnabled,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    roles: [...seen].map(([code, name]) => ({ code, name })),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly passwords: PasswordService,
    private readonly versions: TokenVersionStore,
    private readonly tokens: TokenService,
  ) {}

  private async emit(tx: Tx, subject: string, payload: JsonObject, actorId: string): Promise<void> {
    await tx.outboxEvent.create({
      data: buildOutboxRecord(subject, payload, getCorrelationId() ?? 'unknown', actorId),
    });
  }

  private async audit(
    tx: Tx, actorId: string, action: string, objectId: string,
    previousState: JsonObject, newState: JsonObject,
  ): Promise<void> {
    await this.emit(tx, SUBJECTS.AUDIT_EVENT, {
      actorId, action, objectType: 'User', objectId, previousState, newState, details: {},
    }, actorId);
  }

  /**
   * Kills every outstanding token for a user, immediately. Same shape and same
   * ordering as `ScopesService.revokeTokens`, deliberately: the row update runs
   * inside the caller's transaction and the publish inside the same callback,
   * before commit, so a rollback leaves Redis holding a *higher* version and
   * every outstanding token refused. Publishing after commit would invert that
   * and leave a revoked token working for its full TTL.
   */
  private async revokeTokens(tx: Tx, userId: string): Promise<void> {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await this.versions.publish(userId, updated.tokenVersion, this.tokens.refreshTtlSeconds);
  }

  /** Resolves the role rows for a set of codes, refusing any code with no row behind it. */
  private async resolveRoles(tx: Tx, codes: string[]): Promise<Array<{ id: string; code: string; name: string }>> {
    const unique = [...new Set(codes)];
    if (unique.length === 0) return [];
    const roles = await tx.role.findMany({ where: { code: { in: unique } } });
    if (roles.length !== unique.length) {
      const found = new Set(roles.map((role) => role.code));
      const missing = unique.filter((code) => !found.has(code));
      throw new BadRequestException(`Unknown role codes: ${missing.join(', ')}`);
    }
    return roles;
  }

  /**
   * Refuses a change that would leave the platform with no active
   * administrator.
   *
   * The count runs inside the caller's transaction, which is what makes it
   * true rather than merely likely: two concurrent demotions each reading a
   * committed count of two would otherwise both see a survivor and both
   * commit, leaving none.
   *
   * `next` is the role set the target will hold afterwards, or `'DEACTIVATE'`
   * when they will hold the same roles but no longer be active.
   */
  private async assertAdminSurvives(
    tx: Tx, userId: string, currentRoleCodes: string[], next: string[] | 'DEACTIVATE',
  ): Promise<void> {
    if (!currentRoleCodes.includes('SUPER_ADMIN')) return;
    if (next !== 'DEACTIVATE' && next.includes('SUPER_ADMIN')) return;

    const remaining = await tx.userRole.count({
      where: { role: { code: 'SUPER_ADMIN' }, userId: { not: userId }, user: { isActive: true } },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        'This is the last active super administrator; promote another account first',
      );
    }
  }

  private assertMayAssign(actorRoleCodes: string[], codes: string[]): void {
    for (const code of codes) {
      if (!mayAssign(actorRoleCodes, code)) {
        throw new ForbiddenException(`You may not assign the role ${code}`);
      }
    }
  }

  /**
   * Loads a user and refuses the caller if the object gate says they may not
   * touch them. Used by every write; reads deliberately do not call it.
   */
  protected async loadManageable(tx: Tx, userId: string, actorRoleCodes: string[]): Promise<UserRow> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    if (!mayManage(actorRoleCodes, roleCodesOf(user as UserRow))) {
      // 403 rather than 404: `user.view` already grants the directory, so the
      // user's existence is not a secret from this caller.
      throw new ForbiddenException('You may not manage this user');
    }
    return user as UserRow;
  }

  /**
   * Names only, for anyone who works with tasks: the responsible-person picker
   * on a work order, and the name printed where a task shows its assignee.
   *
   * Deliberately narrower than `list` — no email, roles or login
   * history — because it is granted by `task.view` rather than `user.view`,
   * and a QC Manager raising a spot check needs to name the engineer without
   * being handed the staff directory. Inactive users are included, flagged, so
   * a task assigned to someone who has since left still shows who it was.
   */
  async directory(): Promise<Array<{ id: string; fullName: string; employeeCode: string | null; isActive: boolean }>> {
    return this.prisma.user.findMany({
      select: { id: true, fullName: true, employeeCode: true, isActive: true },
      orderBy: { fullName: 'asc' },
      take: DIRECTORY_LIMIT,
    });
  }

  async list(query: UserListQuery): Promise<{ items: UserResponse[]; total: number; page: number; limit: number }> {
    // Filtering happens in the query, never after the fetch — the architecture
    // spec calls query-level enforcement mandatory, and it is what keeps this
    // endpoint from becoming an enumeration oracle.
    const where = {
      ...(query.status === 'ALL' ? {} : { isActive: query.status === 'ACTIVE' }),
      ...(query.search === undefined ? {} : {
        OR: [
          { email: { contains: query.search, mode: 'insensitive' as const } },
          { fullName: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
      ...(query.role === undefined ? {} : { roles: { some: { role: { code: query.role } } } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { fullName: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: (rows as UserRow[]).map(toResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return toResponse(user as UserRow);
  }

  async create(dto: CreateUserDto, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    this.assertMayAssign(actorRoleCodes, dto.roleCodes);

    // Finance is on unless the caller says otherwise, and only a Field Engineer
    // may turn it off: it exists for vendor staff whose own company pays their
    // advances and settles their expenses. Checked here rather than in the
    // schema so the refusal is a 400 naming the rule.
    const financeEnabled = dto.financeEnabled ?? true;
    if (!financeEnabled && !(dto.roleCodes.length === 1 && dto.roleCodes[0] === FIELD_ENGINEER)) {
      throw new BadRequestException('Only a Field Engineer can have finance turned off');
    }

    // Hashed before the transaction opens: argon2 is deliberately slow, and
    // holding a database transaction open across it would pin a connection for
    // the duration of every user creation.
    const passwordHash = await this.passwords.hash(dto.password);

    return this.prisma.$transaction(async (tx) => {
      // Checked explicitly rather than left to the unique constraint, so a
      // collision is a 400 naming the field rather than a Prisma error
      // surfacing as a 500.
      if (await tx.user.findUnique({ where: { email: dto.email } })) {
        throw new BadRequestException(`Email ${dto.email} is already in use`);
      }

      const roles = await this.resolveRoles(tx, dto.roleCodes);

      const id = uuidv7();
      await tx.user.create({
        data: {
          id,
          email: dto.email,
          fullName: dto.fullName,
          ...(dto.employeeCode === undefined ? {} : { employeeCode: dto.employeeCode }),
          passwordHash,
          isActive: true,
          // The creator knows this password, so the account carries no
          // authority until its holder replaces it. See AuthService.login.
          mustChangePassword: true,
          financeEnabled,
        },
      });

      for (const role of roles) {
        await tx.userRole.create({
          data: { id: uuidv7(), userId: id, roleId: role.id, createdBy: actorId },
        });
        await this.emit(tx, SUBJECTS.IAM_ROLE_ASSIGNED, {
          userId: id, roleCode: role.code, projectId: null, siteId: null,
        }, actorId);
      }

      await this.audit(tx, actorId, 'user.created', id, {}, {
        email: dto.email, fullName: dto.fullName,
        roleCodes: roles.map((role) => role.code),
        financeEnabled,
      });

      // Re-read rather than assembling the response from the write inputs: one
      // query, and it cannot drift from what the next GET will return.
      const created = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(created as UserRow);
    });
  }

  async update(id: string, dto: UpdateUserDto, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.loadManageable(tx, id, actorRoleCodes);

      // Only the fields the caller actually sent, in the write and in the
      // ledger alike — see RolesService.update for why the audit entry cannot
      // simply spread the DTO.
      const data: JsonObject = {};
      if (dto.email !== undefined) data['email'] = dto.email;
      if (dto.fullName !== undefined) data['fullName'] = dto.fullName;
      if (dto.employeeCode !== undefined) data['employeeCode'] = dto.employeeCode;

      if (dto.email !== undefined && dto.email !== existing.email) {
        const clash = await tx.user.findUnique({ where: { email: dto.email } });
        if (clash) throw new BadRequestException(`Email ${dto.email} is already in use`);
      }

      await tx.user.update({ where: { id }, data: data as never });

      const previousState: JsonObject = {};
      if (dto.email !== undefined) previousState['email'] = existing.email;
      if (dto.fullName !== undefined) previousState['fullName'] = existing.fullName;
      if (dto.employeeCode !== undefined) previousState['employeeCode'] = existing.employeeCode;

      await this.audit(tx, actorId, 'user.updated', id, previousState, data);
      await this.emit(tx, SUBJECTS.IAM_USER_UPDATED, {
        userId: id,
        ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.employeeCode !== undefined ? { employeeCode: dto.employeeCode } : {}),
      }, actorId);

      // No token revocation: a profile edit changes no authority.
      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }

  async updateSelf(id: string, dto: UpdateSelfProfileDto): Promise<UserResponse> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id }, select: USER_SELECT });
      if (!user) throw new NotFoundException('User not found');
      const existing = user as UserRow;

      const data: JsonObject = {};
      if (dto.email !== undefined) data['email'] = dto.email;
      if (dto.fullName !== undefined) data['fullName'] = dto.fullName;
      if (dto.employeeCode !== undefined) data['employeeCode'] = dto.employeeCode;

      if (dto.email !== undefined && dto.email !== existing.email) {
        const clash = await tx.user.findUnique({ where: { email: dto.email } });
        if (clash) throw new BadRequestException(`Email ${dto.email} is already in use`);
      }

      if (Object.keys(data).length > 0) {
        await tx.user.update({ where: { id }, data: data as never });

        const previousState: JsonObject = {};
        if (dto.email !== undefined) previousState['email'] = existing.email;
        if (dto.fullName !== undefined) previousState['fullName'] = existing.fullName;
        if (dto.employeeCode !== undefined) previousState['employeeCode'] = existing.employeeCode;

        await this.audit(tx, id, 'user.self_updated', id, previousState, data);
        await this.emit(tx, SUBJECTS.IAM_USER_UPDATED, {
          userId: id,
          ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.employeeCode !== undefined ? { employeeCode: dto.employeeCode } : {}),
        }, id);
      }

      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }

  async deactivate(id: string, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    if (id === actorId) {
      throw new ForbiddenException('An actor cannot deactivate their own account');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.loadManageable(tx, id, actorRoleCodes);
      await this.assertAdminSurvives(tx, id, roleCodesOf(existing), 'DEACTIVATE');

      await tx.user.update({ where: { id }, data: { isActive: false } });
      // The account is refused at login from here, but a live access token
      // would still be honoured for its full TTL without this.
      await this.revokeTokens(tx, id);

      await this.emit(tx, SUBJECTS.IAM_USER_DEACTIVATED, { userId: id }, actorId);
      await this.audit(tx, actorId, 'user.deactivated', id, { isActive: true }, { isActive: false });

      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }

  async reactivate(id: string, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.loadManageable(tx, id, actorRoleCodes);

      // Deliberately does not clear `mustChangePassword`: if the account was
      // deactivated while it still owed a change, it owes it on return.
      await tx.user.update({ where: { id }, data: { isActive: true } });
      await this.audit(tx, actorId, 'user.reactivated', id, { isActive: false }, { isActive: true });

      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }

  async setRoles(id: string, dto: AssignRolesDto, actorId: string, actorRoleCodes: string[]): Promise<UserResponse> {
    // Checked before anything is loaded: this is the privilege-escalation path,
    // and `role.assign` without it is equivalent to SUPER_ADMIN.
    if (id === actorId) {
      throw new ForbiddenException('An actor cannot change their own roles');
    }
    this.assertMayAssign(actorRoleCodes, dto.roleCodes);

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.loadManageable(tx, id, actorRoleCodes);
      const previousCodes = roleCodesOf(existing);
      await this.assertAdminSurvives(tx, id, previousCodes, dto.roleCodes);

      const roles = await this.resolveRoles(tx, dto.roleCodes);

      // Global assignments only. Project- and site-scoped rows are granted
      // through ScopesController and are not this endpoint's to replace.
      await tx.userRole.deleteMany({ where: { userId: id, projectId: null, siteId: null } });
      for (const role of roles) {
        await tx.userRole.create({
          data: { id: uuidv7(), userId: id, roleId: role.id, createdBy: actorId },
        });
      }

      for (const code of previousCodes.filter((c) => !dto.roleCodes.includes(c))) {
        await this.emit(tx, SUBJECTS.IAM_ROLE_REMOVED, { userId: id, roleCode: code, projectId: null, siteId: null }, actorId);
      }
      for (const code of dto.roleCodes.filter((c) => !previousCodes.includes(c))) {
        await this.emit(tx, SUBJECTS.IAM_ROLE_ASSIGNED, { userId: id, roleCode: code, projectId: null, siteId: null }, actorId);
      }

      // The permissions claim is resolved at issuance, so without this the old
      // authority stays live for the access token's full TTL.
      await this.revokeTokens(tx, id);
      // An engineer made something else is no longer one: finance is theirs
      // again, rather than withheld by a switch only an engineer can carry.
      const restoresFinance = existing.financeEnabled === false && !dto.roleCodes.includes(FIELD_ENGINEER);
      if (restoresFinance) await tx.user.update({ where: { id }, data: { financeEnabled: true } });

      await this.audit(tx, actorId, 'user.roles_changed', id,
        { roleCodes: previousCodes, ...(restoresFinance ? { financeEnabled: false } : {}) },
        { roleCodes: dto.roleCodes, ...(restoresFinance ? { financeEnabled: true } : {}) });

      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }

  async resetPassword(
    id: string, dto: ResetPasswordDto, actorId: string, actorRoleCodes: string[],
  ): Promise<UserResponse> {
    const passwordHash = await this.passwords.hash(dto.password);

    return this.prisma.$transaction(async (tx) => {
      await this.loadManageable(tx, id, actorRoleCodes);

      await tx.user.update({
        where: { id },
        // The actor now knows this password, so the account owes a change
        // exactly as a freshly created one does.
        data: { passwordHash, mustChangePassword: true },
      });
      await this.revokeTokens(tx, id);

      // No password, hash, or derivative of either reaches the ledger.
      await this.audit(tx, actorId, 'user.password_reset', id, {}, { mustChangePassword: true });

      const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
      return toResponse(updated as UserRow);
    });
  }
}
