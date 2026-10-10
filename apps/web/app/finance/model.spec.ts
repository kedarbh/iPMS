import { describe, expect, it } from 'vitest';
import { availableActions, decisionLine, describeEntry, flagText, formatMoney, personName, settlementStatus, waitingOn, type Viewer } from './model';

const ENG: Viewer = { id: 'u-eng', permissions: ['finance_request.view', 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit'] };
const PM: Viewer = { id: 'u-pm', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit', 'finance_approval.pm'] };
const DIR: Viewer = { id: 'u-dir', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_approval.director'] };
const FIN: Viewer = { id: 'u-fin', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_payment.record', 'finance_category.manage'] };

const req = (over: Partial<{ status: string; kind: string; requesterId: string }> = {}) =>
  ({ status: 'DRAFT', kind: 'ADVANCE', requesterId: 'u-eng', ...over }) as never;

describe('formatMoney', () => {
  it('uses NPR with two decimals and Indian grouping', () => {
    expect(formatMoney('150000')).toBe('NPR 1,50,000.00');
    expect(formatMoney('40000.5')).toBe('NPR 40,000.50');
    expect(formatMoney(null)).toBe('—');
  });
});

describe('personName', () => {
  it('prefers a known name and otherwise shows a short id', () => {
    expect(personName('u-1', new Map([['u-1', 'Sita Rai']]))).toBe('Sita Rai');
    expect(personName('0193a8c2-1111-7222-8333-444455556666', new Map())).toBe('0193a8c2…');
  });
});

describe('waitingOn', () => {
  it('names who is holding a pending request', () => {
    expect(waitingOn('PENDING_PM')).toBe('Waiting for the project manager');
    expect(waitingOn('PENDING_DIRECTOR')).toBe('Waiting for the project director');
    expect(waitingOn('PENDING_FINANCE')).toBe('Waiting for finance to pay');
    expect(waitingOn('PAID')).toBeNull();
  });
});

describe('availableActions: the requester', () => {
  it('edits and submits a draft or returned request, and cancels a pending one', () => {
    expect(availableActions(req({ status: 'DRAFT' }), ENG, [])).toEqual(['edit', 'submit']);
    expect(availableActions(req({ status: 'RETURNED' }), ENG, [])).toEqual(['edit', 'submit']);
    expect(availableActions(req({ status: 'PENDING_PM' }), ENG, [])).toEqual(['cancel']);
    expect(availableActions(req({ status: 'PENDING_FINANCE' }), ENG, [])).toEqual(['cancel']);
    expect(availableActions(req({ status: 'REJECTED' }), ENG, [])).toEqual([]);
  });

  it('settles a paid advance, but only with the settlement permission', () => {
    expect(availableActions(req({ status: 'PAID' }), ENG, [])).toEqual(['settle']);
    expect(availableActions(req({ status: 'PAID' }), { id: 'u-eng', permissions: ['finance_request.view'] }, [])).toEqual([]);
    expect(availableActions(req({ status: 'PAID', kind: 'REIMBURSEMENT' }), ENG, [])).toEqual([]);
  });

  it('does not let the owner of someone else\'s request edit it', () => {
    expect(availableActions(req({ status: 'DRAFT', requesterId: 'u-other' }), ENG, [])).toEqual([]);
  });
});

describe('availableActions: approvers and Finance', () => {
  it('lets the PM act at PENDING_PM only, never on their own request', () => {
    expect(availableActions(req({ status: 'PENDING_PM' }), PM, [])).toEqual(['approve', 'return', 'reject']);
    expect(availableActions(req({ status: 'PENDING_DIRECTOR' }), PM, [])).toEqual([]);
    expect(availableActions(req({ status: 'PENDING_PM', requesterId: 'u-pm' }), PM, [])).toEqual(['cancel']);
  });

  it('lets the Director act at PENDING_DIRECTOR', () => {
    expect(availableActions(req({ status: 'PENDING_DIRECTOR' }), DIR, [])).toEqual(['approve', 'return', 'reject']);
    expect(availableActions(req({ status: 'PENDING_PM' }), DIR, [])).toEqual([]);
  });

  it('lets Finance pay, return or reject at PENDING_FINANCE, and record cash returns on a paid advance', () => {
    expect(availableActions(req({ status: 'PENDING_FINANCE' }), FIN, [])).toEqual(['pay', 'return', 'reject']);
    expect(availableActions(req({ status: 'PAID' }), FIN, [])).toEqual(['cashReturn']);
    expect(availableActions(req({ status: 'PAID', kind: 'REIMBURSEMENT' }), FIN, [])).toEqual([]);
  });

  it('hides a later step from someone who already approved an earlier one in this revision', () => {
    const both: Viewer = { id: 'u-both', permissions: [...PM.permissions, 'finance_approval.director'] };
    expect(availableActions(req({ status: 'PENDING_DIRECTOR' }), both, ['u-both'])).toEqual([]);
    expect(availableActions(req({ status: 'PENDING_DIRECTOR' }), both, [])).toEqual(['approve', 'return', 'reject']);
  });
});

describe('describeEntry', () => {
  it('turns a history row into a sentence fragment', () => {
    expect(describeEntry({ step: 'REQUESTER', action: 'SUBMITTED' })).toBe('Submitted');
    expect(describeEntry({ step: 'PM', action: 'APPROVED' })).toBe('Approved by the project manager');
    expect(describeEntry({ step: 'DIRECTOR', action: 'RETURNED' })).toBe('Returned by the project director');
    expect(describeEntry({ step: 'FINANCE', action: 'REJECTED' })).toBe('Rejected by finance');
    expect(describeEntry({ step: 'FINANCE', action: 'PAID' })).toBe('Paid by finance');
    expect(describeEntry({ step: 'FINANCE', action: 'CASH_RETURNED' })).toBe('Cash return recorded by finance');
    expect(describeEntry({ step: 'REQUESTER', action: 'CANCELLED' })).toBe('Cancelled');
  });
});

describe('availableActions: closed advances', () => {
  it('offers no settle or cash return once the balance is CLOSED', () => {
    expect(availableActions(req({ status: 'PAID' }), ENG, [], { status: 'CLOSED' })).not.toContain('settle');
    expect(availableActions(req({ status: 'PAID' }), FIN, [], { status: 'CLOSED' })).not.toContain('cashReturn');
  });

  it('is unchanged for open balances or no balance', () => {
    expect(availableActions(req({ status: 'PAID' }), ENG, [], { status: 'PAID' })).toEqual(['settle']);
    expect(availableActions(req({ status: 'PAID' }), ENG, [], { status: 'PARTIALLY_SETTLED' })).toEqual(['settle']);
    expect(availableActions(req({ status: 'PAID' }), FIN, [], null)).toEqual(['cashReturn']);
    expect(availableActions(req({ status: 'PAID' }), FIN, [])).toEqual(['cashReturn']);
  });
});

describe('settlementStatus', () => {
  it('says when a paid advance is to be settled by, a week after it was paid', () => {
    expect(settlementStatus('2026-10-14', { status: 'PAID' }, '2026-10-10')).toEqual({ label: 'Settle by 14 Oct 2026', overdue: false });
    expect(settlementStatus('2026-10-14', { status: 'PARTIALLY_SETTLED' }, '2026-10-14')?.overdue).toBe(false);
  });

  it('is overdue from the day after, while something is outstanding', () => {
    expect(settlementStatus('2026-10-14', { status: 'PAID' }, '2026-10-15')).toEqual({ label: 'Overdue since 14 Oct 2026', overdue: true });
  });

  it('is off the clock once the advance is closed, or has no due day', () => {
    expect(settlementStatus('2026-10-14', { status: 'CLOSED' }, '2026-12-01')).toBeNull();
    expect(settlementStatus(null, { status: 'PAID' }, '2026-10-10')).toBeNull();
    expect(settlementStatus(undefined, undefined, '2026-10-10')).toBeNull();
  });
});

describe('flagText', () => {
  it('phrases each flag', () => {
    expect(flagText({ code: 'DUPLICATE_BILL', tone: 'red', matches: [{ requestId: 'r-2', number: 'REI-2026-0031' }] })).toBe('Possible duplicate bill: also on REI-2026-0031');
    expect(flagText({ code: 'REQUESTER_HOLDS_CASH', tone: 'amber', outstanding: '45000.00', advances: 2, overdue: 0, oldestOverdueDays: null })).toBe('Already holds NPR 45,000.00 from 2 advances');
    expect(flagText({ code: 'REQUESTER_HOLDS_CASH', tone: 'red', outstanding: '45000.00', advances: 2, overdue: 1, oldestOverdueDays: 9 })).toBe('Already holds NPR 45,000.00 from 2 advances, one 9 days past settle-by');
    expect(flagText({ code: 'REQUESTER_HOLDS_CASH', tone: 'red', outstanding: '9000.00', advances: 3, overdue: 2, oldestOverdueDays: 12 })).toBe('Already holds NPR 9,000.00 from 3 advances, 2 past settle-by (oldest 12 days)');
    expect(flagText({ code: 'UNUSUAL_AMOUNT', tone: 'amber', ratio: 3, median: '1000.00', category: 'Fuel' })).toBe('About 3× the usual for Fuel');
    expect(flagText({ code: 'WAITING_LONG', tone: 'amber', days: 5 })).toBe('Waiting 5 days');
  });
});

describe('decisionLine', () => {
  const action = (over: Record<string, unknown>) => ({ id: 'a', requestId: 'r-1', revision: 1, step: 'DIRECTOR', action: 'APPROVED', actorId: 'u-dir', amount: null, comment: null, at: '2026-10-10T06:00:00Z', ...over }) as never;

  it('confirms what the viewer just decided', () => {
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [action({ amount: '40000.00' })] }, 'u-dir')).toBe('ADV-2026-0012 approved for NPR 40,000.00.');
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [action({ step: 'PM', actorId: 'u-pm' })] }, 'u-pm')).toBe('ADV-2026-0012 approved.');
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [action({ action: 'RETURNED' })] }, 'u-dir')).toBe('ADV-2026-0012 returned to the requester.');
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [action({ action: 'REJECTED' })] }, 'u-dir')).toBe('ADV-2026-0012 rejected.');
  });

  it('says nothing when the last step was not the viewer’s', () => {
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [action({ actorId: 'someone-else' })] }, 'u-dir')).toBeNull();
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [] }, 'u-dir')).toBeNull();
  });
});
