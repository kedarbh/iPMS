'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  approveRequest, cancelRequest, createCategory, createRequest, listRequests, payRequest, rejectRequest, returnCash, returnRequest,
  submitRequest, updateCategory, updateRequest,
  type CreateRequestInput, type PaymentInput, type PaymentMode, type UpdateRequestInput,
} from '../lib/finance-api';
import { getCurrentUser } from '../lib/iam-api';
import type { FormState } from '../lib/form-state';
import { optional, settle } from '../lib/settle';
import { homeFor } from '../overview/model';
import { parseInvoices, parseMoney } from './form';

const MONEY_ERROR = 'Enter an amount in NPR with at most two decimals.';
const MODES: readonly PaymentMode[] = ['BANK_TRANSFER', 'CASH', 'CHEQUE', 'MOBILE_WALLET'];
const isMode = (value: string | undefined): value is PaymentMode => value !== undefined && (MODES as readonly string[]).includes(value);

/** Every page a change to one request shows on: the workspace and the request itself. */
const pages = (id: string): string[] => ['/finance', `/finance/requests/${id}`];

/** A decision also changes the Director's home, which shows their queue. */
const decisionPages = (id: string): string[] => [...pages(id), '/'];

/**
 * After a decision, the next request waiting on the caller (the awaiting view
 * is oldest first) or, when none is left, their home: the Director's
 * dashboard, or the finance queue for everyone else. Only the decided
 * request's id travels in the URL; the page reads the rest.
 */
async function nextAfterDecision(decidedId: string): Promise<never> {
  const [queue, viewer] = await Promise.all([listRequests({ view: 'awaiting', limit: 2 }), getCurrentUser()]);
  const next = queue.state === 'ready' ? queue.data.items.find((r) => r.id !== decidedId) : undefined;
  if (next) redirect(`/finance/requests/${next.id}?decided=${decidedId}`);
  const director = viewer.state === 'ready' && homeFor(viewer.data.roles) === 'director';
  redirect(director ? `/?decided=${decidedId}` : `/finance?view=awaiting&decided=${decidedId}`);
}

/** The trimmed request id a form carries, or undefined when it has none. */
const requiredId = (form: FormData): string | undefined => optional(form, 'id');
const MISSING_REQUEST: FormState = { error: 'Missing request.' };

/**
 * Creates or edits a request and, when asked, submits it. `id` present means
 * edit. The kind and project of an existing request never change, so an edit
 * sends only what the service allows to change.
 */
export async function saveRequestAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = optional(form, 'id');
  const kind = optional(form, 'kind');
  const categoryId = optional(form, 'categoryId');
  const purpose = optional(form, 'purpose');
  const workOrderId = optional(form, 'workOrderId');
  const submit = optional(form, 'intent') === 'submit';

  if (!categoryId) return { error: 'Choose a category.' };
  if (!purpose) return { error: 'Say what the money is for.' };
  if (kind !== 'ADVANCE' && kind !== 'REIMBURSEMENT' && kind !== 'SETTLEMENT') return { error: 'Choose what you are asking for.' };

  let create: CreateRequestInput | undefined;
  let change: UpdateRequestInput | undefined;

  if (kind === 'ADVANCE') {
    const amount = parseMoney(optional(form, 'amount'));
    if (amount === null) return { error: MONEY_ERROR };
    const projectId = optional(form, 'projectId');
    if (!id && !projectId) return { error: 'Choose a project.' };
    if (id) change = { categoryId, purpose, amount };
    else create = { kind, projectId: projectId!, categoryId, purpose, amount, ...(workOrderId ? { workOrderId } : {}) };
  } else {
    const parsed = parseInvoices(form);
    if ('error' in parsed) return { error: parsed.error };
    if (id) {
      change = { categoryId, purpose, invoices: parsed.invoices };
    } else if (kind === 'REIMBURSEMENT') {
      const projectId = optional(form, 'projectId');
      if (!projectId) return { error: 'Choose a project.' };
      create = { kind, projectId, categoryId, purpose, invoices: parsed.invoices, ...(workOrderId ? { workOrderId } : {}) };
    } else {
      const advanceId = optional(form, 'advanceId');
      if (!advanceId) return { error: 'Choose the advance to settle.' };
      create = { kind, advanceId, categoryId, purpose, invoices: parsed.invoices, ...(workOrderId ? { workOrderId } : {}) };
    }
  }

  const saved = id ? await updateRequest(id, change!) : await createRequest(create!);
  const state = await settle(saved, '/finance');
  if (state.error || saved.state !== 'ready') return state;
  const requestId = id ?? saved.data.id;

  if (submit) {
    // The draft is saved either way. A failed submit must not leave the form
    // without an id (a retry would create a duplicate), so the draft's own page
    // opens instead and its Submit button shows the reason if it fails again.
    await settle(await submitRequest(requestId), pages(requestId));
    for (const path of pages(requestId)) revalidatePath(path);
  }
  redirect(`/finance/requests/${requestId}`);
}

