import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('server-only', () => ({}));
const registerFinanceUpload = vi.fn();
const completeFinanceUpload = vi.fn();
const financeUploadStatus = vi.fn();
vi.mock('./media-api', () => ({ registerFinanceUpload, completeFinanceUpload, financeUploadStatus }));

const { uploadInvoicePhoto, uuidv7 } = await import('./invoice-upload');
const PROJECT = '0190a7a0-0000-7000-8000-0000000000a1';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const signed = { mode: 'single', signedUrl: 'https://bucket/put', headers: { 'content-type': 'image/jpeg', 'x-amz-checksum-sha256': 'abc' }, expiresAt: '' };

beforeEach(() => {
  vi.clearAllMocks();
  registerFinanceUpload.mockImplementation(async (body: { id: string }) => ({ state: 'ready', data: { id: body.id, status: 'PENDING', upload: signed, posterUpload: null } }));
  completeFinanceUpload.mockResolvedValue({ state: 'ready', data: { status: 'READY' } });
});

describe('uuidv7', () => {
  it('is a version 7 id that media accepts', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('uploadInvoicePhoto', () => {
  it('registers with the size and SHA-256, PUTs to the signed link with its headers, then completes', async () => {
    const put = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const result = await uploadInvoicePhoto(JPEG, PROJECT, put);
    expect(result).toMatchObject({ ok: true, status: 'READY' });
    const body = registerFinanceUpload.mock.calls[0]![0];
    expect(body).toMatchObject({ projectId: PROJECT, sizeBytes: JPEG.length, contentHash: createHash('sha256').update(JPEG).digest('hex'), deviceId: 'web' });
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(put).toHaveBeenCalledWith('https://bucket/put', expect.objectContaining({ method: 'PUT', headers: signed.headers }));
    expect(completeFinanceUpload).toHaveBeenCalledWith(body.id);
    expect(result.ok && result.id).toBe(body.id);
  });

  it('refuses anything that is not a JPEG before asking media', async () => {
    const result = await uploadInvoicePhoto(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), PROJECT, vi.fn());
    expect(result).toMatchObject({ ok: false, status: 415 });
    expect(registerFinanceUpload).not.toHaveBeenCalled();
  });

  it('passes a refusal from media on', async () => {
    registerFinanceUpload.mockResolvedValue({ state: 'forbidden', message: 'You do not have access to this project' });
    expect(await uploadInvoicePhoto(JPEG, PROJECT, vi.fn())).toEqual({ ok: false, status: 403, message: 'You do not have access to this project' });
  });

  it('says so when storage refuses the bytes, and does not complete', async () => {
    const result = await uploadInvoicePhoto(JPEG, PROJECT, vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(completeFinanceUpload).not.toHaveBeenCalled();
  });

  it('waits for the check and reports a rejected photo', async () => {
    completeFinanceUpload.mockResolvedValue({ state: 'ready', data: { status: 'VERIFYING' } });
    financeUploadStatus.mockResolvedValue({ state: 'ready', data: [{ id: 'x', status: 'REJECTED', rejectReason: 'TYPE_MISMATCH' }] });
    const result = await uploadInvoicePhoto(JPEG, PROJECT, vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    expect(result).toEqual({ ok: false, status: 422, message: 'That file is not a JPEG photo.' });
  });
});
