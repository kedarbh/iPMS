import type { OnModuleInit } from '@nestjs/common';
import {
  DurableConsumer, InMemoryDedupeStore, SUBJECTS,
  type EventBus, type EventEnvelope, type FinanceAdvanceCashReturned, type FinanceAdvanceSettlementReminder, type FinanceEventBase,
  type FinanceRequestApproved, type FinanceRequestApprovedByPm, type FinanceRequestCancelled, type FinanceRequestPaid,
  type FinanceRequestRejected, type FinanceRequestReturned, type FinanceRequestSubmitted, type FinanceSettlementSettled,
  type FinanceStep,
} from '@ipms/events';
import { createLogger } from '@ipms/observability';
import type { IamDirectoryClient } from '../directory/iam-directory.client.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { NotificationDraft } from './content.js';
import {
  approvalNeededContent, approvedContent, cancelledContent, cashReturnedContent, paidContent, paymentDueContent,
  rejectedContent, returnedContent, settledContent, settlementReminderContent,
} from './finance-content.js';

const log = createLogger('notification');

/** Must match `STREAMS.FINANCE.durableConsumers`. One durable per subject: a durable carries a single filter_subject. */
export const FINANCE_DURABLES = {
  submitted: 'notification-finance-submitted',
  approvedByPm: 'notification-finance-approved-by-pm',
  approved: 'notification-finance-approved',
  returned: 'notification-finance-returned',
  rejected: 'notification-finance-rejected',
  cancelled: 'notification-finance-cancelled',
  paid: 'notification-finance-paid',
  settled: 'notification-finance-settled',
  cashReturned: 'notification-finance-cash-returned',
  settlementReminder: 'notification-finance-settlement-reminder',
} as const;

/** The permission whose holders act at each step; the same table finance itself uses. */
const STEP_PERMISSION: Record<FinanceStep, string> = {
  PM: 'finance_approval.pm',
  DIRECTOR: 'finance_approval.director',
  FINANCE: 'finance_payment.record',
};

const unique = (ids: Array<string | null | undefined>): string[] => [...new Set(ids.filter((id): id is string => typeof id === 'string'))];

/** An event missing what every finance notification needs cannot be fixed by retrying, so it is skipped. */
const hasFacts = (p: Partial<FinanceEventBase> | null | undefined): p is FinanceEventBase =>
  p != null && typeof p.requestId === 'string' && typeof p.number === 'string' && typeof p.projectId === 'string';

/**
 * Turns finance request facts into in-app notifications.
 *
 * Every handler resolves all of its recipients first, then writes: an IAM
 * failure throws before anything is stored, so JetStream redelivers the whole
 * event. Idempotency lives in the database (unique `(recipientId, eventId)`).
 */
export class FinanceNotificationConsumer implements OnModuleInit {
  constructor(
    private readonly notifications: NotificationService,
    private readonly iam: IamDirectoryClient,
    private readonly bus: EventBus,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.register(new DurableConsumer(this.bus, new InMemoryDedupeStore()));
    log.info('finance notification consumers started');
  }

  async register(consumer: DurableConsumer): Promise<void> {
    const subscribe = <T>(subject: string, durable: string, handler: (e: EventEnvelope<T>) => Promise<void>) =>
      consumer.subscribe<T>(subject, durable, handler);
    await subscribe<FinanceRequestSubmitted>(SUBJECTS.FINANCE_REQUEST_SUBMITTED, FINANCE_DURABLES.submitted, (e) => this.onSubmitted(e));
    await subscribe<FinanceRequestApprovedByPm>(SUBJECTS.FINANCE_REQUEST_APPROVED_BY_PM, FINANCE_DURABLES.approvedByPm, (e) => this.onApprovedByPm(e));
    await subscribe<FinanceRequestApproved>(SUBJECTS.FINANCE_REQUEST_APPROVED, FINANCE_DURABLES.approved, (e) => this.onApproved(e));
    await subscribe<FinanceRequestReturned>(SUBJECTS.FINANCE_REQUEST_RETURNED, FINANCE_DURABLES.returned, (e) => this.onReturned(e));
    await subscribe<FinanceRequestRejected>(SUBJECTS.FINANCE_REQUEST_REJECTED, FINANCE_DURABLES.rejected, (e) => this.onRejected(e));
    await subscribe<FinanceRequestCancelled>(SUBJECTS.FINANCE_REQUEST_CANCELLED, FINANCE_DURABLES.cancelled, (e) => this.onCancelled(e));
    await subscribe<FinanceRequestPaid>(SUBJECTS.FINANCE_REQUEST_PAID, FINANCE_DURABLES.paid, (e) => this.onPaid(e));
    await subscribe<FinanceSettlementSettled>(SUBJECTS.FINANCE_SETTLEMENT_SETTLED, FINANCE_DURABLES.settled, (e) => this.onSettled(e));
    await subscribe<FinanceAdvanceCashReturned>(SUBJECTS.FINANCE_ADVANCE_CASH_RETURNED, FINANCE_DURABLES.cashReturned, (e) => this.onCashReturned(e));
    await subscribe<FinanceAdvanceSettlementReminder>(SUBJECTS.FINANCE_ADVANCE_SETTLEMENT_REMINDER, FINANCE_DURABLES.settlementReminder, (e) => this.onSettlementReminder(e));
  }

