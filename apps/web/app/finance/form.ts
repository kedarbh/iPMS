import type { InvoiceInput } from '../lib/finance-api';

/** "1,50,000.5" -> "150000.50". Null for anything that is not a positive amount with at most two decimals. */
export function parseMoney(text: string | undefined): string | null {
  if (text === undefined) return null;
  const trimmed = text.trim();
  if (/\s/.test(trimmed) || /,,|^,|,\.|\.,/.test(trimmed)) return null;
  const cleaned = trimmed.replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  if (whole.replace(/^0+(?=\d)/, '').length > 12) return null;
  const normalised = `${whole.replace(/^0+(?=\d)/, '')}.${(fraction + '00').slice(0, 2)}`;
  return Number(normalised) > 0 ? normalised : null;
}

const field = (form: FormData, name: string): string[] => form.getAll(name).map((value) => String(value).trim());
/** A real calendar date in YYYY-MM-DD form, from 1900 on. */
const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Invoice rows arrive as aligned lists (one entry per row): vendor, number, date
 * and amount, with whether it is a VAT bill, the supplier's tax number and the
 * uploaded file's id riding along so an edit keeps what the phone attached. A
 * row left entirely blank is ignored, so the empty spare row a form shows is
 * harmless. A bill need not have a number.
 */
export function parseInvoices(form: FormData): { invoices: InvoiceInput[] } | { error: string } {
  const vendors = field(form, 'invoiceVendor');
  const numbers = field(form, 'invoiceNumber');
  const dates = field(form, 'invoiceDate');
  const amounts = field(form, 'invoiceAmount');
  const vats = field(form, 'invoiceVat');
  const taxNos = field(form, 'invoiceTaxNo');
  const mediaIds = field(form, 'invoiceMediaId');
  const invoices: InvoiceInput[] = [];

  const count = Math.max(vendors.length, numbers.length, dates.length, amounts.length);

  for (let i = 0; i < count; i += 1) {
    const [vendor = '', invoiceNumber = '', invoiceDate = '', rawAmount = ''] = [vendors[i], numbers[i], dates[i], amounts[i]];
    if (!vendor && !invoiceNumber && !invoiceDate && !rawAmount) continue;
    const row = `Invoice ${i + 1}`;
    if (!vendor || !invoiceDate || !rawAmount) return { error: `${row}: enter the vendor, date and amount.` };
    if (!validDate(invoiceDate)) return { error: `${row}: enter a valid date.` };
    const amount = parseMoney(rawAmount);
    if (amount === null) return { error: `${row}: enter an amount in NPR with at most two decimals.` };
    const vat = vats[i] === 'yes';
    const taxNo = taxNos[i] ?? '';
    const mediaId = mediaIds[i] ?? '';
    invoices.push({
      vendor,
      ...(invoiceNumber ? { invoiceNumber } : {}),
      invoiceDate,
      amount,
      ...(vat ? { vat: true } : {}),
      ...(vat && taxNo ? { supplierTaxNo: taxNo } : {}),
      ...(UUID.test(mediaId) ? { mediaId } : {}),
    });
  }
  return invoices.length === 0 ? { error: 'Add at least one invoice.' } : { invoices };
}
