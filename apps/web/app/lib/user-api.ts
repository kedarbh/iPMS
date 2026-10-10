import 'server-only';
import type {
  AssignRolesDto, ChangePasswordDto, CreateUserDto,
  ResetPasswordDto, UpdateUserDto, UserStatusFilter,
} from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

/**
 * The users surface of `iam`, as reached through the gateway.
 *
 * Request shapes come from `@ipms/contracts` — the same schemas the service
 * parses with — so a field renamed there stops this app compiling rather than
 * producing a 422 at runtime. The imports are type-only on purpose: the
 * contracts barrel pulls in `node:crypto` and zod, which have no business in
 * this app's bundle when only the shapes are needed.
 *
 * Response shapes are written as the wire sees them: `DateTime` arrives as an
 * ISO string, because that is what JSON.stringify makes of it.
 */

export interface UserRoleSummary { code: string; name: string }

export interface User {
  id: string;
  email: string;
  fullName: string;
  employeeCode: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  /** False for a Field Engineer whose own company handles their advances and expenses. */
  financeEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: UserRoleSummary[];
}

export interface UserPage { items: User[]; total: number; page: number; limit: number }

/**
 * The slice of `RolesController`'s response the assignment controls need.
 *
 * `assignable` is computed by iam for the calling user from the same
 * assignable-roles table it enforces writes with. It is reported rather than
 * recomputed here because that table lives in `@ipms/authz`, which a Next build
 * cannot import — and a second copy of the rule in this app could drift from
 * the one that actually decides.
 */
export interface Role {
  id: string; code: string; name: string; isActive: boolean; assignable: boolean;
  permissionCodes: string[];
}

/** One entry of iam's permission catalog, as the role picker describes it. */
export interface Permission { code: string; module: string; description: string }

export interface UserFilters {
  search?: string | undefined;
  status?: UserStatusFilter | undefined;
  role?: string | undefined;
  page?: number | undefined;
}

export async function listUsers(filters: UserFilters = {}): Promise<ApiResult<UserPage>> {
  return authFetch<UserPage>('/api/v1/users', {
    query: {
      search: filters.search,
      status: filters.status,
      role: filters.role,
      page: filters.page === undefined ? undefined : String(filters.page),
    },
  });
}

/** The signed-in user's own record. Needs no permission, unlike `getUser`. */
export async function getMyProfile(): Promise<ApiResult<User>> {
  return authFetch<User>('/api/v1/users/me');
}

/** Updates the signed-in user's own profile without requiring administrative permissions. */
export async function updateMyProfile(input: UpdateUserDto): Promise<ApiResult<User>> {
  return authFetch<User>('/api/v1/users/me', { method: 'PATCH', json: input });
}

export async function getUser(id: string): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}`);
}

export async function createUser(input: CreateUserDto): Promise<ApiResult<User>> {
  return authFetch<User>('/api/v1/users', { method: 'POST', json: input });
}

export async function updateUser(id: string, input: UpdateUserDto): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}`, { method: 'PATCH', json: input });
}

/** Deactivates. There is no hard delete — see the users controller. */
export async function deactivateUser(id: string): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}`, { method: 'DELETE' });
}

export async function reactivateUser(id: string): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}/reactivate`, { method: 'POST' });
}

export async function setUserRoles(id: string, input: AssignRolesDto): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}/roles`, { method: 'PUT', json: input });
}

export async function resetUserPassword(id: string, input: ResetPasswordDto): Promise<ApiResult<User>> {
  return authFetch<User>(`/api/v1/users/${id}/reset-password`, { method: 'POST', json: input });
}

/**
 * Where a user's work may reach — `ScopesService.listForUser` in iam. `global`
 * is reported on its own: empty lists mean "granted nothing", the opposite of
 * global reach. Needs `scope.view`.
 */
export interface UserScopes {
  global: boolean; projectIds: string[]; siteIds: string[];
  /** The same projects with when each lapses; `expiresAt` is null for access that does not. */
  projects: Array<{ projectId: string; expiresAt: string | null }>;
}

export async function getUserScopes(id: string): Promise<ApiResult<UserScopes>> {
  return authFetch<UserScopes>(`/api/v1/users/${id}/scopes`);
}

/**
 * Project access. iam emits `iam.scope.granted`, the project service
 * replicates it, and from then on the user is offered as the responsible
 * person for work in that project. Both are idempotent. Revoking also drops
 * any site access the user held under the project.
 */
export async function grantProjectAccess(id: string, projectId: string): Promise<ApiResult<{ status: string }>> {
  return authFetch<{ status: string }>(`/api/v1/users/${id}/projects`, { method: 'POST', json: { level: 'PROJECT', projectId } });
}

/** Another year of access, for a grant that expires. */
export async function renewProjectAccess(id: string, projectId: string): Promise<ApiResult<{ expiresAt: string }>> {
  return authFetch<{ expiresAt: string }>(`/api/v1/users/${id}/projects/renew`, { method: 'POST', json: { level: 'PROJECT', projectId } });
}

export async function revokeProjectAccess(id: string, projectId: string): Promise<ApiResult<{ status: string }>> {
  return authFetch<{ status: string }>(`/api/v1/users/${id}/projects`, { method: 'DELETE', json: { level: 'PROJECT', projectId } });
}

/** One entry of the name directory — see `UsersService.directory` in iam. */
export interface DirectoryUser { id: string; fullName: string; employeeCode: string | null; isActive: boolean }

/** Names for assignment pickers and assignee columns. Needs only `task.view`. */
export async function listUserDirectory(): Promise<ApiResult<DirectoryUser[]>> {
  return authFetch<DirectoryUser[]>('/api/v1/users/directory');
}

/** Feeds the role checkboxes. Needs `role.view`, which every user-managing role holds. */
export async function listRoles(): Promise<ApiResult<Role[]>> {
  return authFetch<Role[]>('/api/v1/roles');
}

/**
 * Needs `permission.view`, which `role.assign` does not imply. Callers treat
 * anything but `ready` as "no descriptions" and fall back to the raw codes.
 */
export async function listPermissions(): Promise<ApiResult<Permission[]>> {
  return authFetch<Permission[]>('/api/v1/permissions');
}

export async function changePassword(input: ChangePasswordDto): Promise<ApiResult<{ status: string }>> {
  return authFetch<{ status: string }>('/api/v1/auth/change-password', { method: 'POST', json: input });
}
