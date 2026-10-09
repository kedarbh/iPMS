import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import { SUBJECTS } from '@ipms/events';
import { uuidv7, type CreateRequestDto, type InvoiceInput, type RequestKind, type UpdateRequestDto } from '@ipms/contracts';
import type { FinanceRequest, PrismaClient } from '@prisma-clients/finance';
import { asJson, recordAudit } from '../audit.js';
import { inScope, notFound, requirePermission, type Actor, type ProjectRef, type Tx } from '../common.js';
import { emit, factsOf, recordAction } from '../events.js';
import { compareMoney, sumMoney } from '../money.js';
import { findDuplicates, repeatsWithin, type BillKey } from '../duplicates.js';
import { loadBalance } from '../ledger.js';
import { serializeDetail } from '../serialize.js';
import type { InvoiceFiles } from '../directory/media.client.js';
import { entryStatus, isEditable, isPending, isPm, stepOf } from '../workflow.js';

const NUMBER_PREFIX: Record<RequestKind, string> = { ADVANCE: 'ADV', SETTLEMENT: 'SET', REIMBURSEMENT: 'REI' };
/** The permission that raises a request of this kind. Checked again on edit and submit: it may have been revoked since the draft was made. */
const createPermission = (kind: string): string => (kind === 'SETTLEMENT' ? 'finance_settlement.submit' : 'finance_request.create');
const requireCreatePermission = (actor: Actor, row: FinanceRequest): void => requirePermission(actor, createPermission(row.kind));
const WITH_DETAIL = { invoices: true, actions: { orderBy: { at: 'asc' as const } }, payments: true };

/**
 * A request's life before anyone approves it: drafting, editing, submitting and
 * cancelling. Only the requester ever touches a request here.
 */
export class RequestService {
  /** `media` checks and attaches the invoice photos; without it files are not verified (unit tests, or a service run without media). */
  constructor(private readonly prisma: PrismaClient, private readonly media?: InvoiceFiles) {}

  /** `project` is required for an advance or reimbursement; a settlement takes its advance's project. */
  async create(dto: CreateRequestDto, actor: Actor, scope: AuthzScope, project?: ProjectRef) {
    requirePermission(actor, createPermission(dto.kind));

    const category = await this.prisma.expenseCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category || category.disabledAt) throw new UnprocessableEntityException('Choose an active expense category');

    let ref: ProjectRef;
    let advanceId: string | null = null;
    if (dto.kind === 'SETTLEMENT') {
      const advance = await this.prisma.financeRequest.findUnique({ where: { id: dto.advanceId } });
      // Missing and "someone else's" look the same on purpose.
      if (!advance || advance.kind !== 'ADVANCE' || advance.requesterId !== actor.id) throw notFound('Advance');
      if (advance.status !== 'PAID') throw new UnprocessableEntityException('Only a paid advance can be settled');
      ref = { id: advance.projectId, code: advance.projectCode, name: advance.projectName };
      advanceId = advance.id;
    } else {
      if (!project || project.id !== dto.projectId) throw new BadRequestException('The project could not be resolved');
      ref = project;
    }
    if (!inScope(scope, ref.id)) throw new ForbiddenException('You do not have access to this project');

    const invoices = dto.kind === 'ADVANCE' ? [] : dto.invoices;
    const requestedAmount = dto.kind === 'ADVANCE' ? dto.amount : sumMoney(invoices.map((i) => i.amount));

