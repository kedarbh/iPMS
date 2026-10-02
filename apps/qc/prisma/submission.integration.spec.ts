import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import type { AuthzScope } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import type { MediaClient } from '../src/submissions/media.client.js';
import { SubmissionService } from '../src/submissions/submission.service.js';
import type { SiteGeofenceClient } from '../src/submissions/site-geofence.client.js';
import { startTestDb } from './test-db.js';
import { ACTOR, resetDb, seedPublishedTemplate, seedWorkOrder, type SeededWorkOrder } from './fixtures.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: SubmissionService;
const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const noGeofence = { fetch: async () => null } as unknown as SiteGeofenceClient;
const DAY = 86_400_000;
// A media that finds every file usable, reporting kinds from `kinds`.
let kinds: Record<string, 'PHOTO' | 'VIDEO'> = {};
let attachCalls = 0;
// Runs inside `attach`, after media has answered: the window between the checks and the write.
let duringAttach: (() => Promise<unknown>) | null = null;
const fakeMedia = {
  check: async (body: { mediaIds: string[] }) => body.mediaIds.map((id) => ({ id, kind: kinds[id] ?? 'PHOTO', usable: true })),
  attach: async () => { attachCalls += 1; await duringAttach?.(); return 'attached' as const; },
} as unknown as MediaClient;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  service = new SubmissionService(prisma, noGeofence, fakeMedia, 7);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); kinds = {}; attachCalls = 0; duringAttach = null; });

const assignTask = (templateId: string, overrides: { status?: string } = {}) => seedWorkOrder(prisma, templateId, overrides);

const submitFor = (task: SeededWorkOrder, templateVersionId: string, itemId: string, actor = ACTOR) => service.createSubmission({
  taskId: task.id, siteId: task.siteId, projectId: task.projectId, templateVersionId,
  idempotencyKey: `key-${uuidv7()}`,
  responses: [{ itemId, selfCheckResult: 'PASS', mediaIds: [] }],
}, actor, 'Bearer t');

const submit = async (templateVersionId: string, itemId: string) => {
  const version = await prisma.templateVersion.findUniqueOrThrow({ where: { id: templateVersionId } });
  return submitFor(await assignTask(version.templateId), templateVersionId, itemId);
};

describe('createSubmission against template versions', () => {
  it('accepts the published version and records its number', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    const submission = await submit(versionId, itemId);
    expect(submission).toMatchObject({ templateId, templateVersionId: versionId, templateVersion: 1, geofenceStatus: 'UNVERIFIED' });
  });

  it('accepts a version retired within the grace window', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma, { status: 'RETIRED', retiredAt: new Date(Date.now() - 2 * DAY) });
    await expect(submit(versionId, itemId)).resolves.toBeTruthy();
  });

  it('refuses a version retired before the grace window', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma, { status: 'RETIRED', retiredAt: new Date(Date.now() - 9 * DAY) });
    await expect(submit(versionId, itemId)).rejects.toThrow('This checklist has been updated');
  });

  it('refuses a disabled template', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma, { disabled: true });
    await expect(submit(versionId, itemId)).rejects.toThrow('This checklist has been disabled');
  });
});

describe('createSubmission against its work order', () => {
  it('refuses someone the work order is not assigned to', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    await expect(submitFor(await assignTask(templateId), versionId, itemId, uuidv7())).rejects.toThrow('This work order is not assigned to you');
  });

  it('refuses a checklist other than the work order’s own', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma);
    const other = await seedPublishedTemplate(prisma, { code: 'EHS-1' });
    await expect(submitFor(await assignTask(other.templateId), versionId, itemId)).rejects.toThrow('not the checklist assigned');
  });

  it('refuses a cancelled work order', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    await expect(submitFor(await assignTask(templateId, { status: 'CANCELLED' }), versionId, itemId)).rejects.toThrow('cancelled');
  });

  it('refuses a second submission while the first awaits review', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    const task = await assignTask(templateId);
    await submitFor(task, versionId, itemId);
    await expect(submitFor(task, versionId, itemId)).rejects.toThrow('awaiting review');
  });

  it('accepts a new attempt after rework is requested, and publishes both facts', async () => {
    const { versionId, itemId, templateId } = await seedPublishedTemplate(prisma);
    const task = await assignTask(templateId);
    const first = await submitFor(task, versionId, itemId);
    await service.reviewSubmission(first.id, { decision: 'REJECT_REWORK', comment: 'Blurred', itemReviews: [{ itemId, result: 'REJECTED' }] }, ACTOR, GLOBAL);
    const second = await submitFor(task, versionId, itemId);
    expect(second.attemptNo).toBe(2);

    const events = await prisma.outboxEvent.findMany({ where: { subject: { startsWith: 'qc.submission.' } }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => [e.subject, (e.payload as { attemptNo: number }).attemptNo])).toEqual([
      ['qc.submission.submitted', 1], ['qc.submission.reviewed', 1], ['qc.submission.submitted', 2],
    ]);
    expect(events[1]!.payload).toMatchObject({ taskId: task.id, decision: 'REJECT_REWORK', comment: 'Blurred' });
  });
});