  /** The next approver: PMs normally, directors when a PM raised the request. */
  async onSubmitted(envelope: EventEnvelope<FinanceRequestSubmitted>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    const step: FinanceStep = p.nextStep === 'DIRECTOR' ? 'DIRECTOR' : 'PM';
    await this.send(envelope, await this.holders(step, p, [p.requesterId, p.actorId]), approvalNeededContent(p));
  }

  async onApprovedByPm(envelope: EventEnvelope<FinanceRequestApprovedByPm>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    await this.send(envelope, await this.holders('DIRECTOR', p, [p.requesterId, p.actorId]), approvalNeededContent(p));
  }

  /** The director approved: Finance has a payment to make, and the requester has an answer. */
  async onApproved(envelope: EventEnvelope<FinanceRequestApproved>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    const finance = await this.holders('FINANCE', p, [p.requesterId, p.actorId]);
    await this.send(envelope, finance, paymentDueContent(p));
    await this.send(envelope, [p.requesterId], approvedContent(p));
  }

  async onReturned(envelope: EventEnvelope<FinanceRequestReturned>): Promise<void> {
    const p = envelope.payload;
    if (this.accept(envelope, p)) await this.send(envelope, [p.requesterId], returnedContent(p));
  }

  async onRejected(envelope: EventEnvelope<FinanceRequestRejected>): Promise<void> {
    const p = envelope.payload;
    if (this.accept(envelope, p)) await this.send(envelope, [p.requesterId], rejectedContent(p));
  }

  /** Whoever was holding the request, so they can take it off their list. */
  async onCancelled(envelope: EventEnvelope<FinanceRequestCancelled>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    await this.send(envelope, await this.holders(p.heldBy, p, [p.requesterId, p.actorId]), cancelledContent(p));
  }

  async onPaid(envelope: EventEnvelope<FinanceRequestPaid>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    await this.send(envelope, await this.involved(p, p.approvers), paidContent(p));
  }

  async onSettled(envelope: EventEnvelope<FinanceSettlementSettled>): Promise<void> {
    const p = envelope.payload;
    if (!this.accept(envelope, p)) return;
    await this.send(envelope, await this.involved(p, p.approvers), settledContent(p));
  }

  async onCashReturned(envelope: EventEnvelope<FinanceAdvanceCashReturned>): Promise<void> {
    const p = envelope.payload;
    if (this.accept(envelope, p)) await this.send(envelope, [p.requesterId], cashReturnedContent(p));
  }

  async onSettlementReminder(envelope: EventEnvelope<FinanceAdvanceSettlementReminder>): Promise<void> {
    const p = envelope.payload;
    if (this.accept(envelope, p)) await this.send(envelope, [p.requesterId], settlementReminderContent(p));
  }

  private accept(envelope: EventEnvelope<unknown>, payload: Partial<FinanceEventBase> | null | undefined): payload is FinanceEventBase {
    if (hasFacts(payload)) return true;
    log.warn({ eventId: envelope.eventId, subject: envelope.subject }, 'finance event missing request facts, skipped');
    return false;
  }

  /** People holding the step's permission on the project, minus anyone excluded. Throws if iam is unreachable. */
  private async holders(step: FinanceStep, p: FinanceEventBase, exclude: string[]): Promise<string[]> {
    const ids = await this.iam.holders(STEP_PERMISSION[step], p.projectId);
    return unique(ids).filter((id) => !exclude.includes(id));
  }

  /** Everyone involved in a completed payment: requester, approvers and Finance, never the person who paid. */
  private async involved(p: FinanceEventBase, approvers: { pmId: string | null; directorId: string }): Promise<string[]> {
    const finance = await this.holders('FINANCE', p, []);
    return unique([p.requesterId, approvers.pmId, approvers.directorId, ...finance]).filter((id) => id !== p.actorId);
  }

  private async send(envelope: EventEnvelope<unknown>, recipients: string[], content: NotificationDraft): Promise<void> {
    if (recipients.length === 0) {
      log.warn({ eventId: envelope.eventId, subject: envelope.subject }, 'no recipients for finance notification');
      return;
    }
    await this.notifications.createMany(recipients.map((recipientId) => ({ recipientId, eventId: envelope.eventId, ...content })));
  }
}
