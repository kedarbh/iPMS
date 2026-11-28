import 'server-only';
import type { MediaStatus, MediaView, RegisterUploadResponse, SignedGet, UploadStatusItem } from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

export type MediaVariant = 'original' | 'thumbnail';

/** Every file on a work order the caller's scope reaches, with capture facts. Thumbnail links inside expire; the page uses `/api/media/…` instead. */
export function listWorkOrderMedia(workOrderId: string): Promise<ApiResult<MediaView[]>> {
  return authFetch<MediaView[]>('/api/v1/media', { query: { workOrderId } });
}

/** A 5-minute link to one file; `download` signs it as an attachment so the browser saves it under its readable name. Never rendered into a page: see `app/api/media/[id]/[variant]/route.ts`. */
export function mediaUrl(id: string, variant: MediaVariant, download = false): Promise<ApiResult<SignedGet>> {
  return authFetch<SignedGet>(`/api/v1/media/${encodeURIComponent(id)}/url`, { query: download ? { variant, download: '1' } : { variant } });
}

/** An invoice file of a finance request: a 5-minute link, signed only for its uploader or someone who can see all the project's finance requests. */
export function financeFileUrl(id: string, variant: MediaVariant): Promise<ApiResult<SignedGet>> {
  return authFetch<SignedGet>(`/api/v1/media/finance/${encodeURIComponent(id)}/url`, { query: { variant } });
}

/** Announces an invoice photo under `projectId`; the answer carries the signed PUT for its bytes. */
export function registerFinanceUpload(body: {
  id: string; projectId: string; sizeBytes: number; contentHash: string; deviceId: string;
}): Promise<ApiResult<RegisterUploadResponse>> {
  return authFetch<RegisterUploadResponse>('/api/v1/media/finance/uploads', { method: 'POST', json: { ...body, kind: 'PHOTO', contentType: 'image/jpeg' } });
}

/** Tells media the bytes are in storage; it then checks them in the background. */
export function completeFinanceUpload(id: string): Promise<ApiResult<{ id: string; status: MediaStatus }>> {
  return authFetch(`/api/v1/media/finance/uploads/${encodeURIComponent(id)}/complete`, { method: 'POST', json: {} });
}

export function financeUploadStatus(id: string): Promise<ApiResult<UploadStatusItem[]>> {
  return authFetch<UploadStatusItem[]>('/api/v1/media/finance/uploads/status', { method: 'POST', json: { ids: [id] } });
}
