import { describe, expect, it } from 'vitest';
import { parseInvoices, parseMoney } from './form';

const form = (rows: Array<[string, string, string, string]>) => {
  const data = new FormData();
  for (const [vendor, number, date, amount] of rows) {
    data.append('invoiceVendor', vendor); data.append('invoiceNumber', number);
    data.append('invoiceDate', date); data.append('invoiceAmount', amount);
  }
  return data;
};

describe('parseMoney', () => {
  it.each([
    ['1500', '1500.00'], ['1,50,000.5', '150000.50'], [' 40000.25 ', '40000.25'], ['0.5', '0.50'], ['7.', '7.00'],
    ['999999999999.99', '999999999999.99'], ['00.5', '0.50'],
  ])('reads %s as %s', (input, expected) => expect(parseMoney(input)).toBe(expected));

  it.each(['', '  ', 'abc', '-5', '0', '0.00', '1.234', '12e3', undefined, '1234567890123', '.5', '1,,5', '1 000', '1,2 3.4', ',5', '1,.5', '1.,5'])('refuses %s', (input) => expect(parseMoney(input as never)).toBeNull());
});

describe('parseInvoices', () => {
  it('reads aligned rows into invoices with normalised amounts', () => {
    expect(parseInvoices(form([['Himal Fuel', 'I-1', '2026-10-01', '1,500.5'], ['Sajha Hardware', 'I-2', '2026-10-02', '250']]))).toEqual({
      invoices: [
        { vendor: 'Himal Fuel', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '1500.50' },
        { vendor: 'Sajha Hardware', invoiceNumber: 'I-2', invoiceDate: '2026-10-02', amount: '250.00' },
      ],
    });
  });

  it('ignores a completely empty row and trims fields', () => {
    expect(parseInvoices(form([['  Himal Fuel ', ' I-1 ', '2026-10-01', '100'], ['', '', '', '']]))).toEqual({
      invoices: [{ vendor: 'Himal Fuel', invoiceNumber: 'I-1', invoiceDate: '2026-10-01', amount: '100.00' }],
    });
  });

  it('asks for at least one invoice', () => {
    expect(parseInvoices(form([['', '', '', '']]))).toEqual({ error: 'Add at least one invoice.' });
  });

  it('names the row and the problem when an invoice is incomplete or its amount is wrong', () => {
    expect(parseInvoices(form([['Himal Fuel', 'I-1', '', '100']]))).toEqual({ error: 'Invoice 1: enter the vendor, date and amount.' });
    expect(parseInvoices(form([['A', '1', '2026-10-01', '100'], ['B', '2', '2026-10-01', '1.234']]))).toEqual({ error: 'Invoice 2: enter an amount in NPR with at most two decimals.' });
    expect(parseInvoices(form([['A', '1', 'not-a-date', '100']]))).toEqual({ error: 'Invoice 1: enter a valid date.' });
  });

  it.each(['2026-02-31', '2026-04-31', '0000-01-01', '1899-12-31'])('refuses the impossible date %s', (date) => {
    expect(parseInvoices(form([['A', '1', date, '100']]))).toEqual({ error: 'Invoice 1: enter a valid date.' });
  });

  it('accepts a real leap day', () => {
    expect(parseInvoices(form([['A', '1', '2028-02-29', '100']]))).toEqual({ invoices: [{ vendor: 'A', invoiceNumber: '1', invoiceDate: '2028-02-29', amount: '100.00' }] });
  });

  it('does not drop the extra entries of a longer list', () => {
    const data = form([['A', '1', '2026-10-01', '100']]);
    data.append('invoiceAmount', '50');
    expect(parseInvoices(data)).toEqual({ error: 'Invoice 2: enter the vendor, date and amount.' });
  });
});

describe('parseInvoices: bills without a number, VAT bills and files', () => {
  const rows = (extra: Record<string, string[]>): FormData => {
    const data = new FormData();
    data.append('invoiceVendor', 'Himal Fuel'); data.append('invoiceNumber', ''); data.append('invoiceDate', '2026-10-01'); data.append('invoiceAmount', '100');
    for (const [name, values] of Object.entries(extra)) for (const v of values) data.append(name, v);
    return data;
  };

  it('takes a bill with no number', () => {
    expect(parseInvoices(rows({}))).toEqual({ invoices: [{ vendor: 'Himal Fuel', invoiceDate: '2026-10-01', amount: '100.00' }] });
  });

  it('keeps a VAT bill and its supplier number, and drops the number from a bill that is not VAT', () => {
    expect(parseInvoices(rows({ invoiceVat: ['yes'], invoiceTaxNo: ['301234567'] }))).toEqual({
      invoices: [{ vendor: 'Himal Fuel', invoiceDate: '2026-10-01', amount: '100.00', vat: true, supplierTaxNo: '301234567' }],
    });
    expect(parseInvoices(rows({ invoiceVat: ['no'], invoiceTaxNo: ['301234567'] }))).toEqual({
      invoices: [{ vendor: 'Himal Fuel', invoiceDate: '2026-10-01', amount: '100.00' }],
    });
  });

  it('carries an attached file through an edit, and ignores an id that is not one', () => {
    const id = '0192f7a0-0000-7000-8000-000000000003';
    expect(parseInvoices(rows({ invoiceMediaId: [id] }))).toMatchObject({ invoices: [{ mediaId: id }] });
    expect(parseInvoices(rows({ invoiceMediaId: ['not-an-id'] }))).toEqual({ invoices: [{ vendor: 'Himal Fuel', invoiceDate: '2026-10-01', amount: '100.00' }] });
  });
});
