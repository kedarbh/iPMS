import { describe, expect, it, vi, beforeEach } from 'vitest';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { SubmissionService } from './submission.service.js';

describe('SubmissionService', () => {
  let service: SubmissionService;
  let prisma: any;
  let geofenceClient: any;
  let media: any;
  let kinds: Record<string, 'PHOTO' | 'VIDEO'> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    kinds = {};

    prisma = {
      submission: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        aggregate: vi.fn().mockResolvedValue({ _max: { attemptNo: 1 } }),
        create: vi.fn(),
        update: vi.fn(),
      },
      workOrder: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      templateVersion: {
        findUnique: vi.fn(),
      },
      itemResponse: {
        create: vi.fn(),
        update: vi.fn(),
      },
      itemMedia: {
        createMany: vi.fn(),
      },
      workOrderDraft: { findUnique: vi.fn().mockResolvedValue(null), deleteMany: vi.fn() },
      outboxEvent: {
        create: vi.fn(),
      },
      auditEvent: {
        create: vi.fn(),
      },
      workOrderEvent: {
        create: vi.fn(),
      },
      reviewDecision: {
        create: vi.fn(),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (cb) => cb(prisma)),
    };

    geofenceClient = {
      fetch: vi.fn().mockResolvedValue(null),
    };

    media = {
      check: vi.fn(async (body: { mediaIds: string[] }) => body.mediaIds.map((id) => ({ id, kind: kinds[id] ?? 'PHOTO', usable: true }))),
      attach: vi.fn().mockResolvedValue('attached'),
    };
    service = new SubmissionService(prisma, geofenceClient, media, 7);
  });

  describe('createSubmission validation', () => {
    const actorId = '0192f7a0-0000-7000-8000-000000000001';
    const taskId = '0192f7a0-0000-7000-8000-000000000002';
    const projectId = '0192f7a0-0000-7000-8000-000000000003';
    const siteId = '0192f7a0-0000-7000-8000-000000000004';
    const templateId = '0192f7a0-0000-7000-8000-000000000005';
    const templateVersionId = '0192f7a0-0000-7000-8000-000000000006';
    const itemId = '0192f7a0-0000-7000-8000-000000000007';

    beforeEach(() => {
      prisma.submission.findUnique.mockResolvedValue(null); // not duplicate
      prisma.submission.findFirst.mockResolvedValue(null); // no pending

      prisma.workOrder.findUnique.mockResolvedValue({
        id: taskId,
        assigneeId: actorId,
        status: 'ONGOING',
        projectId,
        siteId,
        templateId,
      });

      prisma.templateVersion.findUnique.mockResolvedValue({
        id: templateVersionId,
        templateId,
        version: 1,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        template: { status: 'ACTIVE' },
        sections: [
          {
            id: 'sec-1',
            items: [
              {
                id: itemId,
                number: '1.1',
                isRequired: true,
                allowsNa: false,
                minPhotos: 1,
                maxPhotos: 5,
                minVideos: 0,
                maxVideos: 1,
              },
            ],
          },
        ],
      });
    });

    const P = (n: number) => `0192f7a0-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;
    const dtoWith = (mediaIds: string[], extra: Record<string, unknown> = {}) => ({
      taskId, siteId, projectId, templateVersionId, idempotencyKey: `idem-${Math.random()}`,
      responses: [{ itemId, selfCheckResult: 'PASS' as const, mediaIds }], ...extra,
    });

    it('counts photos and videos by the kinds media reports', async () => {
      kinds = { [P(2)]: 'VIDEO' };
      prisma.submission.create.mockResolvedValue({ id: 'sub-1', attemptNo: 2, submittedAt: new Date() });
      prisma.itemResponse.create.mockResolvedValue({ id: 'resp-1' });
      await service.createSubmission(dtoWith([P(1), P(2)]) as any, actorId, 'Bearer t');
      expect(media.check).toHaveBeenCalledWith({ workOrderId: taskId, siteId, mediaIds: [P(1), P(2)] }, 'Bearer t');
      expect(prisma.itemMedia.createMany).toHaveBeenCalledWith({ data: [
        { id: expect.any(String), itemResponseId: 'resp-1', mediaId: P(1), kind: 'PHOTO', sequence: 0 },
        { id: expect.any(String), itemResponseId: 'resp-1', mediaId: P(2), kind: 'VIDEO', sequence: 1 },
      ] });
      const submissionId = prisma.submission.create.mock.calls[0][0].data.id;
      expect(media.attach).toHaveBeenCalledWith({ submissionId, workOrderId: taskId, siteId, mediaIds: [P(1), P(2)] }, 'Bearer t');
      expect(prisma.workOrderDraft.deleteMany).toHaveBeenCalledWith({ where: { workOrderId: taskId } });
    });

    it('refuses too few photos without attaching anything', async () => {
      kinds = { [P(1)]: 'VIDEO' };
      await expect(service.createSubmission(dtoWith([P(1)]) as any, actorId, 'b')).rejects.toThrow('Item 1.1 needs 1–5 photos; it has 0');
      expect(media.attach).not.toHaveBeenCalled();
    });

    it('refuses too many videos', async () => {
      kinds = { [P(2)]: 'VIDEO', [P(3)]: 'VIDEO' };
      await expect(service.createSubmission(dtoWith([P(1), P(2), P(3)]) as any, actorId, 'b')).rejects.toThrow('Item 1.1 allows at most 1 video; it has 2');
    });

    it('refuses the same file twice', async () => {
      await expect(service.createSubmission(dtoWith([P(1), P(1)]) as any, actorId, 'b')).rejects.toThrow('Item 1.1 lists the same file twice');
    });

    it('refuses with MEDIA_NOT_READY and each file’s reason', async () => {
      media.check.mockResolvedValue([{ id: P(1), kind: 'PHOTO', usable: false, reason: 'UPLOADING' }]);
      await expect(service.createSubmission(dtoWith([P(1)]) as any, actorId, 'b')).rejects.toMatchObject({
        status: 409, response: { details: { reason: 'MEDIA_NOT_READY', files: [{ id: P(1), reason: 'UPLOADING' }] } },
      });
      expect(media.attach).not.toHaveBeenCalled();
    });

    it('re-checks and refuses when attach loses a race', async () => {
      media.attach.mockResolvedValue('refused');
      media.check
        .mockResolvedValueOnce([{ id: P(1), kind: 'PHOTO', usable: true }])
        .mockResolvedValueOnce([{ id: P(1), kind: 'PHOTO', usable: false, reason: 'NOT_FOUND' }]);
      await expect(service.createSubmission(dtoWith([P(1)]) as any, actorId, 'b')).rejects.toMatchObject({
        status: 409, response: { details: { reason: 'MEDIA_NOT_READY', files: [{ id: P(1), reason: 'NOT_FOUND' }] } },
      });
      expect(prisma.submission.create).not.toHaveBeenCalled();
    });

    it('refuses while the draft is held by another device', async () => {
      prisma.workOrderDraft.findUnique.mockResolvedValue({ deviceId: 'other', deviceLabel: 'Pixel 7', updatedAt: new Date('2026-09-30T08:00:00Z') });
      await expect(service.createSubmission(dtoWith([P(1)], { deviceId: 'mine' }) as any, actorId, 'b')).rejects.toMatchObject({
        status: 409, response: { details: { reason: 'DRAFT_HELD_ELSEWHERE', deviceLabel: 'Pixel 7' } },
      });
    });

    it('refuses more than 500 files in one submission before asking media', async () => {
      const ids = Array.from({ length: 501 }, (_, n) => `0192f7a0-0000-7000-8000-${String(n).padStart(12, '0')}`);
      await expect(service.createSubmission(dtoWith(ids) as any, actorId, 'b')).rejects.toMatchObject({ status: 400, message: 'A submission can carry at most 500 files' });
      expect(media.check).not.toHaveBeenCalled();
    });

    it.each([
      ['a file is missing from the answer', [{ id: P(1), kind: 'PHOTO', usable: true }]],
      ['a file is answered twice', [{ id: P(1), kind: 'PHOTO', usable: true }, { id: P(1), kind: 'PHOTO', usable: true }, { id: P(2), kind: 'PHOTO', usable: true }]],
      ['an unknown file is answered', [{ id: P(1), kind: 'PHOTO', usable: true }, { id: P(3), kind: 'PHOTO', usable: true }]],
      ['a usable file has no kind', [{ id: P(1), kind: 'PHOTO', usable: true }, { id: P(2), kind: null, usable: true }]],
    ])('answers 503 when media’s answer is inconsistent: %s', async (_label, answer) => {
      media.check.mockResolvedValue(answer);
      await expect(service.createSubmission(dtoWith([P(1), P(2)]) as any, actorId, 'b')).rejects.toMatchObject({
        status: 503, message: 'Evidence could not be checked right now. Try again shortly.',
      });
      expect(media.attach).not.toHaveBeenCalled();
    });

    it('re-checks the assignee, status and draft holder under the work-order lock', async () => {
      // Pre-check sees a free work order; inside the transaction another device holds the draft.
      prisma.workOrderDraft.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ deviceId: 'other', deviceLabel: 'Pixel 7', updatedAt: new Date() });
      await expect(service.createSubmission(dtoWith([P(1)]) as any, actorId, 'b')).rejects.toMatchObject({ status: 409, response: { details: { reason: 'DRAFT_HELD_ELSEWHERE' } } });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.submission.create).not.toHaveBeenCalled();
    });

    it('still refuses N/A where it is not allowed', async () => {
      const dto = { ...dtoWith([P(1)]), responses: [{ itemId, selfCheckResult: 'NA' as const, mediaIds: [P(1)] }] };
      await expect(service.createSubmission(dto as any, actorId, 'b')).rejects.toThrow('Item 1.1 does not allow N/A');
    });
  });

  describe('reviewSubmission', () => {
    const actorId = '0192f7a0-0000-7000-8000-000000000001';
    const submissionId = '0192f7a0-0000-7000-8000-000000000002';
    const itemId = '0192f7a0-0000-7000-8000-000000000003';
    const taskId = '0192f7a0-0000-7000-8000-000000000004';
    const projectId = '0192f7a0-0000-7000-8000-000000000005';
    const scope: AuthzScope = { global: false, projectIds: [projectId], siteIds: [] };

    beforeEach(() => {
      prisma.submission.findFirst.mockResolvedValue({
        id: submissionId,
        status: 'SUBMITTED',
        taskId,
        projectId,
        attemptNo: 1,
        responses: [
          {
            id: 'resp-1',
            itemId,
            item: { id: itemId, number: '1.1' },
          },
        ],
      });
      prisma.submission.update.mockResolvedValue({
        id: submissionId,
        status: 'APPROVED',
        taskId,
        projectId,
        attemptNo: 1,
        reviewedAt: new Date(),
      });
      prisma.workOrder.findUnique.mockResolvedValue({ id: taskId });
    });

    it('looks the submission up within the caller’s scope', async () => {
      const dto = { decision: 'APPROVE' as const, itemReviews: [{ itemId, result: 'APPROVED' as const }] };
      await service.reviewSubmission(submissionId, dto, actorId, scope);
      expect(prisma.submission.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { AND: [{ id: submissionId }, scopeWhere(scope)] },
      }));
    });

    it('answers 404 for a submission outside the caller’s scope, before writing anything', async () => {
      prisma.submission.findFirst.mockResolvedValue(null);
      const dto = { decision: 'APPROVE' as const, itemReviews: [{ itemId, result: 'APPROVED' as const }] };
      await expect(service.reviewSubmission(submissionId, dto, actorId, { global: false, projectIds: [], siteIds: [] }))
        .rejects.toMatchObject({ status: 404 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.itemResponse.update).not.toHaveBeenCalled();
      expect(prisma.reviewDecision.create).not.toHaveBeenCalled();
      expect(prisma.submission.update).not.toHaveBeenCalled();
      expect(prisma.workOrder.updateMany).not.toHaveBeenCalled();
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });

    it('rejects approval when an item review is REJECTED', async () => {
      const dto = {
        decision: 'APPROVE' as const,
        itemReviews: [
          {
            itemId,
            result: 'REJECTED' as const,
            description: 'Photo blur',
          },
        ],
      };

      await expect(service.reviewSubmission(submissionId, dto as any, actorId, scope)).rejects.toThrow(
        'A submission with rejected items cannot be approved',
      );
    });

    it('successfully approves submission and completes work order when all items pass', async () => {
      const dto = {
        decision: 'APPROVE' as const,
        comment: 'All tests verified',
        itemReviews: [
          {
            itemId,
            result: 'APPROVED' as const,
          },
        ],
      };

      await service.reviewSubmission(submissionId, dto as any, actorId, scope);
      expect(prisma.reviewDecision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ decision: 'APPROVE' }),
        }),
      );
      expect(prisma.workOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('successfully rejects submission and sets work order to RECTIFYING when decision is REJECT', async () => {
      const dto = {
        decision: 'REJECT' as const,
        comment: 'Rework needed',
        itemReviews: [
          {
            itemId,
            result: 'REJECTED' as const,
            description: 'Insufficient photo evidence',
          },
        ],
      };

      prisma.submission.update.mockResolvedValue({
        id: submissionId,
        status: 'REJECTED_REWORK',
        taskId,
        projectId,
        attemptNo: 1,
        reviewedAt: new Date(),
      });

      await service.reviewSubmission(submissionId, dto as any, actorId, scope);
      expect(prisma.workOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RECTIFYING' }),
        }),
      );
    });
  });
});
