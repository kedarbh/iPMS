import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

async function login(user: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { email: `${user}@ipms.local`, password: DEMO_PASSWORD } });
  expect(res.status).toBe(201);
  return res.body.accessToken;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// Two real 16×16 JPEGs (sharp can decode them, so they verify as READY).
const ORANGE = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKQAI2f/2Q==', 'base64');
const BLUE = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIAB6Ev/2Q==', 'base64');
// An MP4 media only sniffs (`ftyp` at offset 4); its poster is a real JPEG.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), randomBytes(4000)]);

let admin: string;
let qc: string;
let engineer: string;
let engineerId: string;
let qcId: string;
beforeAll(async () => {
  await waitForReady();
  [admin, qc, engineer] = await Promise.all([login('admin'), login('qc'), login('engineer')]);
  engineerId = (await api<{ items: { id: string }[] }>('/api/v1/users?search=engineer', { token: admin })).body.items[0]!.id;
  qcId = (await api<{ items: { id: string; email: string }[] }>('/api/v1/users?search=qc@ipms.local', { token: admin })).body.items.find((user) => user.email === 'qc@ipms.local')!.id;
}, 90_000);

async function upload(workOrderId: string, itemId: string, kind: 'PHOTO' | 'VIDEO', bytes: Buffer, poster?: Buffer): Promise<string> {
  const id = uuidv7();
  const registered = await api<{ upload: { signedUrl: string; headers: Record<string, string> }; posterUpload: { signedUrl: string; headers: Record<string, string> } | null }>('/api/v1/media/uploads', {
    method: 'POST', token: engineer,
    body: { id, category: 'EVIDENCE', workOrderId, checklistItemId: itemId, kind, contentType: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4', sizeBytes: bytes.length, contentHash: sha(bytes), capturedAt: new Date().toISOString(), deviceId: 'e2e-phone' },
  });
  expect(registered.status).toBe(201);
  if (poster) expect((await fetch(registered.body.posterUpload!.signedUrl, { method: 'PUT', body: poster, headers: registered.body.posterUpload!.headers })).status).toBe(200);
  expect((await fetch(registered.body.upload.signedUrl, { method: 'PUT', body: bytes, headers: registered.body.upload.headers })).status).toBe(200);
  expect((await api(`/api/v1/media/uploads/${id}/complete`, { method: 'POST', token: engineer, body: {} })).status).toBe(200);
  return id;
}

async function waitReady(ids: string[]): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const statuses = (await api<{ status: string }[]>('/api/v1/media/uploads/status', { method: 'POST', token: engineer, body: { ids } })).body.map((s) => s.status);
    if (statuses.every((s) => s === 'READY' || s === 'ATTACHED')) return;
    expect(statuses).not.toContain('REJECTED');
    await sleep(500);
  }
  throw new Error('media did not verify in time');
}