describe('createSubmission with evidence', () => {
  const seedPhotoItem = async () => {
    const seeded = await seedPublishedTemplate(prisma);
    await prisma.checklistItem.update({ where: { id: seeded.itemId }, data: { minPhotos: 1, maxPhotos: 2, maxVideos: 1 } });
    return seeded;
  };
  const withMedia = (task: SeededWorkOrder, versionId: string, itemId: string, mediaIds: string[]) => service.createSubmission({
    taskId: task.id, siteId: task.siteId, projectId: task.projectId, templateVersionId: versionId,
    idempotencyKey: `key-${uuidv7()}`, responses: [{ itemId, selfCheckResult: 'PASS', mediaIds }],
  }, ACTOR, 'Bearer t');

  it('records each file with its kind, in order, and removes the draft', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    await prisma.workOrderDraft.create({ data: { workOrderId: task.id, holderId: ACTOR, deviceId: 'd', deviceLabel: 'P', version: 3, responses: [] } });
    const [photo, video] = [uuidv7(), uuidv7()];
    kinds = { [video]: 'VIDEO' };
    const submission = await service.createSubmission({
      taskId: task.id, siteId: task.siteId, projectId: task.projectId, templateVersionId: versionId, deviceId: 'd',
      idempotencyKey: `key-${uuidv7()}`, responses: [{ itemId, selfCheckResult: 'PASS', mediaIds: [photo, video] }],
    }, ACTOR, 'Bearer t');
    const stored = await prisma.itemMedia.findMany({ where: { itemResponse: { submissionId: submission.id } }, orderBy: { sequence: 'asc' } });
    expect(stored.map((m) => [m.mediaId, m.kind, m.sequence])).toEqual([[photo, 'PHOTO', 0], [video, 'VIDEO', 1]]);
    expect(await prisma.workOrderDraft.count({ where: { workOrderId: task.id } })).toBe(0);
  });

  it('lets exactly one of two concurrent submissions of one work order through', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    const results = await Promise.allSettled([withMedia(task, versionId, itemId, [uuidv7()]), withMedia(task, versionId, itemId, [uuidv7()])]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(await prisma.submission.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('returns the original to a concurrent retry with the same idempotency key', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    const dto = {
      taskId: task.id, siteId: task.siteId, projectId: task.projectId, templateVersionId: versionId,
      idempotencyKey: `key-${uuidv7()}`, responses: [{ itemId, selfCheckResult: 'PASS' as const, mediaIds: [uuidv7()] }],
    };
    const [a, b] = await Promise.all([service.createSubmission(dto, ACTOR, 'Bearer t'), service.createSubmission(dto, ACTOR, 'Bearer t')]);
    expect(a.id).toBe(b.id);
    expect(await prisma.submission.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('refuses when another device takes the draft over while evidence is being attached, keeping its draft', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    await prisma.workOrderDraft.create({ data: { workOrderId: task.id, holderId: ACTOR, deviceId: 'd', deviceLabel: 'Pixel 7', version: 1, responses: [] } });
    duringAttach = () => prisma.workOrderDraft.update({ where: { workOrderId: task.id }, data: { deviceId: 'tab', deviceLabel: 'Galaxy Tab', version: 2 } });
    await expect(service.createSubmission({
      taskId: task.id, siteId: task.siteId, projectId: task.projectId, templateVersionId: versionId, deviceId: 'd',
      idempotencyKey: `key-${uuidv7()}`, responses: [{ itemId, selfCheckResult: 'PASS', mediaIds: [uuidv7()] }],
    }, ACTOR, 'Bearer t')).rejects.toMatchObject({ status: 409, response: { details: { reason: 'DRAFT_HELD_ELSEWHERE', deviceLabel: 'Galaxy Tab' } } });
    expect(await prisma.workOrderDraft.findUnique({ where: { workOrderId: task.id } })).toMatchObject({ deviceId: 'tab', version: 2 });
    expect(await prisma.submission.count({ where: { taskId: task.id } })).toBe(0);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('ONGOING');
  });

  it('refuses when the work order is cancelled while evidence is being attached, and it stays cancelled', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    duringAttach = () => prisma.workOrder.update({ where: { id: task.id }, data: { status: 'CANCELLED' } });
    await expect(withMedia(task, versionId, itemId, [uuidv7()])).rejects.toMatchObject({ status: 409, message: 'This work order has been cancelled' });
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('CANCELLED');
    expect(await prisma.submission.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('refuses the old assignee when the work order is reassigned while evidence is being attached', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    duringAttach = () => prisma.workOrder.update({ where: { id: task.id }, data: { assigneeId: uuidv7() } });
    await expect(withMedia(task, versionId, itemId, [uuidv7()])).rejects.toMatchObject({ status: 403 });
    expect(await prisma.submission.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('refuses a submit when another submission of the work order commits while its evidence is being attached', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    let other: { id: string } | undefined;
    duringAttach = async () => { duringAttach = null; other = await withMedia(task, versionId, itemId, [uuidv7()]); };
    await expect(withMedia(task, versionId, itemId, [uuidv7()])).rejects.toMatchObject({ status: 409, message: 'This task already has a submission awaiting review' });
    const stored = await prisma.submission.findMany({ where: { taskId: task.id } });
    expect(stored.map((s) => s.id)).toEqual([other!.id]);
  });

  it('accepts a retry after a failure between attach and the write', async () => {
    const { versionId, itemId, templateId } = await seedPhotoItem();
    const task = await assignTask(templateId, { status: 'ONGOING' });
    const photo = uuidv7();
    // Fail the first write after media has attached, as a crash would.
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(() => Promise.reject(new Error('connection lost')));
    try {
      await expect(withMedia(task, versionId, itemId, [photo])).rejects.toThrow('connection lost');
      await expect(withMedia(task, versionId, itemId, [photo])).resolves.toMatchObject({ attemptNo: 1 });
      expect(attachCalls).toBe(2);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('getSubmission scope', () => {
  it('hides a submission outside the caller’s scope as not found', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma);
    const submission = await submit(versionId, itemId);
    await expect(service.getSubmission(submission.id, { global: false, projectIds: [submission.projectId], siteIds: [] })).resolves.toMatchObject({ id: submission.id });
    await expect(service.getSubmission(submission.id, { global: false, projectIds: [uuidv7()], siteIds: [] })).rejects.toMatchObject({ status: 404 });
  });
});

describe('reviewSubmission scope', () => {
  const approve = (itemId: string) => ({ decision: 'APPROVE' as const, itemReviews: [{ itemId, result: 'APPROVED' as const }] });

  it('answers 404 outside the caller’s scope and writes nothing', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma);
    const submission = await submit(versionId, itemId);
    const outboxBefore = await prisma.outboxEvent.count();
    const timelineBefore = await prisma.workOrderEvent.count();

    await expect(service.reviewSubmission(submission.id, approve(itemId), ACTOR, { global: false, projectIds: [uuidv7()], siteIds: [uuidv7()] }))
      .rejects.toMatchObject({ status: 404 });
    await expect(service.reviewSubmission(submission.id, approve(itemId), ACTOR, { global: false, projectIds: [], siteIds: [] }))
      .rejects.toMatchObject({ status: 404 });

    expect(await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).toMatchObject({ status: 'SUBMITTED', reviewedBy: null, reviewedAt: null });
    expect(await prisma.itemResponse.findMany({ where: { submissionId: submission.id } })).toEqual([expect.objectContaining({ reviewResult: 'PENDING', reviewedBy: null })]);
    expect(await prisma.reviewDecision.count({ where: { submissionId: submission.id } })).toBe(0);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: submission.taskId } })).status).toBe('REVIEWING');
    expect(await prisma.outboxEvent.count()).toBe(outboxBefore);
    expect(await prisma.workOrderEvent.count()).toBe(timelineBefore);
  });

  it('reviews within the caller’s scope, reached by project or by site', async () => {
    const { versionId, itemId } = await seedPublishedTemplate(prisma);
    const byProject = await submit(versionId, itemId);
    await expect(service.reviewSubmission(byProject.id, approve(itemId), ACTOR, { global: false, projectIds: [byProject.projectId], siteIds: [] }))
      .resolves.toMatchObject({ id: byProject.id, status: 'APPROVED' });

    const bySite = await submit(versionId, itemId);
    await expect(service.reviewSubmission(bySite.id, approve(itemId), ACTOR, { global: false, projectIds: [], siteIds: [bySite.siteId] }))
      .resolves.toMatchObject({ id: bySite.id, status: 'APPROVED' });
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: bySite.taskId } })).status).toBe('COMPLETED');
  });
});
