import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';
import { PaginationSchema } from '../common/pagination.js';
import { RoleCodeSchema } from './role.js';

// Convention: every request DTO in this file strips unknown keys rather than
// rejecting, so an out-of-date offline client cannot be hard-failed by a field
// it does not know about — and a client-supplied `isActive` or
// `mustChangePassword` is discarded rather than reaching the handler.

/**
 * The login identifier, and the only one: there is no separate username.
 *
 * Trimmed and lowercased before validation, so `Ann.Lee@example.com` and
 * `ann.lee@example.com` cannot become two accounts that look identical in every
 * list — and so the unique constraint on the column is a case-insensitive one
 * in practice.
 */
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(255));

/**
 * Anything set through the API: at least eight characters, with an uppercase
 * letter, a lowercase letter, a digit and a symbol (any character that is not
 * a letter or a digit). `LoginSchema` checks length only, on purpose: adding
 * the character rules there would lock out every account whose password
 * predates them.
 */
export const NewPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200)
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

/**
 * A user holds one role. Still an array on the wire, so the complete-set
 * semantics below and every existing client keep working; empty means "no role".
 */
const SingleRoleSchema = z.array(RoleCodeSchema).max(1, 'A user holds a single role');

export const CreateUserSchema = z.object({
  email: EmailSchema,
  fullName: z.string().trim().min(1).max(200),
  employeeCode: z.string().trim().min(1).max(50).optional(),
  password: NewPasswordSchema,
  roleCodes: SingleRoleSchema.default([]),
  /**
   * Whether the user goes through Axiom finance. Only a Field Engineer may have
   * it off (the service refuses it for anyone else): some are vendor staff whose
   * own company pays their advances and settles their expenses. Chosen here and
   * nowhere else, so `UpdateUserSchema` does not carry it.
   */
  financeEnabled: z.boolean().optional(),
}).strip();
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

/**
 * Deliberately without `password`.
 *
 * `email` may change, and with it the address the holder signs in with. The
 * ledger records users by id, so older entries still name the same person.
 *
 * `password` has its own endpoint because a credential change must revoke the
 * target's sessions, and folding that into a general-purpose PATCH makes it
 * easy to forget.
 */
export const UpdateUserSchema = z.object({
  email: EmailSchema.optional(),
  fullName: z.string().trim().min(1).max(200).optional(),
  employeeCode: z.string().trim().min(1).max(50).nullable().optional(),
}).strip();
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

/**
 * Self-service profile updates.
 *
 * Dedicated contract for users editing their own profile. Limits fields
 * strictly to personal identity and presentation settings.
 */
export const UpdateSelfProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  email: EmailSchema.optional(),
  employeeCode: z.string().trim().min(1).max(50).nullable().optional(),
  phone: z.string().trim().min(7).max(20).nullable().optional(),
  preferredLocale: z.enum(['en', 'ne']).optional(),
}).strip();
export type UpdateSelfProfileDto = z.infer<typeof UpdateSelfProfileSchema>;

/**
 * The complete desired set, not a delta.
 *
 * An add/remove API needs the client to know the current state, and makes two
 * concurrent edits silently merge into a set neither editor asked for. Sending
 * the whole set makes the write idempotent and the audit entry a complete
 * before-and-after.
 */
export const AssignRolesSchema = z.object({
  roleCodes: SingleRoleSchema,
}).strip();
export type AssignRolesDto = z.infer<typeof AssignRolesSchema>;

export const ResetPasswordSchema = z.object({ password: NewPasswordSchema }).strip();
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;

/** `currentPassword` is only ever compared against a stored hash, so it carries no length policy. */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: NewPasswordSchema,
}).strip();
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

export const UserStatusFilterSchema = z.enum(['ACTIVE', 'INACTIVE', 'ALL']);
export type UserStatusFilter = z.infer<typeof UserStatusFilterSchema>;

export const UserListQuerySchema = PaginationSchema.extend({
  /** Matched against email and full name, case-insensitively. */
  search: z.string().trim().min(1).max(150).optional(),
  status: UserStatusFilterSchema.default('ALL'),
  role: RoleCodeSchema.optional(),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

export const UserRoleSummarySchema = z.object({
  code: RoleCodeSchema,
  name: z.string(),
});

/** Never carries `passwordHash`, and never gains a field by being spread from a row. */
export const UserResponseSchema = z.object({
  id: UuidSchema,
  email: z.string(),
  fullName: z.string(),
  employeeCode: z.string().nullable(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  financeEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  roles: z.array(UserRoleSummarySchema),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;
