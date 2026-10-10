import type { RequestKind, RequestStatus, RequestView } from '../lib/finance-api';

const STATUSES: readonly RequestStatus[] = ['DRAFT', 'PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE', 'PAID', 'SETTLED', 'RETURNED', 'REJECTED', 'CANCELLED'];
const KINDS: readonly RequestKind[] = ['ADVANCE', 'SETTLEMENT', 'REIMBURSEMENT'];

export interface RawSearch { view?: string; status?: string; kind?: string; page?: string; decided?: string }
export interface Resolved { view: RequestView; status?: RequestStatus; kind?: RequestKind; page: number; tabs: RequestView[] }

/**
 * The workspace's query string, checked: only tabs the viewer may use, only
 * known filters, a whole page number. Approvers who see every request get
 * Decided by me; only people who raise requests get My requests.
 */
export function resolveSearch(search: RawSearch, caps: { mayAct: boolean; seeAll: boolean; mayRaise: boolean }): Resolved {
  const tabs: RequestView[] = [];
  if (caps.mayAct) tabs.push('awaiting');
  if (caps.mayAct && caps.seeAll) tabs.push('handled');
  if (caps.mayRaise || !caps.mayAct) tabs.push('mine');
  if (caps.seeAll) tabs.push('all');
  const view = tabs.find((tab) => tab === search.view) ?? (caps.mayAct ? 'awaiting' : 'mine');
  const status = STATUSES.find((s) => s === search.status);
  const kind = KINDS.find((k) => k === search.kind);
  return {
    view, tabs,
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    page: Math.max(1, Math.floor(Number(search.page)) || 1),
  };
}