export async function submitAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = requiredId(form);
  if (!id) return MISSING_REQUEST;
  return settle(await submitRequest(id), pages(id));
}

export async function cancelAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = requiredId(form);
  if (!id) return MISSING_REQUEST;
  return settle(await cancelRequest(id, optional(form, 'comment')), pages(id));
}

export async function approveAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = requiredId(form);
  if (!id) return MISSING_REQUEST;
  const typed = optional(form, 'amount');
  const amount = typed === undefined ? undefined : parseMoney(typed);
  if (amount === null) return { error: MONEY_ERROR };
  const comment = optional(form, 'comment');
  const state = await settle(await approveRequest(id, { ...(amount === undefined ? {} : { amount }), ...(comment ? { comment } : {}) }), decisionPages(id));
  return state.error ? state : nextAfterDecision(id);
}

export async function returnAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = requiredId(form);
  if (!id) return MISSING_REQUEST;
  const comment = optional(form, 'comment');
  if (!comment) return { error: 'Say why.' };
  const state = await settle(await returnRequest(id, comment), decisionPages(id));
  return state.error ? state : nextAfterDecision(id);
}

export async function rejectAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = requiredId(form);
  if (!id) return MISSING_REQUEST;
  const comment = optional(form, 'comment');
  if (!comment) return { error: 'Say why.' };
  const state = await settle(await rejectRequest(id, comment), decisionPages(id));
  return state.error ? state : nextAfterDecision(id);
}

/** Blank details are sent as nothing: the service wants them only when money actually moves. */
export async function payAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = requiredId(form);
  if (!id) return MISSING_REQUEST;
  const mode = optional(form, 'mode');
  if (mode !== undefined && !isMode(mode)) return { error: 'Choose how it was paid.' };
  const reference = optional(form, 'reference');
  const paidOn = optional(form, 'paidOn');
  const note = optional(form, 'note');
  const body: Partial<PaymentInput> = {
    ...(mode ? { mode } : {}), ...(reference ? { reference } : {}), ...(paidOn ? { paidOn } : {}), ...(note ? { note } : {}),
  };
  return settle(await payRequest(id, body), pages(id));
}

export async function cashReturnAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = requiredId(form);
  if (!id) return MISSING_REQUEST;
  const amount = parseMoney(optional(form, 'amount'));
  if (amount === null) return { error: MONEY_ERROR };
  const mode = optional(form, 'mode');
  const reference = optional(form, 'reference');
  const paidOn = optional(form, 'paidOn');
  if (!isMode(mode)) return { error: 'Choose how it was returned.' };
  if (!reference || !paidOn) return { error: 'Enter the reference and the date.' };
  const note = optional(form, 'note');
  return settle(await returnCash(id, { amount, mode, reference, paidOn, ...(note ? { note } : {}) }), pages(id));
}

export async function createCategoryAction(_previous: FormState, form: FormData): Promise<FormState> {
  const code = optional(form, 'code')?.toUpperCase();
  const name = optional(form, 'name');
  if (!code || !name) return { error: 'Enter a code and a name.' };
  return settle(await createCategory({ code, name }), '/finance/categories');
}

export async function updateCategoryAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = requiredId(form);
  if (!id) return { error: 'Missing category.' };
  const name = optional(form, 'name');
  const disabled = optional(form, 'disabled');
  return settle(
    await updateCategory(id, { ...(name ? { name } : {}), ...(disabled === undefined ? {} : { disabled: disabled === 'true' }) }),
    '/finance/categories',
  );
}
