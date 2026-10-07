import { describe, expect, it } from 'vitest';
import type {
  FinanceAdvanceCashReturned, FinanceRequestApproved, FinanceRequestCancelled, FinanceRequestPaid,
  FinanceRequestRejected, FinanceRequestReturned, FinanceRequestSubmitted, FinanceSettlementSettled,
} from '@ipms/events';
import {
  approvalNeededContent, approvedContent, cancelledContent, cashReturnedContent, formatNpr, paidContent,
  paymentDueContent, rejectedContent, returnedContent, settledContent, settlementReminderContent,
} from './finance-content.js';

const base = {
  requestId: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE' as const, projectId: 'p-1', projectName: 'Koshi Rollout',
  requesterId: 'u-eng', requestedAmount: '50000.00', approvedAmount: '40000.00', actorId: 'u-actor',
  at: '2026-10-05T08:00:00Z', comment: null,
};
const URL = '/finance/requests/r-1';

describe('formatNpr', () => {
  it('uses two decimals and Indian digit grouping', () => {
    expect(formatNpr('150000')).toBe('NPR 1,50,000.00');
    expect(formatNpr('40000.5')).toBe('NPR 40,000.50');
    expect(formatNpr('0.05')).toBe('NPR 0.05');
  });
});

describe('finance notification content', () => {
  it('asks the next approver to act, naming the request and project', () => {
    const p: FinanceRequestSubmitted = { ...base, approvedAmount: null, nextStep: 'PM' };
    expect(approvalNeededContent(p)).toEqual({
      type: 'FINANCE_APPROVAL_NEEDED', title: 'Approval needed',
      body: 'Advance ADV-2026-0007 for Koshi Rollout (NPR 50,000.00) is waiting for your approval.',
      actionUrl: URL, workOrderId: null,
    });
  });

  it('tells Finance a request is ready to pay, with the approved amount', () => {
    const p: FinanceRequestApproved = { ...base };
    expect(paymentDueContent(p)).toMatchObject({
      type: 'FINANCE_PAYMENT_DUE', title: 'Payment due',
      body: 'Advance ADV-2026-0007 for Koshi Rollout is approved for NPR 40,000.00 and ready to pay.', actionUrl: URL,
    });
  });

  it('tells the requester it was approved, noting a reduced amount', () => {
    expect(approvedContent({ ...base })).toMatchObject({
      type: 'FINANCE_REQUEST_APPROVED',
      body: 'Your advance ADV-2026-0007 was approved for NPR 40,000.00 (you asked for NPR 50,000.00). It is waiting for payment.',
    });
    expect(approvedContent({ ...base, approvedAmount: '50000.00' }).body)
      .toBe('Your advance ADV-2026-0007 was approved for NPR 50,000.00. It is waiting for payment.');
  });

  it('names who returned or rejected it, with the reason', () => {
    const returned: FinanceRequestReturned = { ...base, approvedAmount: null, step: 'DIRECTOR', comment: 'Reduce the amount' };
    expect(returnedContent(returned)).toMatchObject({
      type: 'FINANCE_REQUEST_RETURNED', title: 'Request returned',
      body: 'Your advance ADV-2026-0007 was returned by the project director: Reduce the amount. Edit it and submit again.',
    });
    const rejected: FinanceRequestRejected = { ...base, approvedAmount: null, step: 'FINANCE', comment: 'Duplicate invoice' };
    expect(rejectedContent(rejected)).toMatchObject({
      type: 'FINANCE_REQUEST_REJECTED', body: 'Your advance ADV-2026-0007 was rejected by finance: Duplicate invoice.',
    });
  });

  it('says who was holding a cancelled request', () => {
    const p: FinanceRequestCancelled = { ...base, heldBy: 'PM', comment: 'No longer needed' };
    expect(cancelledContent(p)).toMatchObject({
      type: 'FINANCE_REQUEST_CANCELLED', title: 'Request cancelled',
      body: 'Advance ADV-2026-0007 for Koshi Rollout was cancelled by its requester while waiting for the project manager: No longer needed.',
    });
  });

  it('announces payment and settlement to everyone involved', () => {
    const paid: FinanceRequestPaid = { ...base, approvers: { pmId: 'u-pm', directorId: 'u-dir' }, paidAmount: '40000.00' };
    expect(paidContent(paid)).toMatchObject({
      type: 'FINANCE_REQUEST_PAID', title: 'Payment made',
      body: 'Advance ADV-2026-0007 for Koshi Rollout was paid: NPR 40,000.00.',
    });
    const settled: FinanceSettlementSettled = {
      ...base, kind: 'SETTLEMENT', number: 'SET-2026-0003', approvers: { pmId: null, directorId: 'u-dir' },
      advanceId: 'a-1', appliedAmount: '5000.00', payoutAmount: '2000.00',
    };
    expect(settledContent(settled)).toMatchObject({
      type: 'FINANCE_SETTLEMENT_SETTLED', title: 'Settlement completed',
      body: 'Settlement SET-2026-0003 for Koshi Rollout was settled: NPR 5,000.00 applied to the advance, NPR 2,000.00 paid out.',
    });
    expect(settledContent({ ...settled, payoutAmount: '0.00' }).body)
      .toBe('Settlement SET-2026-0003 for Koshi Rollout was settled: NPR 5,000.00 applied to the advance.');
  });

  it('tells the requester about returned cash and what is still outstanding', () => {
    const p: FinanceAdvanceCashReturned = { ...base, returnedAmount: '3000.00', outstandingAfter: '35000.00' };
    expect(cashReturnedContent(p)).toMatchObject({
      type: 'FINANCE_CASH_RETURNED', title: 'Cash return recorded',
      body: 'Finance recorded NPR 3,000.00 returned against advance ADV-2026-0007. NPR 35,000.00 is still outstanding.',
    });
    expect(cashReturnedContent({ ...p, outstandingAfter: '0.00' }).body)
      .toBe('Finance recorded NPR 3,000.00 returned against advance ADV-2026-0007. The advance is now fully settled.');
  });
});

