import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); });
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));

const ready = (data: unknown = {}) => ({ state: 'ready' as const, data });
const api = {
  createRequest: vi.fn(), updateRequest: vi.fn(), submitRequest: vi.fn(), cancelRequest: vi.fn(),
  approveRequest: vi.fn(), returnRequest: vi.fn(), rejectRequest: vi.fn(), payRequest: vi.fn(), returnCash: vi.fn(),
  createCategory: vi.fn(), updateCategory: vi.fn(), listRequests: vi.fn(),
};
vi.mock('../lib/finance-api', () => api);
const getCurrentUser = vi.fn();
vi.mock('../lib/iam-api', () => ({ getCurrentUser }));
const asRole = (role: string) => ({ state: 'ready' as const, data: { id: 'u-1', roles: [role], permissions: [], tokenVersion: 0, isActive: true } });

const actions = await import('./actions');
const EMPTY = {};
const form = (entries: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) for (const one of Array.isArray(value) ? value : [value]) data.append(key, one);
  return data;
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue(ready({ id: 'r-1' }));
  revalidatePath.mockClear(); redirect.mockClear();
  api.listRequests.mockResolvedValue(ready({ items: [], total: 0, page: 1, limit: 2 }));
  getCurrentUser.mockReset().mockResolvedValue(asRole('PROJECT_MANAGER'));
});

describe('saveRequestAction', () => {
  const advance = { kind: 'ADVANCE', projectId: 'p-1', categoryId: 'c-1', purpose: 'Site travel', amount: '50,000' };

  it('creates an advance as a draft and opens it', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({ ...advance, intent: 'draft' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-1');
    expect(api.createRequest).toHaveBeenCalledWith({ kind: 'ADVANCE', projectId: 'p-1', categoryId: 'c-1', purpose: 'Site travel', amount: '50000.00' });
    expect(api.submitRequest).not.toHaveBeenCalled();
  });

  it('submits straight away when asked to', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({ ...advance, intent: 'submit' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-1');
    expect(api.submitRequest).toHaveBeenCalledWith('r-1');
  });

  it('creates a settlement against an advance from its invoice rows', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({
      kind: 'SETTLEMENT', advanceId: 'a-1', categoryId: 'c-1', purpose: 'Bills', intent: 'draft',
      invoiceVendor: ['V'], invoiceNumber: ['I-1'], invoiceDate: ['2026-10-01'], invoiceAmount: ['1,200'],
    }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.createRequest).toHaveBeenCalledWith({
      kind: 'SETTLEMENT', advanceId: 'a-1', categoryId: 'c-1', purpose: 'Bills',
      invoices: [{ vendor: 'V', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '1200.00' }],
    });
  });

  it('updates an existing request instead of creating one', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({ ...advance, id: 'r-9', intent: 'draft' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-9');
    expect(api.updateRequest).toHaveBeenCalledWith('r-9', { categoryId: 'c-1', purpose: 'Site travel', amount: '50000.00' });
    expect(api.createRequest).not.toHaveBeenCalled();
  });

  it('explains what is missing instead of calling the API', async () => {
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, amount: 'abc', intent: 'draft' }))).toEqual({ error: 'Enter an amount in NPR with at most two decimals.' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, purpose: '  ', intent: 'draft' }))).toEqual({ error: 'Say what the money is for.' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, categoryId: '', intent: 'draft' }))).toEqual({ error: 'Choose a category.' });
    expect(await actions.saveRequestAction(EMPTY, form({ kind: 'REIMBURSEMENT', projectId: 'p-1', categoryId: 'c-1', purpose: 'Fuel', intent: 'draft' }))).toEqual({ error: 'Add at least one invoice.' });
    expect(api.createRequest).not.toHaveBeenCalled();
  });

  it('shows the service message when it refuses', async () => {
    api.createRequest.mockResolvedValue({ state: 'forbidden', message: 'You do not have access to this project' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...advance, intent: 'draft' }))).toEqual({ error: 'You do not have access to this project' });
  });
});

