import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const toastState = { pending: false };
vi.mock('../components/toast', () => ({
  useActionStateWithToast: (_action: unknown, initial: unknown) => [initial, () => undefined, toastState.pending],
}));
vi.mock('./actions', () => ({ saveRequestAction: vi.fn() }));

const { RequestForm } = await import('./request-form');

const projects = [{ id: 'p-1', code: 'KOS', name: 'Koshi Rollout' }];
const categories = [{ id: 'c-1', code: 'TRAVEL', name: 'Travel' }];

describe('RequestForm', () => {
  it('asks an advance for a project, category, purpose and amount, and no invoices', () => {
    const out = renderToStaticMarkup(<RequestForm kind="ADVANCE" projects={projects} categories={categories} />);
    expect(out).toContain('name="projectId"');
    expect(out).toContain('name="categoryId"');
    expect(out).toContain('name="purpose"');
    expect(out).toContain('name="amount"');
    expect(out).not.toContain('name="invoiceVendor"');
    expect(out).toContain('value="ADVANCE"');
    expect(out).toContain('Save draft');
    expect(out).toContain('Submit for approval');
    expect(out).toMatch(/<button[^>]*value="draft"[^>]*name="intent"[^>]*>Save draft/);
    expect(out).toMatch(/<button[^>]*value="submit"[^>]*name="intent"[^>]*>Submit for approval/);
  });

  it('asks a reimbursement for invoice rows instead of an amount', () => {
    const out = renderToStaticMarkup(<RequestForm kind="REIMBURSEMENT" projects={projects} categories={categories} />);
    expect(out).toContain('name="invoiceVendor"');
    expect(out).toContain('name="invoiceAmount"');
    expect(out).not.toContain('name="amount"');
  });

  it('settles a given advance without choosing a project, and says what is outstanding', () => {
    const out = renderToStaticMarkup(
      <RequestForm kind="SETTLEMENT" projects={projects} categories={categories} advance={{ id: 'a-1', number: 'ADV-2026-0007', projectName: 'Koshi Rollout', outstanding: '38000.00' }} />,
    );
    expect(out).toContain('name="advanceId"');
    expect(out).toContain('value="a-1"');
    expect(out).toContain('ADV-2026-0007');
    expect(out).toContain('NPR 38,000.00');
    expect(out).not.toContain('name="projectId"');
  });

  it('edits an existing request: carries its id, keeps the kind and cannot change the project', () => {
    const out = renderToStaticMarkup(
      <RequestForm kind="ADVANCE" projects={projects} categories={categories}
        initial={{ id: 'r-9', categoryId: 'c-1', purpose: 'Site travel', remarks: '', requestedAmount: '50000.00', invoices: [] }} />,
    );
    expect(out).toContain('name="id"');
    expect(out).toContain('value="r-9"');
    expect(out).toContain('Site travel');
    expect(out).toContain('50000.00');
    expect(out).not.toContain('name="projectId"');
    expect(out).not.toContain('name="workOrderId"');
    expect(out).not.toContain('mediaId');
  });

  it('disables both submit buttons while a save is pending, and not otherwise', () => {
    toastState.pending = true;
    const busy = renderToStaticMarkup(<RequestForm kind="ADVANCE" projects={projects} categories={categories} />);
    expect(busy).toMatch(/<button[^>]*disabled[^>]*value="draft"|<button[^>]*value="draft"[^>]*disabled/);
    expect(busy).toMatch(/<button[^>]*disabled[^>]*value="submit"|<button[^>]*value="submit"[^>]*disabled/);
    expect(busy).toContain('Working…');
    toastState.pending = false;
    const idle = renderToStaticMarkup(<RequestForm kind="ADVANCE" projects={projects} categories={categories} />);
    expect(idle).not.toMatch(/<button[^>]*disabled/);
  });

  it('labels each invoice Remove button with its row number', () => {
    const out = renderToStaticMarkup(
      <RequestForm kind="REIMBURSEMENT" projects={projects} categories={categories}
        initial={{ id: 'r-9', categoryId: 'c-1', purpose: 'x', remarks: '', requestedAmount: '1.00', invoices: [
          { vendor: 'A', invoiceNumber: '1', invoiceDate: '2026-10-01', amount: '1' },
          { vendor: 'B', invoiceNumber: '2', invoiceDate: '2026-10-02', amount: '2' }] }} />,
    );
    expect(out).toContain('aria-label="Remove invoice 1"');
    expect(out).toContain('aria-label="Remove invoice 2"');
  });
});
