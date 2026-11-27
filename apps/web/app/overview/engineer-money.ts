import { addMoney, settlementStatus } from '../finance/model';
import type { AdvanceBalance, FinanceRequest } from '../lib/finance-api';

/** Pure rules behind the field engineer's "Your money" panel. */

const IN_APPROVAL = new Set<FinanceRequest['status']>(['PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE']);

/** What the dashboard knows about one paid advance once its detail has been read. */
export interface AdvanceDetail { balance?: AdvanceBalance | undefined; settlementDueOn?: string | null | undefined }

export interface OpenAdvance {
  id: string; number: string; purpose: string; projectCode: string;
  outstanding: string;
  /** `YYYY-MM-DD`, or null when the detail could not be read. */
  dueOn: string | null;
  /** "Settle by 04 Dec 2026" / "Overdue since 20 Nov 2026"; null when the window is unknown. */
  due: { label: string; overdue: boolean } | null;
}

export interface EngineerMoney {
  /** Cash from paid advances not yet settled or returned. */
  cashWithYou: string;
  advances: OpenAdvance[];
  overdue: number;
  inApproval: { count: number; amount: string };
  /** Sent back by an approver: the engineer has to fix and resubmit. */
  returned: FinanceRequest[];
  drafts: number;
}

const requested = (r: FinanceRequest): string => r.approvedAmount ?? r.requestedAmount;

/**
 * `today` is the calendar day (`YYYY-MM-DD`) the settle-by day is compared
 * against, the same comparison the request page makes. Advances are
 * ordered soonest settle-by day first, which puts overdue ones at the top.
 */
export function engineerMoney(
  requests: readonly FinanceRequest[], details: ReadonlyMap<string, AdvanceDetail>, today: string,
): EngineerMoney {
  const advances: OpenAdvance[] = [];
  for (const r of requests) {
    if (r.kind !== 'ADVANCE' || r.status !== 'PAID') continue;
    const detail = details.get(r.id);
    if (detail?.balance?.status === 'CLOSED') continue;
    advances.push({
      id: r.id, number: r.number, purpose: r.purpose, projectCode: r.projectCode,
      // Without the balance the best estimate is the whole advance.
      outstanding: detail?.balance?.outstanding ?? requested(r),
      dueOn: detail?.settlementDueOn ?? null,
      due: settlementStatus(detail?.settlementDueOn, detail?.balance, today),
    });
  }
  // Soonest settle-by day first, so overdue ones lead; unknown days go last.
  advances.sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'));

  const pending = requests.filter((r) => IN_APPROVAL.has(r.status));
  return {
    cashWithYou: addMoney('0.00', ...advances.map((a) => a.outstanding)),
    advances,
    overdue: advances.filter((a) => a.due?.overdue).length,
    inApproval: { count: pending.length, amount: addMoney('0.00', ...pending.map(requested)) },
    returned: requests.filter((r) => r.status === 'RETURNED'),
    drafts: requests.filter((r) => r.status === 'DRAFT').length,
  };
}

/** Today's calendar day in Kathmandu, where settle-by days are counted. */
export function kathmanduToday(now: Date): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}
