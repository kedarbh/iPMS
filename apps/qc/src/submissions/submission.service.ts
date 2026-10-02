import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma-clients/qc';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { uuidv7, type CreateSubmissionDto, type MediaKind, type ReviewSubmissionDto } from '@ipms/contracts';
import { SUBJECTS, type QcSubmissionReviewed, type QcSubmissionSubmitted } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord } from '@ipms/persistence';
import { recordAudit } from '../templates/audit.js';
import { event } from '../work-orders/work-order.service.js';
import type { MediaClient } from './media.client.js';
import { draftHeldElsewhere, mediaNotReady } from './refusals.js';
import { resolveGeofence, type SiteGeofenceClient } from './site-geofence.client.js';
import { acceptVersion } from './version-acceptance.js';

const REFUSAL = {
  DISABLED: () => new ConflictException('This checklist has been disabled'),
  NOT_PUBLISHED: () => new ConflictException('This checklist version has not been published'),
  SUPERSEDED: () => new ConflictException('This checklist has been updated. Refresh to get the latest version.'),
} as const;

/** media's check and attach take at most this many ids per call. */
const MAX_FILES_PER_SUBMISSION = 500;

type Submittable = { assigneeId: string; status: string };
type DraftHolder = { deviceId: string; deviceLabel: string; updatedAt: Date };

/**
 * Who may submit against a work order, and when. Checked once up front and
 * again under the work-order row lock just before writing, so a cancel,
 * reassign or draft takeover that lands in between is not missed.
 */
function assertSubmittable(order: Submittable, draft: DraftHolder | null, actorId: string, deviceId: string | undefined): void {
  if (order.assigneeId !== actorId) throw new ForbiddenException('This work order is not assigned to you');
  if (order.status === 'CANCELLED') throw new ConflictException('This work order has been cancelled');
  if (draft && draft.deviceId !== deviceId) throw draftHeldElsewhere(draft);
}

/** A live submission of the task blocks another one, unless it is this very request, retried. */
const pendingOf = (taskId: string) => ({
  where: { taskId, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] as ('SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED')[] } },
  select: { id: true, idempotencyKey: true, status: true },
});

/** Thrown when the live submission turns out to be this request's own: the caller answers with it. */
class AlreadySubmitted extends Error {
  constructor(readonly id: string) {
    super(`Submission ${id} already exists for this idempotency key`);
    this.name = 'AlreadySubmitted';
  }
}

function assertNoneLive(pending: { id: string; idempotencyKey: string; status: string } | null, idempotencyKey: string): void {
  if (!pending) return;
  if (pending.idempotencyKey === idempotencyKey) throw new AlreadySubmitted(pending.id);
  throw new ConflictException(pending.status === 'APPROVED' ? 'This task has already been approved' : 'This task already has a submission awaiting review');
}

