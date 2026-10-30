import { BadRequestException, Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ChangePasswordSchema, LoginSchema, RefreshSchema, type TokenPair } from '@ipms/contracts';
import { Public, type AuthzUser } from '@ipms/authz';
import { AuthService, GENERIC_FAILURE } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Unauthenticated by necessity — this is where a caller with no token gets
   * one. `JwtUserGuard` is registered as an APP_GUARD, so without `@Public()`
   * it rejects the login request before the handler runs and no one can ever
   * authenticate. Same for `refresh`, which is redeemed precisely when the
   * access token has expired.
   */
  /**
   * A body the schema refuses is answered exactly like a wrong password.
   *
   * Two reasons, and the first is the one that bites: `LoginSchema.parse`
   * throws a ZodError that nothing handles, so a password below the policy
   * length leaves this service as a 500 — and a caller cannot tell a 500 apart
   * from the platform being down, so the browser reports the API as unavailable
   * when the input was merely refused. The second is that spelling out *which*
   * rule failed would disclose the password policy to an unauthenticated
   * caller; `GENERIC_FAILURE` is the same answer a wrong password gets.
   */
  @Public()
  @Post('login')
  async login(@Body() body: unknown): Promise<TokenPair> {
    const credentials = LoginSchema.safeParse(body);
    if (!credentials.success) throw new UnauthorizedException(GENERIC_FAILURE);
    return this.auth.login(credentials.data);
  }

  /** Refused the same way, and for the same reasons, as `login` above. */
  @Public()
  @Post('refresh')
  async refresh(@Body() body: unknown): Promise<TokenPair> {
    const parsed = RefreshSchema.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException('Invalid refresh token');
    return this.auth.refresh(parsed.data.refreshToken);
  }

  @Post('logout')
  async logout(@Req() req: { user?: AuthzUser }): Promise<{ status: 'ok' }> {
    if (!req.user) throw new UnauthorizedException('Authentication required');
    await this.auth.revokeAll(req.user.id);
    return { status: 'ok' };
  }

  /**
   * Authenticated but unguarded by any permission, on purpose: the caller's
   * token carries none while they owe a change, and this is the one route that
   * lets them out of that state.
   */
  @Post('change-password')
  async changePassword(@Body() body: unknown, @Req() req: { user?: AuthzUser }): Promise<{ status: 'ok' }> {
    if (!req.user) throw new UnauthorizedException('Authentication required');
    const parsed = ChangePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid password payload');
    }
    await this.auth.changePassword(req.user.id, parsed.data);
    return { status: 'ok' };
  }

  @Get('me')
  async me(@Req() req: { user?: AuthzUser }): Promise<AuthzUser> {
    if (!req.user) throw new UnauthorizedException('Authentication required');
    return req.user;
  }
}
