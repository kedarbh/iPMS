import { NextResponse } from 'next/server';
import { INVOICE_MAX_BYTES, uploadInvoicePhoto } from '../../../lib/invoice-upload';

const NO_STORE = { 'cache-control': 'no-store' };
const fail = (message: string, status: number) => NextResponse.json({ message }, { status, headers: NO_STORE });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An invoice photo from the request form, as `multipart/form-data` with
 * `file` (a JPEG the page already re-encoded) and `projectId`. Answers
 * `{ id, status }`; the form keeps the id in the invoice row's `invoiceMediaId`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('Send the photo as a form upload.', 400);
  }
  const file = form.get('file');
  const projectId = String(form.get('projectId') ?? '').trim();
  if (!UUID.test(projectId)) return fail('Choose a project first.', 400);
  if (!(file instanceof Blob) || file.size === 0) return fail('Choose a photo.', 400);
  if (file.size > INVOICE_MAX_BYTES) return fail('The photo is larger than 5 MB.', 413);

  const result = await uploadInvoicePhoto(new Uint8Array(await file.arrayBuffer()), projectId);
  return result.ok
    ? NextResponse.json({ id: result.id, status: result.status }, { status: 201, headers: NO_STORE })
    : fail(result.message, result.status);
}
