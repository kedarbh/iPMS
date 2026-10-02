import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

async function login(user: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { email: `${user}@ipms.local`, password: DEMO_PASSWORD } });
  expect(res.status).toBe(201);
  return res.body.accessToken;
}

/** A syntactically valid v7 id for media the suite never uploads. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let admin: string;
let qc: string;
let engineer: string;
let engineerId: string;
let qcId: string;

beforeAll(async () => {
  await waitForReady();
  [admin, qc, engineer] = await Promise.all([login('admin'), login('qc'), login('engineer')]);
  const users = await api<{ items: { id: string }[] }>('/api/v1/users?search=engineer', { token: admin });
  engineerId = users.body.items[0]!.id;
  const qcUsers = await api<{ items: { id: string; email: string }[] }>('/api/v1/users?search=qc@ipms.local', { token: admin });
  qcId = qcUsers.body.items.find((user) => user.email === 'qc@ipms.local')!.id;
}, 90_000);

/** qc moves a work order in the same transaction as the submission or review, so one read is enough. */
async function statusOf(id: string): Promise<string> {
  return (await api<{ status: string }>(`/api/v1/work-orders/${id}`, { token: admin })).body.status;
}

describe('work orders', () => {
  it('assign a checklist to sites → submit → rework → approve, across two projects sharing a site code', async () => {
    const stamp = Date.now();
    const created = await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code: `WO-${stamp}`, name: 'E2E antenna', category: 'QUALITY' } });
    const templateId = created.body.templateId;
    const document = { sections: [{ number: '1', title: 'EHS', items: [{ number: '1.1', requirementText: 'PPE worn', minPhotos: 0, maxPhotos: 0 }] }] };
    await api(`/api/v1/qc/templates/${templateId}/draft`, { method: 'PUT', token: qc, body: { revision: 1, document } });
    expect((await api(`/api/v1/qc/templates/${templateId}/publish`, { method: 'POST', token: qc })).status).toBe(201);

    const project = async (code: string) => (await api<{ id: string }>('/api/v1/projects', { method: 'POST', token: admin, body: { code, name: code } })).body.id;
    const site = async (projectId: string) => (await api<{ id: string }>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', token: admin, body: { siteCode: 'KOS102X', name: 'KOS102X' } })).body.id;
    const antenna = await project(`ANT-${stamp}`);
    const power = await project(`PWR-${stamp}`);
    const [antennaSite, powerSite] = await Promise.all([site(antenna), site(power)]);
    const scope = { level: 'PROJECT', projectId: antenna };
    // qc reviews submissions only on sites its scope reaches, and the seeded qc user holds none of a fresh project.
    await api(`/api/v1/users/${engineerId}/projects`, { method: 'POST', token: admin, body: scope });
    await api(`/api/v1/users/${qcId}/projects`, { method: 'POST', token: admin, body: scope });
    // project-scope.e2e asserts the seeded engineer starts with no projects, and
    // the stack's database outlives the run, so hand the grants back either way.
    try {
      await sleep(1500); // scope replicates to project over NATS

      const batch = (projectId: string, siteId: string) => api<{ created: { id: string; title: string; project: { code: string } }[] }>(
        '/api/v1/work-orders',
        { method: 'POST', token: admin, body: { projectId, workOrderType: 'QUALITY_SELF_CHECK', templateId, siteIds: [siteId], assigneeId: engineerId, plannedCompletionAt: '2026-12-31T18:14:59Z' } },
      );
      // The engineer holds the antenna project only: the same site code under the power project is out of reach.
      expect((await batch(power, powerSite)).status).toBe(400);
      const made = await batch(antenna, antennaSite);
      expect(made.status).toBe(201);
      expect(made.body.created[0]).toMatchObject({ title: '[Quality Self-check]KOS102X', project: { code: `ANT-${stamp}` } });
      const id = made.body.created[0]!.id;

      const checklist = await api<{ version: { id: string; sections: { items: { id: string }[] }[] } }>(`/api/v1/qc/tasks/${id}/checklist`, { token: engineer });
      const submit = () => api<{ id: string }>('/api/v1/qc/submissions', {
        method: 'POST', token: engineer,
        body: {
          taskId: id, siteId: antennaSite, projectId: antenna, templateVersionId: checklist.body.version.id, idempotencyKey: `e2e-${Math.random()}`,
          responses: [{ itemId: checklist.body.version.sections[0]!.items[0]!.id, selfCheckResult: 'PASS' }],
        },
      });
      const review = (submissionId: string, decision: string, result: string) => api(`/api/v1/qc/submissions/${submissionId}/review`, {
        method: 'POST', token: qc,
        body: { decision, comment: 'e2e', itemReviews: [{ itemId: checklist.body.version.sections[0]!.items[0]!.id, result }] },
      });

      const first = await submit();
      expect(first.status).toBe(201);
      expect(await statusOf(id)).toBe('REVIEWING');
      expect((await review(first.body.id, 'REJECT_REWORK', 'REJECTED')).status).toBe(201);
      expect(await statusOf(id)).toBe('RECTIFYING');
      const second = await submit();
      expect(second.status).toBe(201);
      expect(await statusOf(id)).toBe('REVIEWING');
      expect((await review(second.body.id, 'APPROVE', 'APPROVED')).status).toBe(201);
      expect(await statusOf(id)).toBe('COMPLETED');

      const detail = await api<{ actualCompletionAt: string | null; events: { kind: string }[] }>(`/api/v1/work-orders/${id}`, { token: admin });
      expect(detail.body.actualCompletionAt).not.toBeNull();
      expect(detail.body.events.map((e) => e.kind)).toEqual(['CREATED', 'SUBMITTED', 'REJECTED', 'SUBMITTED', 'APPROVED']);

      const queue = await api<{ total: number; items: { id: string }[] }>(`/api/v1/work-orders?projectId=${antenna}&status=COMPLETED`, { token: admin });
      expect(queue.body.items.map((item) => item.id)).toContain(id);
      const brief = await api<{ id: string }[]>(`/api/v1/work-orders/by-project/${antenna}`, { token: admin });
      expect(brief.body.map((row) => row.id)).toContain(id);

      // The site still has a work order in qc, so project will not delete it.
      expect((await api(`/api/v1/sites/${antennaSite}`, { method: 'DELETE', token: admin })).status).toBe(409);
    } finally {
      await api(`/api/v1/users/${engineerId}/projects`, { method: 'DELETE', token: admin, body: scope });
      await api(`/api/v1/users/${qcId}/projects`, { method: 'DELETE', token: admin, body: scope });
    }
  }, 60_000);

  it('keeps /internal endpoints off the gateway', async () => {
    for (const path of ['/api/v1/internal/scope', '/api/v1/internal/work-orders/usage?siteId=0192f7a0-0000-7000-8000-000000000001']) {
      expect((await api(path, { token: admin })).status).toBe(404);
    }
  });
});
