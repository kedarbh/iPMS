import { describe, expect, it } from 'vitest';
import {
  AssignRolesSchema, ChangePasswordSchema, CreateUserSchema,
  EmailSchema, UpdateSelfProfileSchema, UpdateUserSchema, UserListQuerySchema,
} from './user.js';

describe('EmailSchema', () => {
  it('trims and lowercases, so the same person cannot register twice', () => {
    expect(EmailSchema.parse('  Field.Engineer@IPMS.local  ')).toBe('field.engineer@ipms.local');
  });

  it('refuses something that is not an address', () => {
    expect(EmailSchema.safeParse('engineer').success).toBe(false);
    expect(EmailSchema.safeParse('').success).toBe(false);
  });
});

describe('CreateUserSchema', () => {
  const valid = {
    email: 'new@ipms.local', fullName: 'New Engineer',
    password: 'Correct-horse-1', roleCodes: ['FIELD_ENGINEER'],
  };

  it('accepts a complete body', () => {
    expect(CreateUserSchema.parse(valid).email).toBe('new@ipms.local');
  });

  it('refuses more than one role', () => {
    expect(CreateUserSchema.safeParse({ ...valid, roleCodes: ['FIELD_ENGINEER', 'QC_MANAGER'] }).success).toBe(false);
  });

  it('defaults roleCodes to none', () => {
    const { roleCodes: _omitted, ...withoutRoles } = valid;
    expect(CreateUserSchema.parse(withoutRoles).roleCodes).toEqual([]);
  });

  it('accepts eight characters with every character class', () => {
    expect(CreateUserSchema.safeParse({ ...valid, password: 'Abcdef1!' }).success).toBe(true);
  });

  it.each([
    ['under eight characters', 'Abcde1!'],
    ['no uppercase letter', 'abcdef1!'],
    ['no lowercase letter', 'ABCDEF1!'],
    ['no digit', 'Abcdefg!'],
    ['no symbol', 'Abcdefg1'],
  ])('refuses a password with %s', (_why, password) => {
    expect(CreateUserSchema.safeParse({ ...valid, password }).success).toBe(false);
  });

  it('refuses a malformed email', () => {
    expect(CreateUserSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  /**
   * Strips rather than rejects, per this directory's convention — and these are
   * the two keys it matters for: a client that sends `isActive` or
   * `mustChangePassword` must not have them reach the handler.
   */
  it('strips keys the caller has no business setting', () => {
    const parsed = CreateUserSchema.parse({ ...valid, isActive: false, mustChangePassword: false });
    expect(parsed).not.toHaveProperty('isActive');
    expect(parsed).not.toHaveProperty('mustChangePassword');
  });

  it('leaves financeEnabled undecided unless the caller sends it', () => {
    expect(CreateUserSchema.parse(valid).financeEnabled).toBeUndefined();
    expect(CreateUserSchema.parse({ ...valid, financeEnabled: false }).financeEnabled).toBe(false);
    expect(CreateUserSchema.parse({ ...valid, financeEnabled: true }).financeEnabled).toBe(true);
  });

  it('refuses a financeEnabled that is not a boolean', () => {
    expect(CreateUserSchema.safeParse({ ...valid, financeEnabled: 'no' }).success).toBe(false);
  });
});

describe('UpdateUserSchema', () => {
  it('normalizes a changed email the same way creation does', () => {
    expect(UpdateUserSchema.parse({ email: ' Ann@IPMS.local ' }).email).toBe('ann@ipms.local');
  });

  it('has no password field: a credential change must revoke sessions, so it has its own endpoint', () => {
    expect(UpdateUserSchema.parse({ password: 'a-new-password' })).not.toHaveProperty('password');
  });

  it('has no financeEnabled: finance is chosen when the account is created, and not afterwards', () => {
    expect(UpdateUserSchema.parse({ fullName: 'Ann Lee', financeEnabled: false })).toEqual({ fullName: 'Ann Lee' });
  });

  it('lets employeeCode be cleared with null but not blanked with a space', () => {
    expect(UpdateUserSchema.parse({ employeeCode: null }).employeeCode).toBeNull();
    expect(UpdateUserSchema.parse({ employeeCode: ' EMP-1 ' }).employeeCode).toBe('EMP-1');
  });
});

describe('UpdateSelfProfileSchema', () => {
  it('parses valid profile fields and normalizes email and strings', () => {
    const res = UpdateSelfProfileSchema.parse({
      fullName: '  Jane Doe  ',
      email: ' Jane@IPMS.local ',
      employeeCode: ' EMP-042 ',
      phone: ' +977-9800000000 ',
      preferredLocale: 'en',
    });
    expect(res).toEqual({
      fullName: 'Jane Doe',
      email: 'jane@ipms.local',
      employeeCode: 'EMP-042',
      phone: '+977-9800000000',
      preferredLocale: 'en',
    });
  });

  it('strips unauthorized fields such as roles, permissions, or password', () => {
    const res = UpdateSelfProfileSchema.parse({
      fullName: 'Jane Doe',
      roles: ['SUPER_ADMIN'],
      permissions: ['user.create'],
      password: 'HackedPassword-1',
    });
    expect(res).toEqual({ fullName: 'Jane Doe' });
    expect(res).not.toHaveProperty('roles');
    expect(res).not.toHaveProperty('permissions');
    expect(res).not.toHaveProperty('password');
  });
});

describe('AssignRolesSchema', () => {
  // The complete desired set, never a delta: idempotent, and the audit entry is
  // a complete before/after rather than half a story.
  it('takes the whole desired set, including the empty one', () => {
    expect(AssignRolesSchema.parse({ roleCodes: [] }).roleCodes).toEqual([]);
    expect(AssignRolesSchema.parse({ roleCodes: ['QC_MANAGER'] }).roleCodes).toEqual(['QC_MANAGER']);
  });

  it('refuses more than one role: a user holds a single role', () => {
    expect(AssignRolesSchema.safeParse({ roleCodes: ['QC_MANAGER', 'VIEWER'] }).success).toBe(false);
  });

  it('refuses a role code that is not UPPER_SNAKE_CASE', () => {
    expect(AssignRolesSchema.safeParse({ roleCodes: ['qc_manager'] }).success).toBe(false);
  });
});

describe('ChangePasswordSchema', () => {
  it('requires both halves, and holds only the new one to the policy', () => {
    const parsed = ChangePasswordSchema.parse({ currentPassword: 'old8char', newPassword: 'Long-enough-1' });
    expect(parsed.currentPassword).toBe('old8char');
    expect(ChangePasswordSchema.safeParse({ currentPassword: 'old8char', newPassword: 'tooshort' }).success).toBe(false);
  });
});

describe('UserListQuerySchema', () => {
  it('defaults to the first page, twenty rows, and every status', () => {
    expect(UserListQuerySchema.parse({})).toEqual({ page: 1, limit: 20, status: 'ALL' });
  });

  it('coerces the page and limit a query string delivers as text', () => {
    const parsed = UserListQuerySchema.parse({ page: '3', limit: '50', search: ' ann ' });
    expect(parsed.page).toBe(3);
    expect(parsed.limit).toBe(50);
    expect(parsed.search).toBe('ann');
  });
});
