import 'server-only';
import type { DecisionContext, FinanceOverview, RequestFlag, RequestKind, RequestStatus } from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

/**
 * Finance: advances, settlements and reimbursements with a PM → Director →
 * Finance approval. The finance service owns them; the gateway's
 * `/api/v1/finance` prefix reaches it. Wire shapes: money is a two-decimal
 * string, dates are ISO strings. The service decides what the caller may see
 * and do; these functions only carry the request.
 */

export type { DecisionContext, FinanceOverview, RequestFlag, RequestKind, RequestStatus };
export type PaymentMode = 'BANK_TRANSFER' | 'CASH' | 'CHEQUE' | 'MOBILE_WALLET';
export type FinanceStep = 'REQUESTER' | 'PM' | 'DIRECTOR' | 'FINANCE';

export interface FinanceRequest {
  id: string; number: string; kind: RequestKind; status: RequestStatus; revision: number; entryStatus: string | null;
  projectId: string; projectCode: string; projectName: string; workOrderId: string | null;
  categoryId: string; requesterId: string; advanceId: string | null; purpose: string;
  requestedAmount: string; approvedAmount: string | null; appliedAmount: string | null;
  submittedAt: string | null; createdAt: string; updatedAt: string;
  category?: { code: string; name: string };
  /** Warnings, on rows of the awaiting view only. */
  flags?: RequestFlag[];
}

export interface RequestInvoice {
  id: string; requestId: string; vendor: string; invoiceNumber: string | null; invoiceDate: string; amount: string; mediaId: string | null;
  /** A VAT bill: 13% is inside the amount. */
  vat: boolean; supplierTaxNo: string | null;
}
export interface ApprovalAction {
  id: string; requestId: string; revision: number; step: FinanceStep; action: string; actorId: string;
  amount: string | null; comment: string | null; at: string;
}
export interface Payment {
  id: string; requestId: string; kind: 'PAYOUT' | 'CASH_RETURN'; mode: PaymentMode; reference: string; paidOn: string;
  amount: string; note: string | null; proofMediaId: string | null; recordedBy: string; createdAt: string;
}
export interface AdvanceBalance {
  paid: string; applied: string; cashReturned: string; outstanding: string; status: 'PAID' | 'PARTIALLY_SETTLED' | 'CLOSED';
}
/** Another live request holding a bill like one of this request's. */
export interface DuplicateHit {
  requestId: string; number: string; status: RequestStatus; vendor: string; invoiceNumber: string | null;
  reason: 'SAME_NUMBER' | 'SAME_BILL' | 'NUMBER_OTHER_YEAR';
}
export type FinanceRequestDetail = FinanceRequest & {
  invoices: RequestInvoice[]; actions: ApprovalAction[]; payments: Payment[]; balance?: AdvanceBalance;
  duplicates?: DuplicateHit[];
  /** A paid advance's last day to settle (`YYYY-MM-DD`): a week after it was paid. */
  settlementDueOn?: string | null;
  /** "Before you decide": present only for the approver at the request's current step. */
  context?: DecisionContext;
};
export interface AdvanceView { advance: FinanceRequest; balance: AdvanceBalance | null; settlements: FinanceRequest[] }
export interface RequestPage { items: FinanceRequest[]; total: number; page: number; limit: number }
export interface ExpenseCategory { id: string; code: string; name: string; disabledAt: string | null; createdAt: string }
export interface SpendRow {
  key: string; label: string; advancesPaid: string; applied: string; cashReturned: string; outstanding: string;
  reimbursed: string; settled: string; expense: string;
}

export type RequestView = 'mine' | 'awaiting' | 'all' | 'handled';
export interface RequestFilter {
  view?: RequestView | undefined; status?: RequestStatus | undefined; kind?: RequestKind | undefined;
  projectId?: string | undefined; page?: number | undefined; limit?: number | undefined;
}

