export const SUBJECTS = {
  IAM_SCOPE_GRANTED: 'iam.scope.granted',
  IAM_SCOPE_REVOKED: 'iam.scope.revoked',
  IAM_SCOPE_EXPIRING: 'iam.scope.expiring',
  IAM_ROLE_ASSIGNED: 'iam.role.assigned',
  IAM_ROLE_REMOVED: 'iam.role.removed',
  IAM_USER_DEACTIVATED: 'iam.user.deactivated',
  IAM_USER_UPDATED: 'iam.user.updated',
  AUDIT_EVENT: 'audit.event.recorded',
  QC_SUBMISSION_SUBMITTED: 'qc.submission.submitted',
  QC_SUBMISSION_REVIEWED: 'qc.submission.reviewed',
  QC_WORK_ORDER_CANCELLED: 'qc.work_order.cancelled',
  FINANCE_REQUEST_SUBMITTED: 'finance.request.submitted',
  FINANCE_REQUEST_APPROVED_BY_PM: 'finance.request.approved_by_pm',
  FINANCE_REQUEST_APPROVED: 'finance.request.approved',
  FINANCE_REQUEST_RETURNED: 'finance.request.returned',
  FINANCE_REQUEST_REJECTED: 'finance.request.rejected',
  FINANCE_REQUEST_CANCELLED: 'finance.request.cancelled',
  FINANCE_REQUEST_PAID: 'finance.request.paid',
  FINANCE_SETTLEMENT_SETTLED: 'finance.settlement.settled',
  FINANCE_ADVANCE_CASH_RETURNED: 'finance.advance.cash_returned',
  FINANCE_ADVANCE_SETTLEMENT_REMINDER: 'finance.advance.settlement_reminder',
} as const;

export type Subject = (typeof SUBJECTS)[keyof typeof SUBJECTS];

export interface StreamDefinition {
  name: string;
  subjects: string[];
  maxAgeMs: number;
  durableConsumers: string[];
}

export const STREAMS: Record<'IAM' | 'AUDIT' | 'QC' | 'FINANCE', StreamDefinition> = {
  IAM: {
    name: 'IAM',
    subjects: ['iam.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    /**
     * One durable per subject, not one per consumer.
     *
     * A JetStream durable carries a single `filter_subject`. Creating one
     * durable and subscribing it to several subjects silently keeps only the
     * first filter -- `consumers.add` reports "consumer already exists" for the
     * rest -- so the other subjects are never delivered at all. `project` hit
     * exactly that: revocations and deactivations went nowhere while grants
     * flowed, which fails open.
     */
    durableConsumers: [
      'project-scope-granted', 'project-scope-revoked', 'project-scope-deactivated',
      'notification-scope-expiring',
    ],
  },
  AUDIT: {
    name: 'AUDIT',
    subjects: ['audit.event.recorded'],
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    // Exactly one consumer. The hash chain requires a single serialized writer.
    durableConsumers: ['audit-ledger-writer'],
  },
  QC: {
    name: 'QC',
    subjects: ['qc.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    // media hears of cancelled work orders so it can release their unsubmitted
    // evidence; notification has one durable per submission subject (a durable
    // carries a single filter_subject, see the note on IAM above).
    durableConsumers: [
      'media-work-order-cancelled',
      'notification-submission-submitted',
      'notification-submission-reviewed',
    ],
  },
  FINANCE: {
    name: 'FINANCE',
    subjects: ['finance.>'],
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    // notification is the only consumer, one durable per subject (a durable
    // carries a single filter_subject, see the note on IAM above).
    durableConsumers: [
      'notification-finance-submitted',
      'notification-finance-approved-by-pm',
      'notification-finance-approved',
      'notification-finance-returned',
      'notification-finance-rejected',
      'notification-finance-cancelled',
      'notification-finance-paid',
      'notification-finance-settled',
      'notification-finance-cash-returned',
      'notification-finance-settlement-reminder',
    ],
  },
};
