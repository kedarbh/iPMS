import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { MediaStatus, RejectReason } from '@ipms/contracts';
import type { ApiResult } from './api-client';
import { completeFinanceUpload, financeUploadStatus, registerFinanceUpload } from './media-api';

/** media's limit for a photo (MEDIA_LIMITS.PHOTO). The browser re-encodes to stay under it. */
export const INVOICE_MAX_BYTES = 5 * 1024 * 1024;
/** Media checks the bytes in the background; a JPEG this size is usually done in a second or two. */
const VERIFY_WAIT_MS = 8_000;
const VERIFY_POLL_MS = 500;

export type InvoiceUpload =
  | { ok: true; id: string; status: MediaStatus }
  | { ok: false; status: number; message: string };

/**
 * A UUIDv7, which media's ids must be. Written out here because the web app
 * may only import types from the contracts barrel (see `lib/session.ts`).
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const isJpeg = (bytes: Uint8Array): boolean => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

const REJECTED: Record<RejectReason, string> = {
  HASH_MISMATCH: 'The photo was damaged on the way. Try again.',
  TYPE_MISMATCH: 'That file is not a JPEG photo.',
  SIZE_EXCEEDED: 'The photo is larger than 5 MB.',
  POSTER_MISSING: 'The server refused this photo.',
};

function failure(result: Exclude<ApiResult<unknown>, { state: 'ready' }>): InvoiceUpload {
  switch (result.state) {
    case 'unauthenticated': return { ok: false, status: 401, message: 'Your session ended. Sign in again.' };
    case 'forbidden': return { ok: false, status: 403, message: result.message };
    case 'unavailable': return { ok: false, status: result.status && result.status < 500 ? result.status : 503, message: result.message };
  }
}

/**
 * Files one invoice photo the way the phone does: register it under the
 * request's project with its size and SHA-256, PUT the bytes to the signed
 * link, complete, then wait briefly for media's check so the form can say
 * "attached" rather than "still checking". The browser has already turned
 * whatever was picked into a JPEG; it is checked again here, because media
 * would refuse anything else after the upload anyway.
 *
 * The PUT is made from this server rather than from the browser, so the
 * bucket needs no CORS rule for the web origin and the session token never
 * reaches the page.
 */
export async function uploadInvoicePhoto(bytes: Uint8Array, projectId: string, put: typeof fetch = fetch): Promise<InvoiceUpload> {
  if (!isJpeg(bytes)) return { ok: false, status: 415, message: 'Only JPEG photos can be attached.' };
  if (bytes.length > INVOICE_MAX_BYTES) return { ok: false, status: 413, message: 'The photo is larger than 5 MB.' };

  const id = uuidv7();
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const registered = await registerFinanceUpload({ id, projectId, sizeBytes: bytes.length, contentHash, deviceId: 'web' });
  if (registered.state !== 'ready') return failure(registered);

  const upload = registered.data.upload;
  if (upload) {
    if (upload.mode !== 'single') return { ok: false, status: 502, message: 'Storage asked for a multipart upload, which a photo never needs.' };
    let stored: Response;
    try {
      stored = await put(upload.signedUrl, { method: 'PUT', headers: upload.headers, body: Buffer.from(bytes) });
    } catch {
      return { ok: false, status: 503, message: 'File storage could not be reached.' };
    }
    if (!stored.ok) return { ok: false, status: 502, message: `File storage refused the photo (${stored.status}).` };
  }

  const completed = await completeFinanceUpload(id);
  if (completed.state !== 'ready') return failure(completed);

  let status: MediaStatus = completed.data.status;
  const deadline = Date.now() + VERIFY_WAIT_MS;
  while (status === 'VERIFYING' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, VERIFY_POLL_MS));
    const check = await financeUploadStatus(id);
    if (check.state !== 'ready') break;
    const item = check.data[0];
    if (!item || item.status === 'UNKNOWN') break;
    status = item.status;
    if (status === 'REJECTED') {
      return { ok: false, status: 422, message: item.rejectReason ? REJECTED[item.rejectReason] : 'The server refused this photo.' };
    }
  }
  return { ok: true, id, status };
}