describe('QC evidence', () => {
  it('draft → takeover → submit with a photo and a video → rework reuses a file → approve', async () => {
    const stamp = Date.now();
    const templateId = (await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code: `EV-${stamp}`, name: 'E2E evidence', category: 'QUALITY' } })).body.templateId;
    await api(`/api/v1/qc/templates/${templateId}/draft`, { method: 'PUT', token: qc, body: { revision: 1, document: { sections: [{ number: '1', title: 'Install', items: [
      { number: '1.1', requirementText: 'Serial label', minPhotos: 1, maxPhotos: 2, minVideos: 0, maxVideos: 1 },
    ] }] } } });
    expect((await api(`/api/v1/qc/templates/${templateId}/publish`, { method: 'POST', token: qc })).status).toBe(201);
    const projectId = (await api<{ id: string }>('/api/v1/projects', { method: 'POST', token: admin, body: { code: `EV-${stamp}`, name: 'Evidence e2e' } })).body.id;
    const siteId = (await api<{ id: string }>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', token: admin, body: { siteCode: 'KOS121', name: 'KOS121' } })).body.id;
    const scope = { level: 'PROJECT', projectId };
    // The engineer submits and qc reviews; each only on sites its scope reaches.
    await api(`/api/v1/users/${engineerId}/projects`, { method: 'POST', token: admin, body: scope });
    await api(`/api/v1/users/${qcId}/projects`, { method: 'POST', token: admin, body: scope });
    let workOrderId = '';
    try {
      await sleep(1500); // scope replicates to project over NATS
      workOrderId = (await api<{ created: { id: string }[] }>('/api/v1/work-orders', { method: 'POST', token: admin, body: {
        projectId, workOrderType: 'QUALITY_SELF_CHECK', templateId, siteIds: [siteId], assigneeId: engineerId, plannedCompletionAt: '2026-12-31T18:14:59Z',
      } })).body.created[0]!.id;
      const checklist = await api<{ version: { id: string; sections: { items: { id: string }[] }[] } }>(`/api/v1/qc/tasks/${workOrderId}/checklist`, { token: engineer });
      const itemId = checklist.body.version.sections[0]!.items[0]!.id;
      const versionId = checklist.body.version.id;

      // Draft on the phone; the tablet must take over before it can save; the phone is then refused.
      const phone = { deviceId: 'phone-a', deviceLabel: 'Pixel 7' };
      const tablet = { deviceId: 'tab-b', deviceLabel: 'Galaxy Tab' };
      const saved = await api<{ version: number }>(`/api/v1/work-orders/${workOrderId}/draft`, { method: 'PUT', token: engineer, body: { ...phone, baseVersion: 0, responses: [{ itemId, selfCheckResult: 'PASS' }] } });
      expect(saved.status).toBe(200);
      expect((await api<{ status: string }>(`/api/v1/work-orders/${workOrderId}`, { token: admin })).body.status).toBe('ONGOING');
      const blocked = await api<{ error: { details: { reason: string } } }>(`/api/v1/work-orders/${workOrderId}/draft`, { method: 'PUT', token: engineer, body: { ...tablet, baseVersion: 1, responses: [] } });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.details.reason).toBe('DRAFT_HELD_ELSEWHERE');
      expect((await api(`/api/v1/work-orders/${workOrderId}/draft/takeover`, { method: 'POST', token: engineer, body: tablet })).status).toBe(200);
      const phoneLate = await api<{ error: { details: { reason: string } } }>(`/api/v1/work-orders/${workOrderId}/draft`, { method: 'PUT', token: engineer, body: { ...phone, baseVersion: 2, responses: [] } });
      expect(phoneLate.body.error.details.reason).toBe('DRAFT_HELD_ELSEWHERE');

      // Evidence: one photo and one video with its poster.
      const photo = await upload(workOrderId, itemId, 'PHOTO', ORANGE);
      const video = await upload(workOrderId, itemId, 'VIDEO', MP4, BLUE);
      await waitReady([photo, video]);

      const submit = (mediaIds: string[], deviceId: string) => api<{ id: string; attemptNo: number }>('/api/v1/qc/submissions', { method: 'POST', token: engineer, body: {
        taskId: workOrderId, siteId, projectId, templateVersionId: versionId, idempotencyKey: `e2e-${uuidv7()}`, deviceId,
        responses: [{ itemId, selfCheckResult: 'PASS', mediaIds }],
      } });
      // The phone no longer holds the draft.
      expect((await submit([photo, video], 'phone-a')).status).toBe(409);
      const first = await submit([photo, video], 'tab-b');
      expect(first.status).toBe(201);
      expect((await api(`/api/v1/work-orders/${workOrderId}/draft`, { token: engineer })).status).toBe(409); // REVIEWING: closed to drafts

      const review = (id: string, decision: string, result: string) => api(`/api/v1/qc/submissions/${id}/review`, { method: 'POST', token: qc, body: { decision, comment: 'e2e', itemReviews: [{ itemId, result }] } });
      expect((await review(first.body.id, 'REJECT_REWORK', 'REJECTED')).status).toBe(201);

      // Rework: the draft is pre-filled with the same files; replace the photo, keep the video.
      const prefill = await api<{ version: number; responses: { mediaIds: string[] }[] }>(`/api/v1/work-orders/${workOrderId}/draft`, { token: engineer });
      expect(prefill.body.version).toBe(0);
      expect(prefill.body.responses[0]!.mediaIds).toEqual([photo, video]);
      const newPhoto = await upload(workOrderId, itemId, 'PHOTO', BLUE);
      await waitReady([newPhoto]);
      const second = await submit([newPhoto, video], 'any-device');
      expect(second.status).toBe(201);
      expect(second.body.attemptNo).toBe(2);
      expect((await review(second.body.id, 'APPROVE', 'APPROVED')).status).toBe(201);

      type Detail = { responses: { media: { mediaId: string; kind: string; sequence: number }[] }[] };
      const firstDetail = await api<Detail>(`/api/v1/qc/submissions/${first.body.id}`, { token: qc });
      const secondDetail = await api<Detail>(`/api/v1/qc/submissions/${second.body.id}`, { token: qc });
      expect(firstDetail.body.responses[0]!.media.map((m) => [m.mediaId, m.kind])).toEqual([[photo, 'PHOTO'], [video, 'VIDEO']]);
      expect(secondDetail.body.responses[0]!.media.map((m) => [m.mediaId, m.kind])).toEqual([[newPhoto, 'PHOTO'], [video, 'VIDEO']]);

      // Reviewers can open the files.
      const link = await api<{ signedUrl: string }>(`/api/v1/media/${video}/url?variant=thumbnail`, { token: qc });
      expect(link.status).toBe(200);
      expect((await fetch(link.body.signedUrl)).status).toBe(200);

      // Download link carries an attachment disposition.
      const dl = await api<{ signedUrl: string }>(`/api/v1/media/${photo}/url?variant=original&download=1`, { token: qc });
      expect(dl.status).toBe(200);
      expect((await fetch(dl.body.signedUrl)).headers.get('content-disposition')).toMatch(/^attachment;/);

      const events = (await api<{ events: { kind: string }[] }>(`/api/v1/work-orders/${workOrderId}`, { token: admin })).body.events.map((e) => e.kind);
      expect(events).toEqual(['CREATED', 'STARTED', 'SUBMITTED', 'REJECTED', 'SUBMITTED', 'APPROVED']);
    } finally {
      await api(`/api/v1/users/${engineerId}/projects`, { method: 'DELETE', token: admin, body: scope });
      await api(`/api/v1/users/${qcId}/projects`, { method: 'DELETE', token: admin, body: scope });
    }
  }, 120_000);

  it('refuses unknown evidence with MEDIA_NOT_READY, naming the file', async () => {
    const stamp = Date.now();
    const templateId = (await api<{ templateId: string }>('/api/v1/qc/templates', { method: 'POST', token: qc, body: { code: `EVX-${stamp}`, name: 'E2E evidence refusal', category: 'QUALITY' } })).body.templateId;
    await api(`/api/v1/qc/templates/${templateId}/draft`, { method: 'PUT', token: qc, body: { revision: 1, document: { sections: [{ number: '1', title: 'Install', items: [{ number: '1.1', requirementText: 'Label', minPhotos: 1, maxPhotos: 1 }] }] } } });
    await api(`/api/v1/qc/templates/${templateId}/publish`, { method: 'POST', token: qc });
    const projectId = (await api<{ id: string }>('/api/v1/projects', { method: 'POST', token: admin, body: { code: `EVX-${stamp}`, name: 'Evidence refusal' } })).body.id;
    const siteId = (await api<{ id: string }>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', token: admin, body: { siteCode: 'KOS122', name: 'KOS122' } })).body.id;
    const scope = { level: 'PROJECT', projectId };
    await api(`/api/v1/users/${engineerId}/projects`, { method: 'POST', token: admin, body: scope });
    try {
      await sleep(1500);
      const workOrderId = (await api<{ created: { id: string }[] }>('/api/v1/work-orders', { method: 'POST', token: admin, body: {
        projectId, workOrderType: 'QUALITY_SELF_CHECK', templateId, siteIds: [siteId], assigneeId: engineerId, plannedCompletionAt: '2026-12-31T18:14:59Z',
      } })).body.created[0]!.id;
      const checklist = await api<{ version: { id: string; sections: { items: { id: string }[] }[] } }>(`/api/v1/qc/tasks/${workOrderId}/checklist`, { token: engineer });
      const unknown = uuidv7();
      const refused = await api<{ error: { code: string; details: { reason: string; files: { id: string; reason: string }[] } } }>('/api/v1/qc/submissions', { method: 'POST', token: engineer, body: {
        taskId: workOrderId, siteId, projectId, templateVersionId: checklist.body.version.id, idempotencyKey: `e2e-${uuidv7()}`,
        responses: [{ itemId: checklist.body.version.sections[0]!.items[0]!.id, selfCheckResult: 'PASS', mediaIds: [unknown] }],
      } });
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({ code: 'CONFLICT', details: { reason: 'MEDIA_NOT_READY', files: [{ id: unknown, reason: 'NOT_FOUND' }] } });
      await api(`/api/v1/work-orders/${workOrderId}/cancel`, { method: 'POST', token: admin, body: { reason: 'e2e cleanup' } });
    } finally {
      await api(`/api/v1/users/${engineerId}/projects`, { method: 'DELETE', token: admin, body: scope });
    }
  }, 90_000);
});
