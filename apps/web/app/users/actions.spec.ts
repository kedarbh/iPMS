import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); });
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));

const createUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const updateUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const deactivateUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const reactivateUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const setUserRoles = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const resetUserPassword = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const changePassword = vi.fn().mockResolvedValue({ state: 'ready', data: { status: 'ok' } });
const updateMyProfile = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const getUserScopes = vi.fn();
const grantProjectAccess = vi.fn().mockResolvedValue({ state: 'ready', data: { status: 'ok' } });
const revokeProjectAccess = vi.fn().mockResolvedValue({ state: 'ready', data: { status: 'ok' } });
vi.mock('../lib/user-api', () => ({
  createUser, updateUser, deactivateUser, reactivateUser,
  setUserRoles, resetUserPassword, changePassword, updateMyProfile,
  getUserScopes, grantProjectAccess, revokeProjectAccess,
  listUsers: vi.fn(), getUser: vi.fn(), listRoles: vi.fn(), getMyProfile: vi.fn(),
}));

const {
  changePasswordAction, createUserAction, deactivateUserAction,
  reactivateUserAction, resetUserPasswordAction, setUserRolesAction, updateUserAction,
  updateMyProfileAction, setProjectAccessAction,
} = await import('./actions');

beforeEach(() => {
  revalidatePath.mockClear();
  redirect.mockClear();
  for (const fn of [
    createUser, updateUser, deactivateUser, reactivateUser, setUserRoles, resetUserPassword, changePassword, updateMyProfile,
    getUserScopes, grantProjectAccess, revokeProjectAccess,
  ]) {
    fn.mockClear();
  }
});

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) data.append(key, item);
    else data.set(key, value);
  }
  return data;
}

const NEW_USER = {
  email: 'new.one@ipms.local', fullName: 'New One',
  password: 'Long-enough-1', confirmPassword: 'Long-enough-1', roleCodes: 'FIELD_ENGINEER',
};