describe('saveRequestAction after a successful save', () => {
  const advance = { kind: 'ADVANCE', projectId: 'p-1', categoryId: 'c-1', purpose: 'Site travel', amount: '50,000', intent: 'submit' };

  it('opens the saved draft instead of returning the error when the submit fails on create', async () => {
    api.submitRequest.mockResolvedValue({ state: 'forbidden', message: 'x' });
    await expect(actions.saveRequestAction(EMPTY, form(advance))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-1');
    expect(api.createRequest).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/finance');
    expect(revalidatePath).toHaveBeenCalledWith('/finance/requests/r-1');
  });

  it('does the same when editing', async () => {
    api.submitRequest.mockResolvedValue({ state: 'unavailable', message: 'x' });
    await expect(actions.saveRequestAction(EMPTY, form({ ...advance, id: 'r-9' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-9');
    expect(api.updateRequest).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/finance/requests/r-9');
  });

  it('still sends an unauthenticated submit to the login page', async () => {
    api.submitRequest.mockResolvedValue({ state: 'unauthenticated' });
    await expect(actions.saveRequestAction(EMPTY, form(advance))).rejects.toThrow('NEXT_REDIRECT:/login');
  });
});

describe('saveRequestAction coverage', () => {
  const base = { categoryId: 'c-1', purpose: 'Fuel', intent: 'draft' };
  const rows = { invoiceVendor: ['V'], invoiceNumber: ['I-1'], invoiceDate: ['2026-10-01'], invoiceAmount: ['100'] };

  it('edits a reimbursement with category, purpose and invoices only', async () => {
    await expect(actions.saveRequestAction(EMPTY, form({ ...base, ...rows, kind: 'REIMBURSEMENT', id: 'r-5', projectId: 'p-1' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-5');
    expect(api.updateRequest).toHaveBeenCalledWith('r-5', {
      categoryId: 'c-1', purpose: 'Fuel', invoices: [{ vendor: 'V', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '100.00' }],
    });
  });

  it('asks for a project and for an advance to settle', async () => {
    expect(await actions.saveRequestAction(EMPTY, form({ ...base, kind: 'ADVANCE', amount: '10' }))).toEqual({ error: 'Choose a project.' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...base, ...rows, kind: 'REIMBURSEMENT' }))).toEqual({ error: 'Choose a project.' });
    expect(await actions.saveRequestAction(EMPTY, form({ ...base, ...rows, kind: 'SETTLEMENT' }))).toEqual({ error: 'Choose the advance to settle.' });
    expect(api.createRequest).not.toHaveBeenCalled();
  });
});

describe('actions without a request id', () => {
  const cases: Array<[string, (f: FormData) => Promise<unknown>, string, Record<string, string>]> = [
    ['submit', (f) => actions.submitAction(EMPTY, f), 'submitRequest', {}],
    ['cancel', (f) => actions.cancelAction(EMPTY, f), 'cancelRequest', {}],
    ['approve', (f) => actions.approveAction(EMPTY, f), 'approveRequest', {}],
    ['return', (f) => actions.returnAction(EMPTY, f), 'returnRequest', { comment: 'why' }],
    ['reject', (f) => actions.rejectAction(EMPTY, f), 'rejectRequest', { comment: 'why' }],
    ['pay', (f) => actions.payAction(EMPTY, f), 'payRequest', {}],
    ['cashReturn', (f) => actions.cashReturnAction(EMPTY, f), 'returnCash', { amount: '5', mode: 'CASH', reference: 'R', paidOn: '2026-10-05' }],
  ];
  it.each(cases)('%s reports the missing request without calling the API', async (_name, run, apiName, extra) => {
    expect(await run(form(extra))).toEqual({ error: 'Missing request.' });
    expect(await run(form({ ...extra, id: '  ' }))).toEqual({ error: 'Missing request.' });
    expect(api[apiName as keyof typeof api]).not.toHaveBeenCalled();
  });

  it('updateCategory reports the missing category', async () => {
    expect(await actions.updateCategoryAction(EMPTY, form({ name: 'X' }))).toEqual({ error: 'Missing category.' });
    expect(api.updateCategory).not.toHaveBeenCalled();
  });
});

describe('request actions', () => {
  it('sends an unauthenticated result to the login page', async () => {
    api.submitRequest.mockResolvedValue({ state: 'unauthenticated' });
    await expect(actions.submitAction(EMPTY, form({ id: 'r-1' }))).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('submits and cancels, refreshing the workspace and the request page', async () => {
    expect(await actions.submitAction(EMPTY, form({ id: 'r-1' }))).toEqual(EMPTY);
    expect(api.submitRequest).toHaveBeenCalledWith('r-1');
    expect(revalidatePath).toHaveBeenCalledWith('/finance');
    expect(revalidatePath).toHaveBeenCalledWith('/finance/requests/r-1');
    await actions.cancelAction(EMPTY, form({ id: 'r-1', comment: 'Not needed' }));
    expect(api.cancelRequest).toHaveBeenCalledWith('r-1', 'Not needed');
  });

  it('approves, with an amount only when one was typed', async () => {
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1', amount: '40,000', comment: 'Cut travel days' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.approveRequest).toHaveBeenCalledWith('r-1', { amount: '40000.00', comment: 'Cut travel days' });
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1', amount: '', comment: '' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.approveRequest).toHaveBeenLastCalledWith('r-1', {});
    expect(await actions.approveAction(EMPTY, form({ id: 'r-1', amount: '1.234' }))).toEqual({ error: 'Enter an amount in NPR with at most two decimals.' });
  });

  it('requires a reason to return or reject', async () => {
    expect(await actions.returnAction(EMPTY, form({ id: 'r-1', comment: '  ' }))).toEqual({ error: 'Say why.' });
    expect(await actions.rejectAction(EMPTY, form({ id: 'r-1', comment: '' }))).toEqual({ error: 'Say why.' });
    expect(api.returnRequest).not.toHaveBeenCalled();
    await expect(actions.returnAction(EMPTY, form({ id: 'r-1', comment: 'Add the quotation' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.returnRequest).toHaveBeenCalledWith('r-1', 'Add the quotation');
    await expect(actions.rejectAction(EMPTY, form({ id: 'r-1', comment: 'Not in budget' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.rejectRequest).toHaveBeenCalledWith('r-1', 'Not in budget');
  });
});

describe('after a decision', () => {
  it('opens the next request waiting on the caller, naming the one just decided', async () => {
    api.listRequests.mockResolvedValue(ready({ items: [{ id: 'r-1' }, { id: 'r-2' }], total: 2, page: 1, limit: 2 }));
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-2?decided=r-1');
    expect(api.listRequests).toHaveBeenCalledWith({ view: 'awaiting', limit: 2 });
    expect(revalidatePath).toHaveBeenCalledWith('/');
  });

  it.each([
    ['return', (f: FormData) => actions.returnAction(EMPTY, f)],
    ['reject', (f: FormData) => actions.rejectAction(EMPTY, f)],
  ])('does the same after a %s', async (_name, run) => {
    api.listRequests.mockResolvedValue(ready({ items: [{ id: 'r-3' }], total: 1, page: 1, limit: 2 }));
    await expect(run(form({ id: 'r-1', comment: 'why' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-3?decided=r-1');
  });

  it('sends a project manager back to the finance queue when nothing is left', async () => {
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1' }))).rejects.toThrow('NEXT_REDIRECT:/finance?view=awaiting&decided=r-1');
  });

  it('sends a Project Director home when nothing is left', async () => {
    getCurrentUser.mockResolvedValue(asRole('PROJECT_DIRECTOR'));
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1' }))).rejects.toThrow('NEXT_REDIRECT:/?decided=r-1');
  });

  it('stays on the request and shows the reason when the decision fails', async () => {
    api.approveRequest.mockResolvedValue({ state: 'forbidden', message: 'You already approved an earlier step of this request' });
    expect(await actions.approveAction(EMPTY, form({ id: 'r-1' }))).toEqual({ error: 'You already approved an earlier step of this request' });
    expect(api.listRequests).not.toHaveBeenCalled();
  });
});

describe('payment actions', () => {
  it('pays with the payment details', async () => {
    await actions.payAction(EMPTY, form({ id: 'r-1', mode: 'BANK_TRANSFER', reference: 'TXN-1', paidOn: '2026-10-05', note: 'NIC Asia' }));
    expect(api.payRequest).toHaveBeenCalledWith('r-1', { mode: 'BANK_TRANSFER', reference: 'TXN-1', paidOn: '2026-10-05', note: 'NIC Asia' });
  });

  it('sends nothing for blank details so a settlement without a payout can be confirmed', async () => {
    await actions.payAction(EMPTY, form({ id: 's-1', mode: '', reference: '', paidOn: '', note: '' }));
    expect(api.payRequest).toHaveBeenCalledWith('s-1', {});
  });

  it('refuses a payment mode it does not know', async () => {
    expect(await actions.payAction(EMPTY, form({ id: 'r-1', mode: 'BITCOIN', reference: 'x', paidOn: '2026-10-05' }))).toEqual({ error: 'Choose how it was paid.' });
  });

  it('needs the reference, the date and the mode to record returned cash', async () => {
    const full = { id: 'a-1', amount: '3,000', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-05' };
    expect(await actions.cashReturnAction(EMPTY, form({ ...full, reference: '' }))).toEqual({ error: 'Enter the reference and the date.' });
    expect(await actions.cashReturnAction(EMPTY, form({ ...full, paidOn: '' }))).toEqual({ error: 'Enter the reference and the date.' });
    expect(await actions.cashReturnAction(EMPTY, form({ ...full, mode: '' }))).toEqual({ error: 'Choose how it was returned.' });
    expect(api.returnCash).not.toHaveBeenCalled();
  });

  it('records returned cash against an advance', async () => {
    await actions.cashReturnAction(EMPTY, form({ id: 'a-1', amount: '3,000', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-05' }));
    expect(api.returnCash).toHaveBeenCalledWith('a-1', { amount: '3000.00', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-05' });
    expect(await actions.cashReturnAction(EMPTY, form({ id: 'a-1', amount: '', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-05' }))).toEqual({ error: 'Enter an amount in NPR with at most two decimals.' });
  });
});

describe('category actions', () => {
  it('creates a category from an upper-cased code and renames or disables one', async () => {
    await actions.createCategoryAction(EMPTY, form({ code: 'permits', name: 'Permits' }));
    expect(api.createCategory).toHaveBeenCalledWith({ code: 'PERMITS', name: 'Permits' });
    expect(revalidatePath).toHaveBeenCalledWith('/finance/categories');
    await actions.updateCategoryAction(EMPTY, form({ id: 'c-1', disabled: 'true' }));
    expect(api.updateCategory).toHaveBeenCalledWith('c-1', { disabled: true });
    await actions.updateCategoryAction(EMPTY, form({ id: 'c-1', disabled: 'false' }));
    expect(api.updateCategory).toHaveBeenLastCalledWith('c-1', { disabled: false });
    await actions.updateCategoryAction(EMPTY, form({ id: 'c-1', name: 'Permits and fees' }));
    expect(api.updateCategory).toHaveBeenLastCalledWith('c-1', { name: 'Permits and fees' });
  });
});
