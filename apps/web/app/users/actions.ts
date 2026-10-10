'use server';
import { redirect } from 'next/navigation';
import {
  changePassword, createUser, deactivateUser, getUserScopes, grantProjectAccess, reactivateUser,
  resetUserPassword, revokeProjectAccess, renewProjectAccess, setUserRoles, updateUser, updateMyProfile,
} from '../lib/user-api';
import { type FormState } from '../lib/form-state';
import { clearable, optional, settle } from '../lib/settle';

/**
 * One Server Action per mutation.
 *
 * They run on the server, so they reach `authFetch` and its http-only cookie
 * directly and the forms they back work without client JavaScript. The checks
 * below duplicate rules the service enforces anyway: a round trip to be told
 * "the two passwords do not match" is a worse answer than an immediate one.
 */

/** Matches `NewPasswordSchema` in @ipms/contracts. Keep the two in step. */
const MIN_PASSWORD = 8;
const PASSWORD_RULES: ReadonlyArray<[RegExp, string]> = [
  [/[A-Z]/, 'an uppercase letter'],
  [/[a-z]/, 'a lowercase letter'],
  [/[0-9]/, 'a digit'],
  [/[^A-Za-z0-9]/, 'a symbol'],
];

/**
 * A password exactly as typed. Not `optional`, which trims: sign-in sends the
 * value untrimmed, so a password stored trimmed and typed with its trailing
 * space would never match again.
 */
function secret(form: FormData, field: string): string | undefined {
  const value = form.get(field);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Both password forms take the value twice; neither should reach the API disagreeing. */
function readNewPassword(form: FormData): { password: string } | { error: string } {
  const password = secret(form, 'password') ?? secret(form, 'newPassword');
  const confirmation = secret(form, 'confirmPassword');
  if (!password) return { error: 'A password is required.' };
  if (password.length < MIN_PASSWORD) return { error: `The password must be at least ${MIN_PASSWORD} characters.` };
  const missing = PASSWORD_RULES.filter(([rule]) => !rule.test(password)).map(([, name]) => name);
  if (missing.length > 0) {
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
    return { error: `The password must contain ${list}.` };
  }
  if (password !== confirmation) return { error: 'The two passwords do not match.' };
  return { password };
}

/** A user's name is rendered on their own page and in the list, and both must refresh. */
const pages = (userId: string) => [`/users/${userId}`, '/users'];

/** The one role the form's radio group chose. A user holds exactly one. */
function readRole(form: FormData): { roleCodes: string[] } | { error: string } {
  const roleCodes = form.getAll('roleCodes').map(String);
  return roleCodes.length === 1 ? { roleCodes } : { error: 'Choose a role for this user.' };
}

export async function createUserAction(_previous: FormState, form: FormData): Promise<FormState> {
  const email = optional(form, 'email');
  const fullName = optional(form, 'fullName');
  if (!email || !fullName) {
    return { error: 'An email address and a full name are required.' };
  }

  const password = readNewPassword(form);
  if ('error' in password) return { error: password.error };
  const role = readRole(form);
  if ('error' in role) return { error: role.error };

  const employeeCode = optional(form, 'employeeCode');
  // The box is offered, with a marker beside it, only for a Field Engineer.
  // Offered and not ticked means off; a form that never offered it leaves
  // finance on, so a missing field can never switch anyone's finance off.
  const financeOff = role.roleCodes[0] === 'FIELD_ENGINEER'
    && form.get('financeOffered') !== null && form.get('financeEnabled') === null;
  const result = await createUser({
    email, fullName, password: password.password, roleCodes: role.roleCodes,
    ...(employeeCode === undefined ? {} : { employeeCode }),
    ...(financeOff ? { financeEnabled: false } : {}),
  });

  const state = await settle(result, '/users');
  if (state.error) return state;
  if (result.state === 'ready') redirect(`/users/${result.data.id}`);
  return state;
}

/**
 * Every field arrives on every submit, so an empty one is a deliberate clear
 * rather than a field the user skipped — hence `clearable` for the optional
 * employee code. On success it returns to the detail page: `FormState` carries
 * an error and nothing else, so the re-rendered profile is the only
 * acknowledgement a save can give.
 */
export async function updateUserAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  const fullName = optional(form, 'fullName');
  const email = optional(form, 'email');
  if (!fullName || !email) return { error: 'A full name and an email address are required.' };

  const state = await settle(await updateUser(userId, {
    fullName, email, ...clearable(form, 'employeeCode'),
  }), pages(userId));
  if (state.error) return state;
  redirect(`/users/${userId}`);
}

