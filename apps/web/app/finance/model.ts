import type { FinanceRequest, FinanceRequestDetail, FinanceStep, RequestFlag } from '../lib/finance-api';

/** What the finance screens show and which buttons they offer. Pure, so it is testable; the service enforces every rule again. */

export const KIND_LABEL: Record<FinanceRequest['kind'], string> = { ADVANCE: 'Advance', SETTLEMENT: 'Settlement', REIMBURSEMENT: 'Reimbursement' };

export const STATUS_LABEL: Record<FinanceRequest['status'], string> = {
  DRAFT: 'Draft', PENDING_PM: 'With project manager', PENDING_DIRECTOR: 'With project director', PENDING_FINANCE: 'Ready to pay',
  PAID: 'Paid', SETTLED: 'Settled', RETURNED: 'Returned', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'slate';
export const STATUS_TONE: Record<FinanceRequest['status'], Tone> = {
  DRAFT: 'slate', PENDING_PM: 'amber', PENDING_DIRECTOR: 'amber', PENDING_FINANCE: 'blue',
  PAID: 'green', SETTLED: 'green', RETURNED: 'red', REJECTED: 'red', CANCELLED: 'slate',
};

const STEP_NAME: Record<FinanceStep, string> = {
  REQUESTER: '', PM: 'the project manager', DIRECTOR: 'the project director', FINANCE: 'finance',
};
export const STEP_LABEL = STEP_NAME;

/** "NPR 1,50,000.00": two decimals, Indian grouping. A missing amount is a dash. */
export function formatMoney(amount: string | null): string {
  if (amount === null) return '—';
  return `NPR ${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A known person's name, otherwise the front of their id. */
export function personName(id: string, names: ReadonlyMap<string, string>): string {
  return names.get(id) ?? `${id.slice(0, 8)}…`;
}

export function waitingOn(status: FinanceRequest['status']): string | null {
  switch (status) {
    case 'PENDING_PM': return 'Waiting for the project manager';
    case 'PENDING_DIRECTOR': return 'Waiting for the project director';
    case 'PENDING_FINANCE': return 'Waiting for finance to pay';
    default: return null;
  }
}

export interface Viewer { id: string; permissions: readonly string[] }
export type RequestAction = 'edit' | 'submit' | 'cancel' | 'approve' | 'return' | 'reject' | 'pay' | 'settle' | 'cashReturn';

const PENDING = new Set(['PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE']);

/**
 * Where an advance stands against its settlement window. Only a paid advance
 * with something still outstanding is on the clock; the day is a calendar day,
 * so it is compared as `YYYY-MM-DD` against today's date.
 */
export function settlementStatus(
  dueOn: string | null | undefined, balance: { status: string } | null | undefined, today: string,
): { label: string; overdue: boolean } | null {
  if (!dueOn || balance?.status === 'CLOSED') return null;
  const overdue = dueOn < today;
  const date = new Date(`${dueOn}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return { label: overdue ? `Overdue since ${date}` : `Settle by ${date}`, overdue };
}

/** An advance that has been paid can be settled and can take returned cash. */
export const isSettleable = (request: Pick<FinanceRequest, 'kind' | 'status'>): boolean => request.kind === 'ADVANCE' && request.status === 'PAID';

/**
 * The buttons to offer, in display order.
 *
 * `approvedEarlier` is the ids of everyone who approved an earlier step of the
 * request's current revision: the service refuses them a later step, so the
 * button is not offered. Hiding is a courtesy; the service is the gate.
 */
export function availableActions(
  request: Pick<FinanceRequest, 'status' | 'kind' | 'requesterId'>,
  viewer: Viewer,
  approvedEarlier: readonly string[],
  balance?: { status: string } | null,
): RequestAction[] {
  const can = (permission: string): boolean => viewer.permissions.includes(permission);
  /** A fully settled advance stays PAID; only its balance says CLOSED, and the service then refuses settlements and cash returns. */
  const open = balance?.status !== 'CLOSED';

  if (request.requesterId === viewer.id) {
    if (request.status === 'DRAFT' || request.status === 'RETURNED') return ['edit', 'submit'];
    if (PENDING.has(request.status)) return ['cancel'];
    if (open && isSettleable(request) && can('finance_settlement.submit')) return ['settle'];
    return [];
  }

  if (approvedEarlier.includes(viewer.id)) return [];
  if (request.status === 'PENDING_PM' && can('finance_approval.pm')) return ['approve', 'return', 'reject'];
  if (request.status === 'PENDING_DIRECTOR' && can('finance_approval.director')) return ['approve', 'return', 'reject'];
  if (request.status === 'PENDING_FINANCE' && can('finance_payment.record')) return ['pay', 'return', 'reject'];
  if (open && isSettleable(request) && can('finance_payment.record')) return ['cashReturn'];
  return [];
}

const VERB: Record<string, string> = { APPROVED: 'Approved', RETURNED: 'Returned', REJECTED: 'Rejected', PAID: 'Paid' };

/** One row of the history as a phrase: "Approved by the project manager". */
export function describeEntry(entry: { step: FinanceStep; action: string }): string {
  if (entry.action === 'SUBMITTED') return 'Submitted';
  if (entry.action === 'CANCELLED') return 'Cancelled';
  if (entry.action === 'CASH_RETURNED') return 'Cash return recorded by finance';
  if (entry.action === 'REMINDED') return `Settlement reminder sent by ${STEP_NAME[entry.step]}`;
  return `${VERB[entry.action] ?? entry.action} by ${STEP_NAME[entry.step]}`;
}

/** "1 day", "9 days". */
export const dayCount = (n: number): string => `${n} day${n === 1 ? '' : 's'}`;

/** One warning as a sentence. */
export function flagText(flag: RequestFlag): string {
  switch (flag.code) {
    case 'DUPLICATE_BILL':
      return `Possible duplicate: ${flag.matches.map((m) => `${m.vendor}${m.invoiceNumber ? ` #${m.invoiceNumber}` : ''} on ${m.number}`).join('; ')}`;
    case 'REQUESTER_HOLDS_CASH': {
      const held = `Already holds ${formatMoney(flag.outstanding)} from ${flag.advances} advance${flag.advances === 1 ? '' : 's'}`;
      if (flag.overdue === 0) return held;
      if (flag.overdue === 1) return `${held}, one ${flag.oldestOverdueDays === null ? '' : `${dayCount(flag.oldestOverdueDays)} `}past settle-by`;
      return `${held}, ${flag.overdue} past settle-by${flag.oldestOverdueDays === null ? '' : ` (oldest ${dayCount(flag.oldestOverdueDays)})`}`;
    }
    case 'UNUSUAL_AMOUNT':
      return `About ${flag.ratio}× the usual for ${flag.category}`;
    case 'WAITING_LONG':
      return `Waiting ${flag.days} days`;
  }
}

/**
 * "ADV-2026-0012 approved for NPR 40,000.00." — what the viewer just decided,
 * read from the request's own history; null when its last step is not theirs.
 */
export function decisionLine(request: Pick<FinanceRequestDetail, 'number' | 'actions'>, viewerId: string): string | null {
  const last = request.actions[request.actions.length - 1];
  if (!last || last.actorId !== viewerId) return null;
  if (last.action === 'APPROVED') return `${request.number} approved${last.amount ? ` for ${formatMoney(last.amount)}` : ''}.`;
  if (last.action === 'RETURNED') return `${request.number} returned to the requester.`;
  if (last.action === 'REJECTED') return `${request.number} rejected.`;
  return null;
}
