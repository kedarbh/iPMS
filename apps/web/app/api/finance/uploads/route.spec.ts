import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadInvoicePhoto = vi.fn();
vi.mock('../../../lib/invoice-upload', () => ({ INVOICE_MAX_BYTES: 5 * 1024 * 1024, uploadInvoicePhoto }));

const { POST } = await import('./route');
const PROJECT = '0190a7a0-0000-7000-8000-0000000000a1';
const post = (form: FormData) => POST(new Request('http://web/api/finance/uploads', { method: 'POST', body: form }));
const formWith = (file: Blob | null, projectId = PROJECT) => {
  const form = new FormData();
  if (file) form.set('file', file, 'invoice.jpg');
  form.set('projectId', projectId);
  return form;
};
beforeEach(() => uploadInvoicePhoto.mockReset());

describe('POST /api/finance/uploads', () => {
  it('uploads the photo under the project and answers its id', async () => {
    uploadInvoicePhoto.mockResolvedValue({ ok: true, id: 'm-1', status: 'READY' });
    const response = await post(formWith(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'm-1', status: 'READY' });
    expect(uploadInvoicePhoto).toHaveBeenCalledWith(expect.any(Uint8Array), PROJECT);
  });

  it('asks for a project and a file before doing anything', async () => {
    expect((await post(formWith(new Blob(['x']), 'nope'))).status).toBe(400);
    expect((await post(formWith(null))).status).toBe(400);
    expect(uploadInvoicePhoto).not.toHaveBeenCalled();
  });

  it('passes a failure on with its status and message', async () => {
    uploadInvoicePhoto.mockResolvedValue({ ok: false, status: 415, message: 'Only JPEG photos can be attached.' });
    const response = await post(formWith(new Blob(['x'])));
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ message: 'Only JPEG photos can be attached.' });
  });
});