    const id = await this.prisma.$transaction(async (tx) => {
      const row = await tx.financeRequest.create({
        data: {
          id: uuidv7(), number: await this.nextNumber(tx, dto.kind), kind: dto.kind, status: 'DRAFT',
          projectId: ref.id, projectCode: ref.code, projectName: ref.name,
          workOrderId: dto.workOrderId ?? null, categoryId: dto.categoryId, requesterId: actor.id, advanceId,
          purpose: dto.purpose, requestedAmount,
        },
      });
      await this.writeInvoices(tx, row.id, invoices);
      await recordAudit(tx, { actorId: actor.id, action: 'finance.request.created', objectId: row.id, previousState: {}, newState: asJson({ number: row.number, kind: row.kind, requestedAmount }) });
      return row.id;
    });
    return this.detail(id);
  }

  async update(id: string, dto: UpdateRequestDto, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.own(tx, id, actor);
      requireCreatePermission(actor, row);
      if (!isEditable(row.status)) throw new ConflictException('Only a draft or returned request can be edited');
      if (dto.invoices && row.kind === 'ADVANCE') throw new UnprocessableEntityException('An advance has no invoices');
      if (dto.amount && row.kind !== 'ADVANCE') throw new UnprocessableEntityException('The amount of this request is the total of its invoices');
      if (dto.categoryId) {
        const category = await tx.expenseCategory.findUnique({ where: { id: dto.categoryId } });
        if (!category || category.disabledAt) throw new UnprocessableEntityException('Choose an active expense category');
      }

      let requestedAmount = row.requestedAmount.toFixed(2);
      if (dto.amount) requestedAmount = dto.amount;
      if (dto.invoices) requestedAmount = sumMoney(dto.invoices.map((i) => i.amount));
      // Conditional write first: it takes the row lock, so a concurrent submit waits for this transaction (and vice versa).
      const moved = await tx.financeRequest.updateMany({
        where: { id, status: row.status, revision: row.revision },
        data: {
          requestedAmount,
          ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
          ...(dto.purpose ? { purpose: dto.purpose } : {}),
          ...(dto.workOrderId !== undefined ? { workOrderId: dto.workOrderId } : {}),
        },
      });
      if (moved.count !== 1) throw new ConflictException('The request changed; reload and try again');
      if (dto.invoices) {
        await tx.requestInvoice.deleteMany({ where: { requestId: id } });
        await this.writeInvoices(tx, id, dto.invoices);
      }
      await recordAudit(tx, { actorId: actor.id, action: 'finance.request.updated', objectId: id, previousState: asJson({ requestedAmount: row.requestedAmount, purpose: row.purpose }), newState: asJson({ requestedAmount, purpose: dto.purpose ?? row.purpose }) });
    });
    return this.detail(id);
  }

  async submit(id: string, actor: Actor, bearer = '') {
    await this.attachInvoiceFiles(id, actor, bearer);
    await this.prisma.$transaction(async (tx) => {
      const row = await this.own(tx, id, actor);
      requireCreatePermission(actor, row);
      if (!isEditable(row.status)) throw new ConflictException('Only a draft or returned request can be submitted');
      if (row.kind !== 'ADVANCE') {
        const bills = await tx.requestInvoice.findMany({ where: { requestId: id } });
        if (bills.length === 0) throw new UnprocessableEntityException('Add at least one invoice before submitting');
        await refuseReusedNumbers(tx, id, bills.map((b): BillKey => ({ vendor: b.vendor, invoiceNumber: b.invoiceNumber, invoiceDate: b.invoiceDate, amount: b.amount.toFixed(2) })));
      }
      if (row.kind === 'SETTLEMENT' && row.advanceId) {
        const balance = await loadBalance(tx, row.advanceId);
        if (compareMoney(balance.outstanding, '0') <= 0) throw new UnprocessableEntityException('This advance has nothing outstanding to settle');
      }

      const entry = row.entryStatus ?? entryStatus(isPm(actor.permissions));
      const revision = row.status === 'RETURNED' ? row.revision + 1 : row.revision;
      const moved = await tx.financeRequest.updateMany({
        where: { id, status: row.status, revision: row.revision },
        data: { status: entry, entryStatus: entry, revision, submittedAt: new Date() },
      });
      if (moved.count !== 1) throw new ConflictException('The request changed; reload and try again');

      await recordAction(tx, { requestId: id, revision, step: 'REQUESTER', action: 'SUBMITTED', actorId: actor.id });
      const after = await tx.financeRequest.findUniqueOrThrow({ where: { id } });
      await emit(tx, SUBJECTS.FINANCE_REQUEST_SUBMITTED, { ...factsOf(after, actor.id, null), nextStep: stepOf(entry) }, actor.id);
      await recordAudit(tx, { actorId: actor.id, action: 'finance.request.submitted', objectId: id, previousState: { status: row.status }, newState: { status: entry, revision } });
    });
    return this.detail(id);
  }

  /**
   * Before a request is submitted, its invoice photos must be uploaded and
   * verified, and they become part of its record. Done ahead of the status
   * change, as qc does for evidence: a failure leaves the request a draft, and
   * attaching twice is harmless, so a retry (or a resubmit after a return, with
   * the same files) goes through.
   */
  private async attachInvoiceFiles(id: string, actor: Actor, bearer: string): Promise<void> {
    if (!this.media) return;
    const row = await this.prisma.financeRequest.findUnique({ where: { id }, include: { invoices: { select: { mediaId: true } } } });
    // Missing and "someone else's" look the same, as in `own`.
    if (!row || row.requesterId !== actor.id) throw notFound('Request');
    const mediaIds = [...new Set(row.invoices.map((i) => i.mediaId).filter((m): m is string => m !== null))];
    if (mediaIds.length === 0) return;

    const body = { requestId: id, projectId: row.projectId, mediaIds };
    const unusable = (await this.media.check(body, bearer)).filter((file) => !file.usable);
    if (unusable.length > 0) {
      const waiting = unusable.every((f) => f.reason === 'UPLOADING' || f.reason === 'VERIFYING');
      throw new UnprocessableEntityException(waiting
        ? 'An invoice photo is still uploading. Wait for it to finish, then submit again.'
        : 'An invoice photo is missing or was refused. Remove it or upload it again.');
    }
    if ((await this.media.attach(body, bearer)) === 'refused') throw new ConflictException('An invoice photo changed while submitting. Try again.');
  }

  async cancel(id: string, comment: string | undefined, actor: Actor) {
    requirePermission(actor, 'finance_request.cancel');
    await this.prisma.$transaction(async (tx) => {
      const row = await this.own(tx, id, actor);
      if (!isPending(row.status)) throw new ConflictException('Only a pending request can be cancelled');
      const heldBy = stepOf(row.status)!;
      const moved = await tx.financeRequest.updateMany({ where: { id, status: row.status, revision: row.revision }, data: { status: 'CANCELLED' } });
      if (moved.count !== 1) throw new ConflictException('The request changed; reload and try again');

      await recordAction(tx, { requestId: id, revision: row.revision, step: 'REQUESTER', action: 'CANCELLED', actorId: actor.id, comment: comment ?? null });
      const after = await tx.financeRequest.findUniqueOrThrow({ where: { id } });
      await emit(tx, SUBJECTS.FINANCE_REQUEST_CANCELLED, { ...factsOf(after, actor.id, comment ?? null), heldBy }, actor.id);
      await recordAudit(tx, { actorId: actor.id, action: 'finance.request.cancelled', objectId: id, previousState: { status: row.status }, newState: { status: 'CANCELLED' } });
    });
    return this.detail(id);
  }

  private async detail(id: string) {
    return serializeDetail(await this.prisma.financeRequest.findUniqueOrThrow({ where: { id }, include: WITH_DETAIL }));
  }

  /** The request, if it exists and is the actor's; otherwise "not found". */
  private async own(tx: Tx, id: string, actor: Actor): Promise<FinanceRequest> {
    const row = await tx.financeRequest.findUnique({ where: { id } });
    if (!row || row.requesterId !== actor.id) throw notFound('Request');
    return row;
  }

  private async writeInvoices(tx: Tx, requestId: string, invoices: InvoiceInput[]): Promise<void> {
    if (invoices.length === 0) return;
    await tx.requestInvoice.createMany({
      data: invoices.map((i) => ({ id: uuidv7(), requestId, vendor: i.vendor, invoiceNumber: i.invoiceNumber ?? null, invoiceDate: i.invoiceDate, amount: i.amount, mediaId: i.mediaId ?? null, vat: i.vat ?? false, supplierTaxNo: i.supplierTaxNo ?? null })),
    });
  }

  /** ADV-2026-0001. One counter row per kind and year, incremented atomically inside the caller's transaction. */
  private async nextNumber(tx: Tx, kind: RequestKind): Promise<string> {
    const key = `${NUMBER_PREFIX[kind]}-${new Date().getUTCFullYear()}`;
    const counter = await tx.numberCounter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
    return `${key}-${String(counter.value).padStart(4, '0')}`;
  }
}

/**
 * A supplier's invoice number is used once a fiscal year, so the same vendor and number
 * in the same year is a bill claimed twice, here or on another request. Bills
 * with no number, or a number last seen in another year, are only flagged to
 * approvers (see the detail read), since a supplier may have restarted at 1.
 */
async function refuseReusedNumbers(tx: Pick<PrismaClient, 'requestInvoice'>, requestId: string, bills: readonly BillKey[]): Promise<void> {
  const twice = repeatsWithin(bills);
  if (twice) throw new UnprocessableEntityException(`Invoice ${twice.invoiceNumber} from ${twice.vendor} is listed more than once on this request`);
  const reused = (await findDuplicates(tx, requestId, bills)).find((h) => h.reason === 'SAME_NUMBER');
  if (reused) {
    throw new UnprocessableEntityException(`Invoice ${reused.invoiceNumber} from ${reused.vendor} is already claimed on ${reused.number}`);
  }
}
