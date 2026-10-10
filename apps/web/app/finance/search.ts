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

export const HISTORY_PILLS = [
  { key: 'all', label: 'All' },
  { key: 'approval', label: 'In approval', stage: 'approval' },
  { key: 'closed', label: 'Paid & settled', stage: 'closed' },
  { key: 'returned', label: 'Returned', status: 'RETURNED' },
  { key: 'rejected', label: 'Rejected', status: 'REJECTED' },
  { key: 'handled', label: 'Decided by me', view: 'handled' },
] as const satisfies readonly { key: string; label: string; stage?: 'approval' | 'closed'; status?: RequestStatus; view?: 'handled' }[];

export interface RawHistory extends RawSearch { filter?: string; q?: string }
export interface ResolvedHistory {
  view: RequestView; pill: string; page: number; status?: RequestStatus; stage?: 'approval' | 'closed'; kind?: RequestKind; q?: string;
}

/** The history page's query string, checked. Decided-by-me is for approvers who see everything; `view=awaiting` is the Queue's, never History's. */
export function resolveHistory(search: RawHistory, caps: { mayAct: boolean; seeAll: boolean }): ResolvedHistory {
  const pill = HISTORY_PILLS.find((p) => p.key === search.filter && (p.key !== 'handled' || (caps.mayAct && caps.seeAll)));
  const legacyView = search.view === 'handled' && caps.mayAct && caps.seeAll ? 'handled'
    : search.view === 'all' && caps.seeAll ? 'all' : search.view === 'mine' ? 'mine' : undefined;
  const view: RequestView = pill && 'view' in pill ? pill.view : legacyView ?? (caps.seeAll ? 'all' : 'mine');
  const status = (pill && 'status' in pill ? pill.status : undefined) ?? STATUSES.find((s) => s === search.status);
  const kind = KINDS.find((k) => k === search.kind);
  const q = search.q?.trim();
  return {
    view, pill: pill?.key ?? 'all', page: Math.max(1, Math.floor(Number(search.page)) || 1),
    ...(status ? { status } : {}),
    ...(pill && 'stage' in pill ? { stage: pill.stage } : {}),
    ...(kind ? { kind } : {}),
    ...(q ? { q } : {}),
  };
}

export function historyHref(params: { filter?: string; q?: string; status?: string; kind?: string; page?: number }): string {
  const out = new URLSearchParams();
  if (params.filter && params.filter !== 'all') out.set('filter', params.filter);
  if (params.status) out.set('status', params.status);
  if (params.kind) out.set('kind', params.kind);
  if (params.q) out.set('q', params.q);
  if (params.page !== undefined && params.page > 1) out.set('page', String(params.page));
  const text = out.toString();
  return text ? `/finance/history?${text}` : '/finance/history';
}

/** Where an old `/finance?view=…` link now lives, or null when the URL carries no old view. */
export function legacyTarget(search: RawSearch): string | null {
  if (!search.view) return null;
  const params = new URLSearchParams();
  if (search.view === 'awaiting') {
    if (search.kind) params.set('kind', search.kind);
    if (search.decided) params.set('decided', search.decided);
    const text = params.toString();
    return text ? `/finance/queue?${text}` : '/finance/queue';
  }
  params.set('view', search.view);
  for (const key of ['status', 'kind', 'page'] as const) if (search[key]) params.set(key, search[key]!);
  return `/finance/history?${params.toString()}`;
}
