import { createSign } from 'node:crypto';
import { createLogger } from '@ipms/observability';
import type { PushMessage, PushResult, PushSender } from './push.sender.js';

const log = createLogger('notification');

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Android channel the app creates for its notifications; must match the app. */
export const ANDROID_CHANNEL = 'ipms_default';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Parses a Google service-account key, or returns null if it is not one. */
export function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const key = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof key.project_id === 'string' && typeof key.client_email === 'string' && typeof key.private_key === 'string') {
      return { project_id: key.project_id, client_email: key.client_email, private_key: key.private_key };
    }
  } catch {
    // fall through
  }
  return null;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/** FCM errors that mean this token will never work again. */
const DEAD_TOKEN = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND']);

/**
 * Sends through Firebase Cloud Messaging's HTTP v1 API, authenticating with a
 * service-account key (a signed JWT exchanged for a short-lived access token).
 * Free, and only outbound calls to Google, so it works from any server.
 */
export class FcmSender implements PushSender {
  readonly enabled = true;
  private cached: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async send(tokens: readonly string[], message: PushMessage): Promise<PushResult> {
    const invalid: string[] = [];
    if (tokens.length === 0) return { invalidTokens: invalid };
    const access = await this.accessToken();
    // A handful of devices per person; a small batch at a time keeps one slow call from holding the rest.
    for (let i = 0; i < tokens.length; i += 10) {
      await Promise.all(tokens.slice(i, i + 10).map(async (token) => {
        if (!(await this.sendOne(access, token, message))) invalid.push(token);
      }));
    }
    return { invalidTokens: invalid };
  }

  /** True unless FCM says the token is dead. Other failures are logged and the token is kept. */
  private async sendOne(access: string, token: string, message: PushMessage): Promise<boolean> {
    const response = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: message.title, body: message.body },
          data: message.data,
          android: { priority: 'HIGH', notification: { channel_id: ANDROID_CHANNEL } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (response.ok) return true;
    const detail = (await response.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
    const status = detail.error?.status ?? '';
    if (DEAD_TOKEN.has(status) && response.status !== 401 && response.status !== 403) return false;
    log.warn({ httpStatus: response.status, status, message: detail.error?.message }, 'push send failed');
    return true;
  }

  private async accessToken(): Promise<string> {
    const nowMs = this.now();
    if (this.cached && this.cached.expiresAt - 60_000 > nowMs) return this.cached.value;
    const iat = Math.floor(nowMs / 1000);
    const claims = { iss: this.account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 };
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.account.private_key);
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
    });
    if (!response.ok) throw new Error(`FCM token exchange failed (${response.status})`);
    const body = (await response.json()) as { access_token: string; expires_in?: number };
    this.cached = { value: body.access_token, expiresAt: nowMs + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }
}
