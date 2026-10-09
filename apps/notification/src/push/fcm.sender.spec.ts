import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FcmSender, parseServiceAccount, type ServiceAccount } from './fcm.sender.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const account: ServiceAccount = { project_id: 'ipms-test', client_email: 'push@ipms-test.iam.gserviceaccount.com', private_key: privateKey };
const MESSAGE = { title: 'Approval needed', body: 'Waiting', data: { type: 'FINANCE_APPROVAL_NEEDED' } };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(fcm: (token: string) => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('oauth2.googleapis.com')) return json(200, { access_token: 'access-1', expires_in: 3600 });
    return fcm(JSON.parse(String(init?.body)).message.token);
  });
}

describe('parseServiceAccount', () => {
  it('reads a key, and refuses anything else', () => {
    expect(parseServiceAccount(JSON.stringify({ ...account, type: 'service_account' }))).toEqual(account);
    expect(parseServiceAccount('not json')).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: 'x' }))).toBeNull();
  });
});

describe('FcmSender', () => {
  it('exchanges a signed token for access once, and sends the message with the data and channel', async () => {
    const f = fakeFetch(() => json(200, { name: 'm' }));
    const sender = new FcmSender(account, f as never);
    await sender.send(['t1'], MESSAGE);
    await sender.send(['t2'], MESSAGE);
    const exchanges = f.mock.calls.filter(([u]) => String(u).includes('oauth2'));
    expect(exchanges).toHaveLength(1);
    const assertion = new URLSearchParams(String(exchanges[0]![1]!.body)).get('assertion')!;
    expect(assertion.split('.')).toHaveLength(3);
    const [url, init] = f.mock.calls.find(([u]) => String(u).includes('fcm.googleapis.com'))!;
    expect(String(url)).toBe('https://fcm.googleapis.com/v1/projects/ipms-test/messages:send');
    expect((init!.headers as Record<string, string>)['authorization']).toBe('Bearer access-1');
    const sent = JSON.parse(String(init!.body)).message;
    expect(sent).toMatchObject({ token: 't1', notification: { title: 'Approval needed', body: 'Waiting' }, data: { type: 'FINANCE_APPROVAL_NEEDED' }, android: { notification: { channel_id: 'ipms_default' } } });
  });

  it('asks again for access once it is about to expire', async () => {
    let clock = 0;
    const f = fakeFetch(() => json(200, {}));
    const sender = new FcmSender(account, f as never, () => clock);
    await sender.send(['t1'], MESSAGE);
    clock = 3_600_000;
    await sender.send(['t1'], MESSAGE);
    expect(f.mock.calls.filter(([u]) => String(u).includes('oauth2'))).toHaveLength(2);
  });

  it('reports tokens FCM says are dead, and keeps ones that failed for another reason', async () => {
    const f = fakeFetch((token) => {
      if (token === 'gone') return json(404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } });
      if (token === 'bad') return json(400, { error: { status: 'INVALID_ARGUMENT' } });
      if (token === 'busy') return json(503, { error: { status: 'UNAVAILABLE' } });
      return json(200, {});
    });
    const result = await new FcmSender(account, f as never).send(['ok', 'gone', 'bad', 'busy'], MESSAGE);
    expect(result.invalidTokens.sort()).toEqual(['bad', 'gone']);
  });

  it('does not call FCM without tokens, and fails loudly if the key is refused', async () => {
    const f = vi.fn();
    expect(await new FcmSender(account, f as never).send([], MESSAGE)).toEqual({ invalidTokens: [] });
    expect(f).not.toHaveBeenCalled();
    const refused = vi.fn(async () => json(401, { error: 'invalid_grant' }));
    await expect(new FcmSender(account, refused as never).send(['t'], MESSAGE)).rejects.toThrow(/token exchange failed/);
  });
});
