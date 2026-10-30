import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { GENERIC_FAILURE } from './auth.service.js';

/**
 * These cover the controller's own job — turning an untrusted body into either
 * a call on the service or a refusal — so the service is a stub throughout.
 *
 * The case that matters is a body the schema rejects. `LoginSchema.parse`
 * throws a ZodError, which nothing handles, so it leaves the service as a 500;
 * the web app reads any 5xx as "the platform is unreachable" and tells the user
 * the API is down when in fact their input was simply refused.
 */
function build() {
  const auth = {
    login: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }),
    refresh: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }),
    revokeAll: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn().mockResolvedValue(undefined),
  };
  return { controller: new AuthController(auth as never), auth };
}

describe('AuthController.login', () => {
  it('delegates a valid credential pair to the service', async () => {
    const { controller, auth } = build();
    const pair = await controller.login({ email: 'engineer@ipms.local', password: 'demo12345' });

    expect(auth.login).toHaveBeenCalledWith({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(pair.accessToken).toBe('a');
  });

  it('refuses a password below the policy length with 401, not a 500', async () => {
    const { controller, auth } = build();

    await expect(controller.login({ email: 'engineer@ipms.local', password: 'short' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('answers a refused body with the same message as a wrong password, disclosing no policy', async () => {
    const { controller } = build();

    await expect(controller.login({ email: 'engineer@ipms.local', password: 'short' }))
      .rejects.toThrow(GENERIC_FAILURE);
  });

  it.each([
    ['a missing password', { email: 'engineer@ipms.local' }],
    ['an empty email', { email: '', password: 'demo12345' }],
    ['a non-object body', 'not-a-body'],
    ['null', null],
  ])('refuses %s with 401', async (_label, body) => {
    const { controller, auth } = build();

    await expect(controller.login(body)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.login).not.toHaveBeenCalled();
  });
});

describe('AuthController.refresh', () => {
  it('redeems a well-formed refresh token', async () => {
    const { controller, auth } = build();
    await controller.refresh({ refreshToken: 'a'.repeat(20) });

    expect(auth.refresh).toHaveBeenCalledWith('a'.repeat(20));
  });

  it.each([
    ['a missing token', {}],
    ['a non-string token', { refreshToken: 42 }],
    ['a non-object body', null],
  ])('refuses %s with 401 rather than a 500', async (_label, body) => {
    const { controller, auth } = build();

    await expect(controller.refresh(body)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.refresh).not.toHaveBeenCalled();
  });
});

describe('AuthController.changePassword', () => {
  it('refuses malformed or invalid password payload with 400 BadRequestException', async () => {
    const { controller, auth } = build();
    const req = { user: { id: 'user-1', roles: [], scopes: [] } };

    await expect(controller.changePassword({ oldPassword: 'old', newPassword: 'short' }, req as never))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(auth.changePassword).not.toHaveBeenCalled();
  });
});