describe('settlement reminder', () => {
  it('tells the engineer how late the advance is and what is still outstanding', () => {
    const p = { ...base, dueOn: '2026-10-12', daysLate: 8, outstanding: '10000.00' };
    expect(settlementReminderContent(p)).toMatchObject({ type: 'FINANCE_SETTLEMENT_REMINDER', title: 'Settlement overdue', actionUrl: URL });
    expect(settlementReminderContent(p).body).toContain('NPR 10,000.00 outstanding) is 8 days past');
    expect(settlementReminderContent({ ...p, daysLate: 1 }).body).toContain('is 1 day past');
  });
});

describe('sentence punctuation after a comment', () => {
  const returned = (comment: string | null): FinanceRequestReturned => ({ ...base, approvedAmount: null, step: 'DIRECTOR', comment });
  const rejected = (comment: string | null): FinanceRequestRejected => ({ ...base, approvedAmount: null, step: 'FINANCE', comment });
  const cancelled = (comment: string | null): FinanceRequestCancelled => ({ ...base, heldBy: 'PM', comment });

  it('adds a full stop after a comment that does not end a sentence', () => {
    expect(returnedContent(returned('Reduce the amount')).body)
      .toBe('Your advance ADV-2026-0007 was returned by the project director: Reduce the amount. Edit it and submit again.');
  });

  it('does not double the stop when the comment already ends with one', () => {
    expect(returnedContent(returned('Reduce the amount.')).body)
      .toBe('Your advance ADV-2026-0007 was returned by the project director: Reduce the amount. Edit it and submit again.');
  });

  it('keeps a question or exclamation mark as the end of the sentence', () => {
    expect(rejectedContent(rejected('Why?')).body).toBe('Your advance ADV-2026-0007 was rejected by finance: Why?');
    expect(rejectedContent(rejected('No way!')).body).toBe('Your advance ADV-2026-0007 was rejected by finance: No way!');
    expect(returnedContent(returned('Why?')).body)
      .toBe('Your advance ADV-2026-0007 was returned by the project director: Why? Edit it and submit again.');
  });

  it('treats a blank or missing comment as no comment', () => {
    const tail = 'Advance ADV-2026-0007 for Koshi Rollout was cancelled by its requester while waiting for the project manager.';
    expect(cancelledContent(cancelled('   ')).body).toBe(tail);
    expect(cancelledContent(cancelled(null)).body).toBe(tail);
    expect(rejectedContent(rejected(null)).body).toBe('Your advance ADV-2026-0007 was rejected by finance.');
  });

  it('trims the comment', () => {
    expect(rejectedContent(rejected('  Duplicate invoice  ')).body).toBe('Your advance ADV-2026-0007 was rejected by finance: Duplicate invoice.');
  });
});

describe('a missing approved amount', () => {
  it('falls back to the requested amount without a "you asked for" note', () => {
    const p: FinanceRequestApproved = { ...base, approvedAmount: null };
    expect(paymentDueContent(p).body)
      .toBe('Advance ADV-2026-0007 for Koshi Rollout is approved for NPR 50,000.00 and ready to pay.');
    expect(approvedContent(p).body)
      .toBe('Your advance ADV-2026-0007 was approved for NPR 50,000.00. It is waiting for payment.');
  });
});
