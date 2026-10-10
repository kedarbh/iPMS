import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

async function login(user: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { email: `${user}@ipms.local`, password: DEMO_PASSWORD } });
  expect(res.status, `${user} login`).toBe(201);
  return res.body.accessToken;
}

/** Scope grants replicate through iam's outbox and NATS, so poll for the outcome. */
async function eventually<T>(read: () => Promise<T>, until: (v: T) => boolean, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (until(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function userId(admin: string, email: string): Promise<string> {
  const page = await api<{ items: { id: string; email: string }[] }>(`/api/v1/users?search=${email.split('@')[0]}`, { token: admin });
  return page.body.items.find((u) => u.email === email)!.id;
}

interface Request { id: string; status: string; approvedAmount: string | null }
interface Overview { queue: { id: string }[]; pipeline: { steps: { status: string; mine: boolean }[] }; decisions: { trimmed: { count: number } } }

let manager: string;
let director: string;
let projectId: string;
let categoryId: string;

beforeAll(async () => {
  await waitForReady();
  const admin = await login('admin');
  const projects = (await api<{ id: string }[]>('/api/v1/projects', { token: admin })).body;
  expect(projects.length, 'the stack needs at least one project').toBeGreaterThan(0);
  projectId = projects[0]!.id;
  // Granting is idempotent; the grants are left in place, as they would be for real users.
  for (const email of ['manager@ipms.local', 'director@ipms.local']) {
    const res = await api(`/api/v1/users/${await userId(admin, email)}/projects`, { method: 'POST', token: admin, body: { level: 'PROJECT', projectId } });
    expect([200, 201, 204]).toContain(res.status);
  }
  [manager, director] = await Promise.all([login('manager'), login('director')]);
  for (const token of [manager, director]) {
    await eventually(() => api<{ id: string }[]>('/api/v1/projects', { token }), (r) => r.body.some((p) => p.id === projectId));
  }
  categoryId = (await api<{ id: string; disabledAt: string | null }[]>('/api/v1/finance/categories', { token: manager })).body.find((c) => !c.disabledAt)!.id;
}, 120_000);

describe('Project Director finance', () => {
  it('sees a request waiting, trims and approves it, and finds it among their decisions', async () => {
    const created = await api<Request>('/api/v1/finance/requests', {
      method: 'POST', token: manager, body: { kind: 'ADVANCE', projectId, categoryId, purpose: `E2E director ${Date.now()}`, amount: '5000' },
    });
    expect(created.status).toBe(201);
    const submitted = await api<Request>(`/api/v1/finance/requests/${created.body.id}/submit`, { method: 'POST', token: manager });
    // A project manager's own request skips the PM step and goes to the Director.
    expect(submitted.body.status).toBe('PENDING_DIRECTOR');

    const before = await api<Overview>('/api/v1/finance/overview', { token: director });
    expect(before.status).toBe(200);
    expect(before.body.pipeline.steps.find((s) => s.mine)?.status).toBe('PENDING_DIRECTOR');
    const awaiting = await api<{ items: Request[] }>('/api/v1/finance/requests?view=awaiting&limit=100', { token: director });
    expect(awaiting.body.items.map((r) => r.id)).toContain(created.body.id);

    const approved = await api<Request>(`/api/v1/finance/requests/${created.body.id}/approve`, { method: 'POST', token: director, body: { amount: '4000' } });
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ status: 'PENDING_FINANCE', approvedAmount: '4000.00' });

    const handled = await api<{ items: Request[] }>('/api/v1/finance/requests?view=handled&limit=100', { token: director });
    expect(handled.body.items.map((r) => r.id)).toContain(created.body.id);
    const after = await api<Overview>('/api/v1/finance/overview', { token: director });
    expect(after.body.decisions.trimmed.count).toBe(before.body.decisions.trimmed.count + 1);
  });

  it('serves the portfolio and the work order summary to the Director', async () => {
    const portfolio = await api<{ id: string }[]>('/api/v1/dashboard/portfolio', { token: director });
    expect(portfolio.status).toBe(200);
    expect(Array.isArray(portfolio.body)).toBe(true);
    const summary = await api<unknown[]>('/api/v1/work-orders/summary', { token: director });
    expect(summary.status).toBe(200);
    expect(Array.isArray(summary.body)).toBe(true);
  });
});