const DRAFT_HOLDER = { deviceId: true, deviceLabel: true, updatedAt: true } as const;
const evidenceUncheckable = () => new ServiceUnavailableException('Evidence could not be checked right now. Try again shortly.');

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly geofence: SiteGeofenceClient,
    private readonly media: MediaClient,
    private readonly graceDays: number,
  ) {}

  /** A submission the caller's scope reaches; anything else reads as not found. */
  async getSubmission(id: string, scope: AuthzScope) {
    const found = await this.prisma.submission.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: { id: true } });
    if (!found) throw new NotFoundException('Submission not found');
    return this.load(id);
  }

  private async load(id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: { responses: { include: { item: true, media: { orderBy: { sequence: 'asc' } } } }, decisions: true, template: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }

  /**
   * `bearer` is the submitting user's own Authorization header, forwarded to
   * the project service so the geofence lookup stays permission-checked.
   */
  async createSubmission(dto: CreateSubmissionDto, actorId: string, bearer: string) {
    try {
      return await this.submit(dto, actorId, bearer);
    } catch (err) {
      if (err instanceof AlreadySubmitted) return this.load(err.id);
      throw err;
    }
  }

  private async submit(dto: CreateSubmissionDto, actorId: string, bearer: string) {
    const duplicate = await this.prisma.submission.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (duplicate) return this.load(duplicate.id);
    // The work order is what a submission moves, so it decides who may submit:
    // the person it is assigned to, against the checklist it carries, while open.
    const task = await this.prisma.workOrder.findUnique({ where: { id: dto.taskId } });
    if (!task) throw new NotFoundException('Work order not found');
    const draft = await this.prisma.workOrderDraft.findUnique({ where: { workOrderId: task.id }, select: DRAFT_HOLDER });
    assertSubmittable(task, draft, actorId, dto.deviceId);
    if (task.projectId !== dto.projectId || task.siteId !== dto.siteId) throw new BadRequestException('The submission does not match its work order’s project and site');
    const version = await this.prisma.templateVersion.findUnique({
      where: { id: dto.templateVersionId },
      include: { template: true, sections: { include: { items: true } } },
    });
    if (!version) throw new BadRequestException('Unknown checklist version');
    const acceptance = acceptVersion(version, version.template, new Date(), this.graceDays);
    if (!acceptance.ok) throw REFUSAL[acceptance.reason]();
    if (task.templateId !== version.templateId) throw new BadRequestException('This is not the checklist assigned to this task');
    assertNoneLive(await this.prisma.submission.findFirst(pendingOf(dto.taskId)), dto.idempotencyKey);

    const items = version.sections.flatMap((section) => section.items);
    const responses = new Map(dto.responses.map((response) => [response.itemId, response]));
    if (responses.size !== dto.responses.length || items.some((item) => item.isRequired && !responses.has(item.id)) || [...responses.keys()].some((id) => !items.some((item) => item.id === id))) throw new BadRequestException('Responses must contain every required item from this template exactly once');
    for (const item of items) {
      const response = responses.get(item.id);
      if (!response) continue;
      if (response.selfCheckResult === 'NA' && !item.allowsNa) throw new BadRequestException(`Item ${item.number} does not allow N/A`);
      if (new Set(response.mediaIds).size !== response.mediaIds.length) throw new BadRequestException(`Item ${item.number} lists the same file twice`);
    }
    const allIds = dto.responses.flatMap((response) => response.mediaIds);
    if (new Set(allIds).size !== allIds.length) throw new BadRequestException('The same file is used by more than one item');
    if (allIds.length > MAX_FILES_PER_SUBMISSION) throw new BadRequestException(`A submission can carry at most ${MAX_FILES_PER_SUBMISSION} files`);

    // Ask media before anything is attached: a submission that fails its counts must not lock files in as evidence.
    const kinds = new Map<string, MediaKind>();
    if (allIds.length) {
      const checked = await this.media.check({ workOrderId: task.id, siteId: task.siteId, mediaIds: allIds }, bearer);
      // Exactly one answer per file asked about, and a kind for every usable one; anything else is a broken reply.
      const answered = new Set(checked.map((file) => file.id));
      if (checked.length !== allIds.length || answered.size !== allIds.length || allIds.some((id) => !answered.has(id))
        || checked.some((file) => file.usable && file.kind == null)) throw evidenceUncheckable();
      const unusable = checked.filter((file) => !file.usable);
      if (unusable.length) throw mediaNotReady(unusable);
      for (const file of checked) kinds.set(file.id, file.kind!);
    }
    for (const item of items) {
      const response = responses.get(item.id);
      if (!response) continue;
      const photos = response.mediaIds.filter((id) => kinds.get(id) === 'PHOTO').length;
      const videos = response.mediaIds.length - photos;
      checkCount(item.number, 'photo', photos, item.minPhotos, item.maxPhotos);
      checkCount(item.number, 'video', videos, item.minVideos, item.maxVideos);
    }

    const submissionId = uuidv7();
    if (allIds.length) {
      const attached = await this.media.attach({ submissionId, workOrderId: task.id, siteId: task.siteId, mediaIds: allIds }, bearer);
      if (attached === 'refused') {
        const again = await this.media.check({ workOrderId: task.id, siteId: task.siteId, mediaIds: allIds }, bearer);
        throw mediaNotReady(again.filter((file) => !file.usable));
      }
    }
    // If the write below fails, the files stay attached to `submissionId`, which is never stored.
    // A retry still passes attach: files attached to this work order are reusable by its next submission.

    const integrityHash = createHash('sha256').update(JSON.stringify(dto.responses.map((r) => ({ itemId: r.itemId, result: r.selfCheckResult, media: r.mediaIds.map((id) => `${kinds.get(id)}:${id}`).sort() })).sort((a, b) => a.itemId.localeCompare(b.itemId)))).digest('hex');
    // Never throws: an unreachable project service records UNVERIFIED rather
    // than failing a submission that represents work already done in the field.
    const outcome = resolveGeofence(await this.geofence.fetch(dto.siteId, bearer), dto);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // The same lock drafts, takeover, cancel and reassign take: re-check what may have changed during the calls above.
        await tx.$queryRaw`SELECT id FROM work_order WHERE id = ${task.id}::uuid FOR UPDATE`;
        const locked = await tx.workOrder.findUnique({ where: { id: task.id }, select: { assigneeId: true, status: true } });
        if (!locked) throw new NotFoundException('Work order not found');
        assertSubmittable(locked, await tx.workOrderDraft.findUnique({ where: { workOrderId: task.id }, select: DRAFT_HOLDER }), actorId, dto.deviceId);
        // Another submission may have committed while media was being called.
        assertNoneLive(await tx.submission.findFirst(pendingOf(dto.taskId)), dto.idempotencyKey);
        const last = await tx.submission.aggregate({ where: { taskId: dto.taskId }, _max: { attemptNo: true } });
        const submission = await tx.submission.create({ data: { id: submissionId, taskId: dto.taskId, siteId: dto.siteId, projectId: dto.projectId, templateId: version.templateId, templateVersionId: version.id, templateVersion: version.version, attemptNo: (last._max.attemptNo ?? 0) + 1, status: 'SUBMITTED', submittedBy: actorId, submittedAt: new Date(), integrityHash, idempotencyKey: dto.idempotencyKey, deviceId: dto.deviceId ?? null, latitude: dto.latitude ?? null, longitude: dto.longitude ?? null, distanceFromSiteM: outcome.distanceFromSiteM, geofenceStatus: outcome.geofenceStatus } });
        for (const response of dto.responses) {
          const itemResponse = await tx.itemResponse.create({ data: { id: uuidv7(), submissionId: submission.id, itemId: response.itemId, selfCheckResult: response.selfCheckResult, selfCheckDescription: response.selfCheckDescription ?? null, textValue: response.textValue ?? null, numberValue: response.numberValue ?? null, booleanValue: response.booleanValue ?? null, selectValue: response.selectValue ?? null } });
          if (response.mediaIds.length) await tx.itemMedia.createMany({ data: response.mediaIds.map((mediaId, sequence) => ({ id: uuidv7(), itemResponseId: itemResponse.id, mediaId, kind: kinds.get(mediaId)!, sequence })) });
        }
        const fact: QcSubmissionSubmitted = {
          submissionId: submission.id, taskId: submission.taskId, projectId: submission.projectId,
          attemptNo: submission.attemptNo, submittedBy: actorId, submittedAt: submission.submittedAt!.toISOString(),
        };
        await tx.outboxEvent.create({ data: buildOutboxRecord(SUBJECTS.QC_SUBMISSION_SUBMITTED, { ...fact }, getCorrelationId() ?? 'unknown', actorId) });
        // The work order moves with the submission, in the same transaction, so the two never disagree.
        await tx.workOrder.update({
          where: { id: task.id },
          data: { status: 'REVIEWING', currentSubmissionId: submission.id, currentAttemptNo: submission.attemptNo },
        });
        await recordAudit(tx, {
          actorId, action: 'work_order.status_changed', objectType: 'WorkOrder', objectId: task.id,
          previousState: { status: locked.status }, newState: { status: 'REVIEWING', submissionId: submission.id, attemptNo: submission.attemptNo },
        });
        await event(tx, task.id, 'SUBMITTED', submission.submittedAt!, actorId, { submissionId: submission.id, attemptNo: submission.attemptNo });
        await tx.workOrderDraft.deleteMany({ where: { workOrderId: task.id } });
        return submission;
      });
    } catch (err) {
      // Two submissions for one work order raced past the pending check; the unique (taskId, attemptNo) kept one.
      // If the winner was this same request retried, answer with it, as the duplicate check up front would have.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const original = await this.prisma.submission.findUnique({ where: { idempotencyKey: dto.idempotencyKey }, select: { id: true } });
        if (original) return this.load(original.id);
        throw new ConflictException('This task already has a submission awaiting review');
      }
      throw err;
    }
  }

  /** Scoped like `getSubmission`: a submission outside the caller's scope reads as not found, before anything is written. */
  async reviewSubmission(id: string, dto: ReviewSubmissionDto, actorId: string, scope: AuthzScope) {
    const submission = await this.prisma.submission.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, include: { responses: { include: { item: true } } } });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.status !== 'SUBMITTED' && submission.status !== 'UNDER_REVIEW') throw new ConflictException('Only submitted work can be reviewed');
    const reviews = new Map(dto.itemReviews.map((review) => [review.itemId, review]));
    if (reviews.size !== submission.responses.length || submission.responses.some((response) => !reviews.has(response.itemId))) throw new BadRequestException('Every submitted item needs a review result');
    const rejected = [...reviews.values()].some((review) => review.result === 'REJECTED');
    if (dto.decision === 'APPROVE' && rejected) throw new BadRequestException('A submission with rejected items cannot be approved');
    return this.prisma.$transaction(async (tx) => {
      for (const response of submission.responses) { const review = reviews.get(response.itemId)!; await tx.itemResponse.update({ where: { id: response.id }, data: { reviewResult: review.result, reviewDescription: review.description ?? null, reviewedBy: actorId, reviewedAt: new Date() } }); }
      const approved = dto.decision === 'APPROVE';
      await tx.reviewDecision.create({ data: { id: uuidv7(), submissionId: id, reviewerId: actorId, decision: dto.decision, comment: dto.comment ?? null } });
      const reviewed = await tx.submission.update({ where: { id }, data: { status: approved ? 'APPROVED' : 'REJECTED_REWORK', overallVerdict: approved ? 'PASS' : 'FAIL', reviewedBy: actorId, reviewedAt: new Date(), reviewComment: dto.comment ?? null } });
      const fact: QcSubmissionReviewed = {
        submissionId: reviewed.id, taskId: reviewed.taskId, projectId: reviewed.projectId, attemptNo: reviewed.attemptNo,
        decision: dto.decision, reviewedBy: actorId, reviewedAt: reviewed.reviewedAt!.toISOString(), comment: dto.comment ?? null,
      };
      await tx.outboxEvent.create({ data: buildOutboxRecord(SUBJECTS.QC_SUBMISSION_REVIEWED, { ...fact }, getCorrelationId() ?? 'unknown', actorId) });
      // A cancelled work order stays cancelled; the review is still on its timeline.
      const status = approved ? 'COMPLETED' : 'RECTIFYING';
      const moved = await tx.workOrder.updateMany({
        where: { id: reviewed.taskId, status: { not: 'CANCELLED' } },
        data: { status, currentSubmissionId: reviewed.id, currentAttemptNo: reviewed.attemptNo, actualCompletionAt: approved ? reviewed.reviewedAt : null },
      });
      if (moved.count > 0) {
        await recordAudit(tx, {
          actorId, action: 'work_order.status_changed', objectType: 'WorkOrder', objectId: reviewed.taskId,
          previousState: {}, newState: { status, submissionId: reviewed.id, attemptNo: reviewed.attemptNo },
        });
      }
      const order = await tx.workOrder.findUnique({ where: { id: reviewed.taskId }, select: { id: true } });
      if (order) {
        await event(tx, order.id, approved ? 'APPROVED' : 'REJECTED', reviewed.reviewedAt!, actorId, {
          submissionId: reviewed.id, attemptNo: reviewed.attemptNo, comment: dto.comment ?? null,
        });
      }
      return reviewed;
    });
  }
}

/** "needs 1–5 photos", "allows at most 1 video", "needs 2 videos". */
function checkCount(itemNumber: string, noun: 'photo' | 'video', count: number, min: number, max: number): void {
  if (count >= min && count <= max) return;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const wanted = max === 0 ? `allows no ${noun}s` : min === 0 ? `allows at most ${plural(max)}` : min === max ? `needs ${plural(min)}` : `needs ${min}–${max} ${noun}s`;
  throw new BadRequestException(`Item ${itemNumber} ${wanted}; it has ${count}`);
}