describe('createUserAction', () => {
  it('sends the whole form, with the chosen role as a one-element array', async () => {
    await expect(createUserAction({}, form(NEW_USER)))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(createUser).toHaveBeenCalledWith({
      email: 'new.one@ipms.local', fullName: 'New One',
      password: 'Long-enough-1', roleCodes: ['FIELD_ENGINEER'],
    });
  });

  it('requires exactly one role', async () => {
    const withoutRole: Partial<typeof NEW_USER> = { ...NEW_USER };
    delete withoutRole.roleCodes;
    expect(await createUserAction({}, form(withoutRole))).toEqual({ error: 'Choose a role for this user.' });
    expect(await createUserAction({}, form({ ...NEW_USER, roleCodes: ['FIELD_ENGINEER', 'QC_MANAGER'] })))
      .toEqual({ error: 'Choose a role for this user.' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('omits employeeCode when it was left blank rather than sending an empty string', async () => {
    await expect(createUserAction({}, form({ ...NEW_USER, employeeCode: '   ' })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(createUser.mock.calls[0]![0]).not.toHaveProperty('employeeCode');
  });

  it('refuses a mismatched confirmation without a round trip', async () => {
    expect(await createUserAction({}, form({ ...NEW_USER, confirmPassword: 'something-else' })))
      .toEqual({ error: 'The two passwords do not match.' });
    expect(createUser).not.toHaveBeenCalled();
  });

  // The service refuses it too, but a round trip to be told the obvious is a
  // worse answer than an immediate one.
  it('refuses a short password without a round trip', async () => {
    expect(await createUserAction({}, form({ ...NEW_USER, password: 'short', confirmPassword: 'short' })))
      .toEqual({ error: 'The password must be at least 8 characters.' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('names every character class a password is missing', async () => {
    expect(await createUserAction({}, form({ ...NEW_USER, password: 'lowercase', confirmPassword: 'lowercase' })))
      .toEqual({ error: 'The password must contain an uppercase letter, a digit and a symbol.' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('requires an email and a name', async () => {
    expect(await createUserAction({}, form({ email: 'only.this@ipms.local' })))
      .toEqual({ error: 'An email address and a full name are required.' });
  });

  it('lands on the new users page', async () => {
    await expect(createUserAction({}, form(NEW_USER))).rejects.toThrow('NEXT_REDIRECT');
    expect(revalidatePath).toHaveBeenCalledWith('/users');
    expect(redirect).toHaveBeenCalledWith('/users/u-1');
  });

  it('shows the APIs refusal and does not redirect', async () => {
    createUser.mockResolvedValueOnce({ state: 'forbidden', message: 'You may not assign the role SUPER_ADMIN' });
    expect(await createUserAction({}, form(NEW_USER)))
      .toEqual({ error: 'You may not assign the role SUPER_ADMIN' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('updateUserAction', () => {
  it('clears employeeCode when the field is submitted empty', async () => {
    await expect(updateUserAction({}, form({
      userId: 'u-1', fullName: 'Renamed', email: 'r@ipms.local', employeeCode: '',
    }))).rejects.toThrow('NEXT_REDIRECT');
    expect(updateUser).toHaveBeenCalledWith('u-1', {
      fullName: 'Renamed', email: 'r@ipms.local', employeeCode: null,
    });
  });

  it('refreshes the list as well as the detail page, because both show the name', async () => {
    await expect(updateUserAction({}, form({ userId: 'u-1', fullName: 'Renamed', email: 'r@ipms.local' })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(revalidatePath).toHaveBeenCalledWith('/users/u-1');
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });
});

describe('updateMyProfileAction', () => {
  it('updates current profile and revalidates /profile', async () => {
    const res = await updateMyProfileAction({}, form({
      fullName: 'Updated Self', email: 'self@ipms.local', employeeCode: 'EMP-777',
    }));
    expect(res).toEqual({ done: true });
    expect(updateMyProfile).toHaveBeenCalledWith({
      fullName: 'Updated Self', email: 'self@ipms.local', employeeCode: 'EMP-777',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/profile');
  });

  it('requires full name and email', async () => {
    const res = await updateMyProfileAction({}, form({ fullName: 'Only Name' }));
    expect(res).toEqual({ error: 'A full name and an email address are required.' });
    expect(updateMyProfile).not.toHaveBeenCalled();
  });
});

describe('setUserRolesAction', () => {
  it('requires exactly one role', async () => {
    expect(await setUserRolesAction({}, form({ userId: 'u-1' }))).toEqual({ error: 'Choose a role for this user.' });
    expect(await setUserRolesAction({}, form({ userId: 'u-1', roleCodes: ['QC_MANAGER', 'VIEWER'] })))
      .toEqual({ error: 'Choose a role for this user.' });
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it('sends the chosen role as the whole set', async () => {
    await setUserRolesAction({}, form({ userId: 'u-1', roleCodes: 'QC_MANAGER' }));
    expect(setUserRoles).toHaveBeenCalledWith('u-1', { roleCodes: ['QC_MANAGER'] });
  });
});

describe('deactivateUserAction and reactivateUserAction', () => {
  it('deactivates and refreshes both pages', async () => {
    expect(await deactivateUserAction({}, form({ userId: 'u-1' }))).toEqual({});
    expect(deactivateUser).toHaveBeenCalledWith('u-1');
    expect(revalidatePath).toHaveBeenCalledWith('/users/u-1');
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });

  it('surfaces the last-administrator refusal rather than swallowing it', async () => {
    deactivateUser.mockResolvedValueOnce({
      state: 'unavailable', status: 400,
      message: 'This is the last active super administrator; promote another account first',
    });
    expect(await deactivateUserAction({}, form({ userId: 'u-1' })))
      .toEqual({ error: 'This is the last active super administrator; promote another account first' });
  });

  it('reactivates', async () => {
    expect(await reactivateUserAction({}, form({ userId: 'u-1' }))).toEqual({});
    expect(reactivateUser).toHaveBeenCalledWith('u-1');
  });
});

describe('resetUserPasswordAction', () => {
  it('sends the new password once both copies agree', async () => {
    expect(await resetUserPasswordAction({}, form({
      userId: 'u-1', password: 'Long-enough-1', confirmPassword: 'Long-enough-1',
    }))).toEqual({});
    expect(resetUserPassword).toHaveBeenCalledWith('u-1', { password: 'Long-enough-1' });
  });

  it('refuses a mismatch without a round trip', async () => {
    expect(await resetUserPasswordAction({}, form({
      userId: 'u-1', password: 'Long-enough-1', confirmPassword: 'Different-one-2',
    }))).toEqual({ error: 'The two passwords do not match.' });
    expect(resetUserPassword).not.toHaveBeenCalled();
  });
});

describe('changePasswordAction', () => {
  // The form confirms the change on its own page before offering sign-in,
  // rather than landing the user on the login screen unannounced.
  it('reports success instead of redirecting', async () => {
    expect(await changePasswordAction({}, form({
      currentPassword: 'old-password', newPassword: 'Long-enough-1',
      confirmPassword: 'Long-enough-1',
    }))).toEqual({ done: true });
    expect(redirect).not.toHaveBeenCalled();
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password', newPassword: 'Long-enough-1',
    });
  });

  // iam answers a wrong current password with a 400, which must reach the form
  // rather than being mistaken for an expired session.
  it('shows a wrong current password on the form instead of redirecting', async () => {
    changePassword.mockResolvedValueOnce({ state: 'unavailable', status: 400, message: 'Your current password is incorrect' });
    expect(await changePasswordAction({}, form({
      currentPassword: 'wrong-one', newPassword: 'Long-enough-1', confirmPassword: 'Long-enough-1',
    }))).toEqual({ error: 'Your current password is incorrect' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sends passwords exactly as typed, spaces included', async () => {
    await changePasswordAction({}, form({
      currentPassword: ' old-password ', newPassword: 'Long-enough-1 ', confirmPassword: 'Long-enough-1 ',
    }));
    expect(changePassword).toHaveBeenCalledWith({ currentPassword: ' old-password ', newPassword: 'Long-enough-1 ' });
  });

  it('refuses a new password equal to the current one without a round trip', async () => {
    expect(await changePasswordAction({}, form({
      currentPassword: 'Long-enough-1', newPassword: 'Long-enough-1',
      confirmPassword: 'Long-enough-1',
    }))).toEqual({ error: 'The new password must be different from the current one.' });
    expect(changePassword).not.toHaveBeenCalled();
  });
});

describe('setProjectAccessAction', () => {
  const scopes = (projectIds: string[]) => ({ state: 'ready', data: { global: false, projectIds, siteIds: [] } });

  it('grants the newly ticked projects and revokes the unticked ones', async () => {
    getUserScopes.mockResolvedValueOnce(scopes(['p-1', 'p-2']));
    expect(await setProjectAccessAction({}, form({
      userId: 'u-1', offered: ['p-1', 'p-2', 'p-3'], projectIds: ['p-2', 'p-3'],
    }))).toEqual({});
    expect(grantProjectAccess.mock.calls).toEqual([['u-1', 'p-3']]);
    expect(revokeProjectAccess.mock.calls).toEqual([['u-1', 'p-1']]);
    expect(revalidatePath).toHaveBeenCalledWith('/users/u-1');
  });

  it('never revokes a project the form did not offer', async () => {
    // The viewer could not see p-9, so it was not on the form; its absence
    // from the ticked list is not a request to remove it.
    getUserScopes.mockResolvedValueOnce(scopes(['p-1', 'p-9']));
    expect(await setProjectAccessAction({}, form({ userId: 'u-1', offered: ['p-1'], projectIds: [] }))).toEqual({});
    expect(revokeProjectAccess.mock.calls).toEqual([['u-1', 'p-1']]);
    expect(grantProjectAccess).not.toHaveBeenCalled();
  });

  it('ignores a ticked id the form did not offer', async () => {
    getUserScopes.mockResolvedValueOnce(scopes([]));
    expect(await setProjectAccessAction({}, form({ userId: 'u-1', offered: ['p-1'], projectIds: ['p-1', 'p-x'] }))).toEqual({});
    expect(grantProjectAccess.mock.calls).toEqual([['u-1', 'p-1']]);
  });

  it('stops at the first refusal and reports it', async () => {
    getUserScopes.mockResolvedValueOnce(scopes([]));
    grantProjectAccess.mockResolvedValueOnce({ state: 'forbidden', message: 'Missing scope.grant' });
    expect(await setProjectAccessAction({}, form({ userId: 'u-1', offered: ['p-1', 'p-2'], projectIds: ['p-1', 'p-2'] })))
      .toEqual({ error: 'Missing scope.grant' });
    expect(grantProjectAccess).toHaveBeenCalledTimes(1);
  });

  it('reports a failure to read the current access', async () => {
    getUserScopes.mockResolvedValueOnce({ state: 'forbidden', message: 'Missing scope.view' });
    expect(await setProjectAccessAction({}, form({ userId: 'u-1', offered: ['p-1'], projectIds: ['p-1'] })))
      .toEqual({ error: 'Missing scope.view' });
    expect(grantProjectAccess).not.toHaveBeenCalled();
  });
});
