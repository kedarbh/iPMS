import { describe, expect, it, vi } from 'vitest';
import { SUBJECTS, type EventEnvelope } from '@ipms/events';
import { FINANCE_DURABLES, FinanceNotificationConsumer } from './finance-notification.consumer.js';

const base = {
  requestId: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE' as const, projectId: 'p-1', projectName: 'Koshi Rollout',
  requesterId: 'u-eng', requestedAmount: '50000.00', approvedAmount: '40000.00', actorId: 'u-actor',
  at: '2026-10-05T08:00:00Z', comment: null,
};
const envelope = <T>(payload: T): EventEnvelope<T> => ({
  eventId: 'evt-1', subject: 'x', occurredAt: '2026-10-05T08:00:00Z', version: 1, correlationId: 'c-1', actorId: null, payload,
});

/** `holders` answers per permission, so a test can give each role its own people. */
function build(byPermission: Record<string, string[] | Error> = {}) {
  const notifications = { createMany: vi.fn().mockResolvedValue(1) };
  const iam = {
    holders: vi.fn(async (permission: string) => {
      const answer = byPermission[permission] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
  const consumer = new FinanceNotificationConsumer(notifications as never, iam as never, {} as never);
  const sent = () => notifications.createMany.mock.calls.flatMap((c) => c[0] as Array<{ recipientId: string; type: string; eventId: string }>);
  return { consumer, notifications, iam, sent };
}

describe('durables', () => {
  it('uses the durable names the FINANCE stream declares', () => {
    expect(Object.values(FINANCE_DURABLES).sort()).toEqual([
      'notification-finance-approved', 'notification-finance-approved-by-pm', 'notification-finance-cancelled',
      'notification-finance-cash-returned', 'notification-finance-paid', 'notification-finance-rejected',
      'notification-finance-returned', 'notification-finance-settled', 'notification-finance-settlement-reminder',
      'notification-finance-submitted',
    ]);
  });
});

describe('onSubmitted', () => {
  it('asks the project managers when the next step is PM, never the requester or actor', async () => {
    const { consumer, iam, sent } = build({ 'finance_approval.pm': ['u-pm1', 'u-pm2', 'u-eng', 'u-actor', 'u-pm1'] });
    await consumer.onSubmitted(envelope({ ...base, approvedAmount: null, nextStep: 'PM' as const }));
    expect(iam.holders).toHaveBeenCalledWith('finance_approval.pm', 'p-1');
    expect(sent().map((r) => r.recipientId)).toEqual(['u-pm1', 'u-pm2']);
    expect(sent()[0]).toMatchObject({ type: 'FINANCE_APPROVAL_NEEDED', eventId: 'evt-1' });
  });

  it('asks the directors when a PM raised it', async () => {
    const { consumer, iam, sent } = build({ 'finance_approval.director': ['u-dir'] });
    await consumer.onSubmitted(envelope({ ...base, approvedAmount: null, nextStep: 'DIRECTOR' as const }));
    expect(iam.holders).toHaveBeenCalledWith('finance_approval.director', 'p-1');
    expect(sent().map((r) => r.recipientId)).toEqual(['u-dir']);
  });

  it('throws when iam is down, so the event is redelivered', async () => {
    const { consumer, notifications } = build({ 'finance_approval.pm': new Error('iam down') });
    await expect(consumer.onSubmitted(envelope({ ...base, approvedAmount: null, nextStep: 'PM' as const }))).rejects.toThrow('iam down');
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('acknowledges a project with nobody to ask instead of retrying', async () => {
    const { consumer, notifications } = build({ 'finance_approval.pm': ['u-eng'] });
    await expect(consumer.onSubmitted(envelope({ ...base, approvedAmount: null, nextStep: 'PM' as const }))).resolves.toBeUndefined();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('skips a malformed payload without calling iam', async () => {
    const { consumer, iam, notifications } = build();
    await expect(consumer.onSubmitted(envelope({ nextStep: 'PM' } as never))).resolves.toBeUndefined();
    expect(iam.holders).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });
});

describe('onApprovedByPm', () => {
  it('asks the directors', async () => {
    const { consumer, sent } = build({ 'finance_approval.director': ['u-dir1', 'u-dir2'] });
    await consumer.onApprovedByPm(envelope({ ...base, approvedAmount: null }));
    expect(sent().map((r) => r.recipientId)).toEqual(['u-dir1', 'u-dir2']);
    expect(sent()[0]?.type).toBe('FINANCE_APPROVAL_NEEDED');
  });
});

describe('onApproved', () => {
  it('tells Finance payment is due and the requester it was approved', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': ['u-fin1', 'u-fin2'] });
    await consumer.onApproved(envelope({ ...base }));
    const rows = sent();
    expect(rows.filter((r) => r.type === 'FINANCE_PAYMENT_DUE').map((r) => r.recipientId)).toEqual(['u-fin1', 'u-fin2']);
    expect(rows.filter((r) => r.type === 'FINANCE_REQUEST_APPROVED').map((r) => r.recipientId)).toEqual(['u-eng']);
  });

  it('still tells the requester when Finance has no holders', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': [] });
    await consumer.onApproved(envelope({ ...base }));
    expect(sent().map((r) => r.type)).toEqual(['FINANCE_REQUEST_APPROVED']);
  });

  it('writes nothing when the lookup fails, so a retry cannot half-notify', async () => {
    const { consumer, notifications } = build({ 'finance_payment.record': new Error('iam down') });
    await expect(consumer.onApproved(envelope({ ...base }))).rejects.toThrow('iam down');
    expect(notifications.createMany).not.toHaveBeenCalled();
  });
});

describe('onReturned and onRejected', () => {
  it('tells only the requester, without calling iam', async () => {
    const { consumer, iam, sent } = build();
    await consumer.onReturned(envelope({ ...base, approvedAmount: null, step: 'PM' as const, comment: 'Add the quotation' }));
    await consumer.onRejected(envelope({ ...base, approvedAmount: null, step: 'FINANCE' as const, comment: 'Duplicate' }));
    expect(sent().map((r) => [r.recipientId, r.type])).toEqual([['u-eng', 'FINANCE_REQUEST_RETURNED'], ['u-eng', 'FINANCE_REQUEST_REJECTED']]);
    expect(iam.holders).not.toHaveBeenCalled();
  });
});

describe('onCancelled', () => {
  it.each([
    ['PM', 'finance_approval.pm'],
    ['DIRECTOR', 'finance_approval.director'],
    ['FINANCE', 'finance_payment.record'],
  ] as const)('tells the holders of the %s step', async (heldBy, permission) => {
    const { consumer, iam, sent } = build({ [permission]: ['u-holder', 'u-eng'] });
    await consumer.onCancelled(envelope({ ...base, heldBy }));
    expect(iam.holders).toHaveBeenCalledWith(permission, 'p-1');
    expect(sent().map((r) => r.recipientId)).toEqual(['u-holder']);
  });
});

describe('onPaid and onSettled', () => {
  const paid = { ...base, approvers: { pmId: 'u-pm', directorId: 'u-dir' }, paidAmount: '40000.00' };

  it('tells the requester, both approvers and Finance, once each, but not the payer', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': ['u-fin1', 'u-actor', 'u-dir'] });
    await consumer.onPaid(envelope(paid));
    expect(sent().map((r) => r.recipientId).sort()).toEqual(['u-dir', 'u-eng', 'u-fin1', 'u-pm']);
    expect(sent().every((r) => r.type === 'FINANCE_REQUEST_PAID')).toBe(true);
  });

  it('skips the PM when a PM raised the request', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': [] });
    await consumer.onPaid(envelope({ ...paid, approvers: { pmId: null, directorId: 'u-dir' } }));
    expect(sent().map((r) => r.recipientId).sort()).toEqual(['u-dir', 'u-eng']);
  });

  it('announces a settlement the same way', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': ['u-fin1'] });
    await consumer.onSettled(envelope({
      ...base, kind: 'SETTLEMENT' as const, number: 'SET-2026-0003', approvers: { pmId: 'u-pm', directorId: 'u-dir' },
      advanceId: 'a-1', appliedAmount: '5000.00', payoutAmount: '0.00',
    }));
    expect(sent().map((r) => r.recipientId).sort()).toEqual(['u-dir', 'u-eng', 'u-fin1', 'u-pm']);
    expect(sent()[0]?.type).toBe('FINANCE_SETTLEMENT_SETTLED');
  });
});

describe('onCashReturned', () => {
  it('tells the requester', async () => {
    const { consumer, sent } = build();
    await consumer.onCashReturned(envelope({ ...base, returnedAmount: '3000.00', outstandingAfter: '35000.00' }));
    expect(sent().map((r) => [r.recipientId, r.type])).toEqual([['u-eng', 'FINANCE_CASH_RETURNED']]);
  });
});

describe('onSettlementReminder', () => {
  it('tells the requester, and no one else', async () => {
    const { consumer, sent } = build();
    await consumer.onSettlementReminder(envelope({ ...base, dueOn: '2026-10-12', daysLate: 8, outstanding: '10000.00' }));
    expect(sent().map((r) => [r.recipientId, r.type])).toEqual([['u-eng', 'FINANCE_SETTLEMENT_REMINDER']]);
  });
});

describe('register', () => {
  const expected = [
    [SUBJECTS.FINANCE_REQUEST_SUBMITTED, 'notification-finance-submitted', 'onSubmitted'],
    [SUBJECTS.FINANCE_REQUEST_APPROVED_BY_PM, 'notification-finance-approved-by-pm', 'onApprovedByPm'],
    [SUBJECTS.FINANCE_REQUEST_APPROVED, 'notification-finance-approved', 'onApproved'],
    [SUBJECTS.FINANCE_REQUEST_RETURNED, 'notification-finance-returned', 'onReturned'],
    [SUBJECTS.FINANCE_REQUEST_REJECTED, 'notification-finance-rejected', 'onRejected'],
    [SUBJECTS.FINANCE_REQUEST_CANCELLED, 'notification-finance-cancelled', 'onCancelled'],
    [SUBJECTS.FINANCE_REQUEST_PAID, 'notification-finance-paid', 'onPaid'],
    [SUBJECTS.FINANCE_SETTLEMENT_SETTLED, 'notification-finance-settled', 'onSettled'],
    [SUBJECTS.FINANCE_ADVANCE_CASH_RETURNED, 'notification-finance-cash-returned', 'onCashReturned'],
    [SUBJECTS.FINANCE_ADVANCE_SETTLEMENT_REMINDER, 'notification-finance-settlement-reminder', 'onSettlementReminder'],
  ] as const;

  it('subscribes each subject to its own durable', async () => {
    const { consumer } = build();
    const fake = { subscribe: vi.fn().mockResolvedValue(undefined) };
    await consumer.register(fake as never);
    expect(fake.subscribe.mock.calls.map((c) => [c[0], c[1]])).toEqual(expected.map(([subject, durable]) => [subject, durable]));
  });

  it.each(expected)('routes %s to the matching handler', async (subject, durable, method) => {
    const { consumer } = build();
    const spies = Object.fromEntries(expected.map(([, , m]) => [m, vi.spyOn(consumer, m).mockResolvedValue(undefined)]));
    const fake = { subscribe: vi.fn().mockResolvedValue(undefined) };
    await consumer.register(fake as never);
    const call = fake.subscribe.mock.calls.find((c) => c[0] === subject && c[1] === durable);
    const ev = envelope({ ...base });
    await (call?.[2] as (e: unknown) => Promise<void>)(ev);
    for (const [m, spy] of Object.entries(spies)) {
      if (m === method) expect(spy).toHaveBeenCalledWith(ev);
      else expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe('recipient edge cases', () => {
  it('onApproved with a requester who is also in Finance sends the requester exactly one FINANCE_REQUEST_APPROVED and no payment-due row (both sends share one eventId)', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': ['u-eng', 'u-fin1'] });
    await consumer.onApproved(envelope({ ...base }));
    const mine = sent().filter((r) => r.recipientId === 'u-eng');
    expect(mine.map((r) => r.type)).toEqual(['FINANCE_REQUEST_APPROVED']);
    expect(sent().filter((r) => r.type === 'FINANCE_PAYMENT_DUE').map((r) => r.recipientId)).toEqual(['u-fin1']);
    expect(new Set(sent().map((r) => r.eventId))).toEqual(new Set(['evt-1']));
  });

  it('onApproved does not notify the actor', async () => {
    const { consumer, sent } = build({ 'finance_payment.record': ['u-actor', 'u-fin1'] });
    await consumer.onApproved(envelope({ ...base }));
    expect(sent().map((r) => r.recipientId)).not.toContain('u-actor');
  });

  it('onApprovedByPm does not notify the actor', async () => {
    const { consumer, sent } = build({ 'finance_approval.director': ['u-actor', 'u-dir'] });
    await consumer.onApprovedByPm(envelope({ ...base, approvedAmount: null }));
    expect(sent().map((r) => r.recipientId)).toEqual(['u-dir']);
  });

  it('onPaid throws and writes nothing when iam fails', async () => {
    const { consumer, notifications } = build({ 'finance_payment.record': new Error('iam down') });
    await expect(consumer.onPaid(envelope({
      ...base, approvers: { pmId: 'u-pm', directorId: 'u-dir' }, paidAmount: '40000.00',
    }))).rejects.toThrow('iam down');
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('onSubmitted with an unknown nextStep falls back to the project managers', async () => {
    const { consumer, iam, sent } = build({ 'finance_approval.pm': ['u-pm1'] });
    await consumer.onSubmitted(envelope({ ...base, approvedAmount: null, nextStep: 'BOGUS' as never }));
    expect(iam.holders).toHaveBeenCalledWith('finance_approval.pm', 'p-1');
    expect(sent().map((r) => r.recipientId)).toEqual(['u-pm1']);
  });

  it('skips a null payload without throwing or writing', async () => {
    const { consumer, iam, notifications } = build();
    await expect(consumer.onSubmitted(envelope(null as never))).resolves.toBeUndefined();
    expect(iam.holders).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });
});
