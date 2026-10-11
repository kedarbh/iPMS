'use client';
import { useState } from 'react';
import { FormError } from '../components/forms';
import { useActionStateWithToast } from '../components/toast';
import { EMPTY } from '../lib/form-state';
import type { InvoiceInput, RequestKind } from '../lib/finance-api';
import { saveRequestAction } from './actions';
import { formatMoney } from './model';

export interface ProjectChoice { id: string; code: string; name: string }
export interface CategoryChoice { id: string; code: string; name: string }
export interface AdvanceContext { id: string; number: string; projectName: string; outstanding: string }
export interface RequestInitial {
  id: string; categoryId: string; purpose: string; remarks: string; requestedAmount: string;
  invoices: Invoice[];
}

type Invoice = Pick<InvoiceInput, 'vendor' | 'invoiceDate' | 'amount'> & Partial<Pick<InvoiceInput, 'invoiceNumber' | 'vat' | 'supplierTaxNo' | 'mediaId'>>;
/** Each row carries a stable key, so removing one in the middle keeps what was typed in the others. */
type Row = Invoice & { key: number };

const BLANK: Invoice = { vendor: '', invoiceNumber: '', invoiceDate: '', amount: '' };


/**
 * One form for all three kinds. An advance asks for an amount; a reimbursement
 * or a settlement lists invoices, and the total is their sum. The kind is fixed
 * once the request exists, and so is its project, so an edit offers neither.
 */
export function RequestForm({
  kind, projects, categories, advance, initial,
}: {
  kind: RequestKind; projects: ProjectChoice[]; categories: CategoryChoice[]; advance?: AdvanceContext; initial?: RequestInitial;
}) {
  const [state, action, pending] = useActionStateWithToast(saveRequestAction, EMPTY, 'Saved');
  const [rows, setRows] = useState<Row[]>(() => (initial && initial.invoices.length > 0 ? initial.invoices : [BLANK]).map((row, key) => ({ ...row, key })));
  const [nextKey, setNextKey] = useState(rows.length);
  const editing = initial !== undefined;

  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="kind" value={kind} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      {kind === 'SETTLEMENT' && advance ? <input type="hidden" name="advanceId" value={advance.id} /> : null}

      {kind === 'SETTLEMENT' && advance ? (
        <p className="form-note">
          Settling <strong>{advance.number}</strong> ({advance.projectName}). <strong>{formatMoney(advance.outstanding)}</strong> is still outstanding.
          Anything above that is paid back to you.
        </p>
      ) : null}

      <div className="form-grid">
        {kind !== 'SETTLEMENT' && !editing ? (
          <label className="field">Project
            <select name="projectId" required defaultValue="">
              <option value="" disabled>Choose a project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="field">Category
          <select name="categoryId" required defaultValue={initial?.categoryId ?? ''}>
            <option value="" disabled>Choose a category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">What is it for?
          <input name="purpose" required maxLength={500} defaultValue={initial?.purpose ?? ''} />
        </label>
        {kind === 'ADVANCE' ? (
          <label className="field">Amount (NPR)
            <input name="amount" inputMode="decimal" required defaultValue={initial?.requestedAmount ?? ''} placeholder="50,000.00" />
          </label>
        ) : null}
      </div>

      <label className="field">Remarks (optional)
        <textarea name="remarks" rows={3} maxLength={1000} defaultValue={initial?.remarks ?? ''} placeholder={kind === 'ADVANCE' ? 'Details on what the advance will cover' : 'Details on the expenses'} />
      </label>

      {kind !== 'ADVANCE' ? (
        <fieldset className="invoice-rows">
          <legend>Invoices</legend>
          {rows.map((row, index) => (
            <div className="form-grid" key={row.key}>
              <label className="field">Vendor<input name="invoiceVendor" defaultValue={row.vendor} maxLength={200} /></label>
              <label className="field">Invoice no. (optional)<input name="invoiceNumber" defaultValue={row.invoiceNumber ?? ''} maxLength={100} /></label>
              <label className="field">Date<input name="invoiceDate" type="date" defaultValue={row.invoiceDate.slice(0, 10)} /></label>
              <label className="field">Amount (NPR)<input name="invoiceAmount" inputMode="decimal" defaultValue={row.amount} /></label>
              <label className="field">VAT bill
                <select name="invoiceVat" defaultValue={row.vat ? 'yes' : 'no'}><option value="no">No</option><option value="yes">Yes — 13% included in the amount</option></select>
              </label>
              <label className="field">Supplier PAN/VAT no.<input name="invoiceTaxNo" defaultValue={row.supplierTaxNo ?? ''} maxLength={50} /></label>
              <input type="hidden" name="invoiceMediaId" value={row.mediaId ?? ''} />
              {rows.length > 1 ? (
                <button type="button" className="ghost-button" aria-label={`Remove invoice ${index + 1}`} onClick={() => setRows(rows.filter((r) => r.key !== row.key))}>Remove</button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="ghost-button"
            onClick={() => { setRows([...rows, { ...BLANK, key: nextKey }]); setNextKey(nextKey + 1); }}
          >
            + Add invoice
          </button>
          <p className="hint">Invoice photos are added from the field app; any already attached stay with their invoice.</p>
        </fieldset>
      ) : null}

      <FormError state={state} />
      <div className="form-actions">
        <button className="ghost-button" type="submit" name="intent" value="draft" disabled={pending}>{pending ? 'Working…' : 'Save draft'}</button>
        <button className="primary-button" type="submit" name="intent" value="submit" disabled={pending}>{pending ? 'Working…' : 'Submit for approval'}</button>
      </div>
    </form>
  );
}
