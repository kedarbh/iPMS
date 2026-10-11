import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

const TEMP = 'Temp#Pass1234';
const FINAL = 'Final#Pass1234';

let admin: string;
const created: string[] = [];

async function login(email: string, password: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { email, password } });
  expect(res.status, `${email} login`).toBe(201);
  return res.body.accessToken;
}

/**
 * Creates a field engineer as an administrator would, then signs them in past
 * the forced password change: a new account's token carries no permissions at
 * all until its holder replaces the temporary password.
 */
async function engineer(label: string, financeEnabled?: boolean): Promise<{ token: string; id: string }> {
  const email = `e2e.${label}.${Date.now()}@ipms.local`;
  const res = await api<{ id: string; financeEnabled: boolean }>('/api/v1/users', {
    method: 'POST', token: admin,
    body: {
      email, fullName: `E2E ${label}`, password: TEMP, roleCodes: ['FIELD_ENGINEER'],
      ...(financeEnabled === undefined ? {} : { financeEnabled }),
    },
  });
  expect(res.status).toBe(201);
  created.push(res.body.id);
  const first = await login(email, TEMP);
  const changed = await api('/api/v1/auth/change-password', {
    method: 'POST', token: first, body: { currentPassword: TEMP, newPassword: FINAL },
  });
  expect(changed.status).toBe(201);
  return { token: await login(email, FINAL), id: res.body.id };
}

beforeAll(async () => {
  await waitForReady();
  admin = await login('admin@ipms.local', DEMO_PASSWORD);
}, 120_000);

afterAll(async () => {
  for (const id of created) await api(`/api/v1/users/${id}`, { method: 'DELETE', token: admin });
});

describe('finance for a field engineer', () => {
  it('is on by default: the token carries finance and the finance API answers', async () => {
    const { token } = await engineer('inhouse');
    const me = await api<{ permissions: string[] }>('/api/v1/auth/me', { token });
    expect(me.body.permissions).toContain('finance_request.create');
    expect((await api('/api/v1/finance/requests', { token })).status).toBe(200);
  });

  it('can be off: the token carries no finance permission and the finance API refuses', async () => {
    const { token } = await engineer('vendor', false);
    const me = await api<{ permissions: string[] }>('/api/v1/auth/me', { token });
    expect(me.body.permissions.filter((p) => p.startsWith('finance_'))).toEqual([]);
    expect(me.body.permissions).toContain('task.view');
    expect((await api('/api/v1/finance/requests', { token })).status).toBe(403);
    const raised = await api('/api/v1/finance/requests', {
      method: 'POST', token, body: { kind: 'ADVANCE', projectId: '00000000-0000-4000-8000-000000000000', categoryId: '00000000-0000-4000-8000-000000000000', purpose: 'E2E', amount: '100' },
    });
    expect(raised.status).toBe(403);
  });

  it('shows the choice on the user the API returns', async () => {
    const { id } = await engineer('flag', false);
    const read = await api<{ financeEnabled: boolean }>(`/api/v1/users/${id}`, { token: admin });
    expect(read.status).toBe(200);
    expect(read.body.financeEnabled).toBe(false);
  });

  it('is refused for any role but a field engineer', async () => {
    const res = await api('/api/v1/users', {
      method: 'POST', token: admin,
      body: { email: `e2e.qc.${Date.now()}@ipms.local`, fullName: 'E2E QC', password: TEMP, roleCodes: ['QC_MANAGER'], financeEnabled: false },
    });
    expect(res.status).toBe(400);
  });
});