/** Invoice rows as a form sends them: the date is a `YYYY-MM-DD` string, the amount a two-decimal string. */
export interface InvoiceInput {
  vendor: string; invoiceNumber?: string; invoiceDate: string; amount: string; mediaId?: string;
  /** A VAT bill: 13% is inside the amount. */
  vat?: boolean; supplierTaxNo?: string;
}

export type CreateRequestInput =
  | { kind: 'ADVANCE'; projectId: string; categoryId: string; purpose: string; amount: string; workOrderId?: string }
  | { kind: 'REIMBURSEMENT'; projectId: string; categoryId: string; purpose: string; invoices: InvoiceInput[]; workOrderId?: string }
  | { kind: 'SETTLEMENT'; advanceId: string; categoryId: string; purpose: string; invoices: InvoiceInput[]; workOrderId?: string };

export interface UpdateRequestInput {
  categoryId?: string; purpose?: string; workOrderId?: string | null; amount?: string; invoices?: InvoiceInput[];
}
export interface PaymentInput { mode: PaymentMode; reference: string; paidOn: string; note?: string }
export interface SpendQuery { groupBy?: 'project' | 'category' | 'requester'; projectId?: string; from?: string; to?: string }

const BASE = '/api/v1/finance';

export function listRequests(filter: RequestFilter = {}): Promise<ApiResult<RequestPage>> {
  return authFetch<RequestPage>(`${BASE}/requests`, {
    query: {
      view: filter.view, status: filter.status, kind: filter.kind, projectId: filter.projectId,
      page: filter.page === undefined ? undefined : String(filter.page),
      limit: filter.limit === undefined ? undefined : String(filter.limit),
    },
  });
}

export const getRequest = (id: string): Promise<ApiResult<FinanceRequestDetail>> => authFetch(`${BASE}/requests/${id}`);
export const getAdvance = (id: string): Promise<ApiResult<AdvanceView>> => authFetch(`${BASE}/advances/${id}`);

/** The approver's money at a glance: pipeline, queue, spend, cash out and their decisions. */
export const getFinanceOverview = (): Promise<ApiResult<FinanceOverview>> => authFetch(`${BASE}/overview`);

export const createRequest = (input: CreateRequestInput): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests`, { method: 'POST', json: input });
export const updateRequest = (id: string, input: UpdateRequestInput): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}`, { method: 'PATCH', json: input });
export const submitRequest = (id: string): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/submit`, { method: 'POST' });
export const cancelRequest = (id: string, comment?: string): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/cancel`, { method: 'POST', json: comment ? { comment } : {} });

export const approveRequest = (id: string, body: { amount?: string; comment?: string }): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/approve`, { method: 'POST', json: body });
export const returnRequest = (id: string, comment: string): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/return`, { method: 'POST', json: { comment } });
export const rejectRequest = (id: string, comment: string): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/reject`, { method: 'POST', json: { comment } });

export const payRequest = (id: string, body: Partial<PaymentInput>): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/requests/${id}/pay`, { method: 'POST', json: body });
export const returnCash = (advanceId: string, body: PaymentInput & { amount: string }): Promise<ApiResult<FinanceRequestDetail>> =>
  authFetch(`${BASE}/advances/${advanceId}/cash-return`, { method: 'POST', json: body });

export const listCategories = (): Promise<ApiResult<ExpenseCategory[]>> => authFetch(`${BASE}/categories`);
export const createCategory = (input: { code: string; name: string }): Promise<ApiResult<ExpenseCategory>> =>
  authFetch(`${BASE}/categories`, { method: 'POST', json: input });
export const updateCategory = (id: string, input: { name?: string; disabled?: boolean }): Promise<ApiResult<ExpenseCategory>> =>
  authFetch(`${BASE}/categories/${id}`, { method: 'PATCH', json: input });

export function spendReport(query: SpendQuery = {}): Promise<ApiResult<SpendRow[]>> {
  return authFetch<SpendRow[]>(`${BASE}/reports/project-spend`, {
    query: { groupBy: query.groupBy, projectId: query.projectId, from: query.from, to: query.to, format: 'json' },
  });
}