/** Updates the signed-in user's own profile and refreshes /profile. */
export async function updateMyProfileAction(_previous: FormState, form: FormData): Promise<FormState> {
  const fullName = optional(form, 'fullName');
  const email = optional(form, 'email');
  if (!fullName || !email) return { error: 'A full name and an email address are required.' };

  const state = await settle(await updateMyProfile({
    fullName, email, ...clearable(form, 'employeeCode'),
  }), ['/profile']);
  if (state.error) return state;
  return { done: true };
}

export async function setUserRolesAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  const role = readRole(form);
  if ('error' in role) return { error: role.error };
  return settle(await setUserRoles(userId, role), pages(userId));
}

/**
 * The project checkboxes, saved as a diff against what iam holds now.
 *
 * Only projects listed in `offered` — the ones the form rendered — can change.
 * A project the viewer cannot see was never on the form, so its absence from
 * the ticked list is not a request to revoke it, and an id smuggled into the
 * ticked list without being offered is ignored.
 *
 * Grants and revokes are separate calls, so a refusal part-way leaves the
 * earlier ones applied; the page is refreshed either way so it shows the truth.
 */
export async function setProjectAccessAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  const offered = new Set(form.getAll('offered').map(String));
  const ticked = new Set(form.getAll('projectIds').map(String).filter((id) => offered.has(id)));

  const current = await getUserScopes(userId);
  const read = await settle(current, []);
  if (read.error || current.state !== 'ready') return read;
  const held = new Set(current.data.projectIds);

  const changes = [
    ...[...ticked].filter((id) => !held.has(id)).map((id) => () => grantProjectAccess(userId, id)),
    ...[...offered].filter((id) => held.has(id) && !ticked.has(id)).map((id) => () => revokeProjectAccess(userId, id)),
  ];
  for (const change of changes) {
    const state = await settle(await change(), pages(userId));
    if (state.error) return state;
  }
  return settle({ state: 'ready', data: null }, pages(userId));
}

/** Renews one project's access for another year; the project id rides on the button that was pressed. */
export async function renewProjectAccessAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  const projectId = String(form.get('renewProjectId'));
  return settle(await renewProjectAccess(userId, projectId), pages(userId));
}

export async function deactivateUserAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  return settle(await deactivateUser(userId), pages(userId));
}

export async function reactivateUserAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  return settle(await reactivateUser(userId), pages(userId));
}

export async function resetUserPasswordAction(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId'));
  const password = readNewPassword(form);
  if ('error' in password) return { error: password.error };
  return settle(await resetUserPassword(userId, { password: password.password }), pages(userId));
}

/**
 * Self-service, and the last thing this session does.
 *
 * The change bumps `tokenVersion`, so the cookie in this browser is dead by the
 * time the call returns. Rather than redirecting straight to sign-in, which
 * reads as being thrown out, it reports `done` and the form confirms the change
 * before offering to sign in again (through the logout route, which clears the
 * dead cookies).
 */
export async function changePasswordAction(_previous: FormState, form: FormData): Promise<FormState> {
  const currentPassword = secret(form, 'currentPassword');
  if (!currentPassword) return { error: 'Enter your current password.' };

  const password = readNewPassword(form);
  if ('error' in password) return { error: password.error };
  if (password.password === currentPassword) {
    return { error: 'The new password must be different from the current one.' };
  }

  const state = await settle(
    await changePassword({ currentPassword, newPassword: password.password }),
    '/users',
  );
  if (state.error) return state;
  return { done: true };
}
