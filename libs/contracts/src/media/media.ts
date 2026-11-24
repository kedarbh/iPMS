import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';

export const MIB = 1024 * 1024;

/** Most files one work-order submission can carry; media's check and attach take at most this many ids per call. */
export const MAX_MEDIA_PER_SUBMISSION = 1500;

export type MediaKind = 'PHOTO' | 'VIDEO' | 'DOCUMENT';
export type MediaCategory = 'EVIDENCE' | 'GALLERY' | 'TEMPLATE_DOCUMENT' | 'FINANCE_DOCUMENT';
export type MediaStatus =
  | 'PENDING' | 'VERIFYING' | 'READY' | 'ATTACHED' | 'REJECTED' | 'DISCARDED' | 'PURGE_SCHEDULED' | 'PURGED';
export type RejectReason = 'HASH_MISMATCH' | 'SIZE_EXCEEDED' | 'TYPE_MISMATCH' | 'POSTER_MISSING';

/**
 * What the server accepts. The phone compresses before hashing (photos to
 * 2560 px / q80, videos to 720p H.264), so these are ceilings, not targets.
 */
export const MEDIA_LIMITS: Record<MediaKind, { contentTypes: readonly string[]; maxBytes: number }> = {
  PHOTO: { contentTypes: ['image/jpeg'], maxBytes: 5 * MIB },
  VIDEO: { contentTypes: ['video/mp4'], maxBytes: 100 * MIB },
  DOCUMENT: {
    contentTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/vnd.dwg', 'image/vnd.dxf', 'image/png', 'image/jpeg',
    ],
    maxBytes: 20 * MIB,
  },
};

/** Videos above this go up in parts, so a dropped connection resumes instead of restarting. */
export const MULTIPART_THRESHOLD_BYTES = 10 * MIB;
/** R2's minimum part size (every part but the last). */
export const PART_SIZE_BYTES = 5 * MIB;

export function partCountFor(sizeBytes: number): number {
  return Math.ceil(sizeBytes / PART_SIZE_BYTES);
}

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Expected a lower-case hex SHA-256');

/**
 * A phone announcing one captured file. The id and hash are fixed at capture,
 * so every retry describes the same object. Project and site are not sent:
 * the server reads them from the work order, so a client cannot misfile.
 */
export const RegisterUploadSchema = z.object({
  id: UuidSchema,
  category: z.literal('EVIDENCE'),
  workOrderId: UuidSchema,
  checklistItemId: UuidSchema,
  kind: z.enum(['PHOTO', 'VIDEO']),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  contentHash: Sha256HexSchema,
  capturedAt: z.coerce.date(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  deviceId: z.string().trim().min(1).max(255),
}).strip();
export type RegisterUploadDto = z.infer<typeof RegisterUploadSchema>;

/**
 * An invoice photo for a finance request. Filed under a project, not a site or
 * work order: an invoice belongs to the money, not to the tower.
 */
export const RegisterFinanceDocumentSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  kind: z.literal('PHOTO'),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  contentHash: Sha256HexSchema,
  capturedAt: z.coerce.date().optional(),
  deviceId: z.string().trim().min(1).max(255),
}).strip();
export type RegisterFinanceDocumentDto = z.infer<typeof RegisterFinanceDocumentSchema>;

/** finance's submit-time checks on its invoice files, mirroring the evidence ones. */
export const FinanceAttachRequestSchema = z.object({
  requestId: UuidSchema,
  projectId: UuidSchema,
  mediaIds: z.array(UuidSchema).min(1).max(100),
}).strip();
export type FinanceAttachRequestDto = z.infer<typeof FinanceAttachRequestSchema>;

export const UploadStatusRequestSchema = z.object({ ids: z.array(UuidSchema).min(1).max(200) }).strip();

export const PartsRequestSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
}).strip();

export const CompleteUploadSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) })).max(10_000).optional(),
}).strip();
export type CompleteUploadDto = z.infer<typeof CompleteUploadSchema>;

export const AttachRequestSchema = z.object({
  submissionId: UuidSchema,
  workOrderId: UuidSchema,
  siteId: UuidSchema,
  mediaIds: z.array(UuidSchema).min(1).max(MAX_MEDIA_PER_SUBMISSION),
}).strip();
export type AttachRequestDto = z.infer<typeof AttachRequestSchema>;

export const MediaCheckRequestSchema = z.object({
  workOrderId: UuidSchema,
  siteId: UuidSchema,
  mediaIds: z.array(UuidSchema).min(1).max(MAX_MEDIA_PER_SUBMISSION),
}).strip();
export type MediaCheckRequestDto = z.infer<typeof MediaCheckRequestSchema>;
export type MediaCheckReason = 'UPLOADING' | 'VERIFYING' | 'REJECTED' | 'NOT_FOUND' | 'WRONG_WORK_ORDER';
/** One per distinct requested id. `kind` is null when the file is missing or belongs elsewhere. */
export interface MediaCheckResult { id: string; kind: MediaKind | null; usable: boolean; reason?: MediaCheckReason }

export const ViewUrlQuerySchema = z.object({
  variant: z.enum(['original', 'thumbnail']).default('original'),
  /** Query-string boolean: sign an `attachment` link so the browser saves the file under its readable name. */
  download: z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true'),
}).strip();
export const ListMediaQuerySchema = z.object({ workOrderId: UuidSchema }).strip();

export interface SignedPut { signedUrl: string; headers: Record<string, string>; expiresAt: string }
export interface SignedGet { signedUrl: string; expiresAt: string }

export type UploadInstructions =
  | ({ mode: 'single' } & SignedPut)
  | { mode: 'multipart'; uploadId: string; partSize: number; partCount: number; parts: { partNumber: number; signedUrl: string }[]; expiresAt: string };

export interface RegisterUploadResponse {
  id: string;
  status: MediaStatus;
  /** Null once the file is past PENDING: there is nothing left to send. */
  upload: UploadInstructions | null;
  /** Videos only: where the phone-made poster frame goes. */
  posterUpload: SignedPut | null;
}

export interface UploadStatusItem {
  id: string;
  status: MediaStatus | 'UNKNOWN';
  rejectReason?: RejectReason;
  /** PENDING multipart uploads only: parts R2 already holds. */
  completedParts?: number[];
}

export interface PartUrls { parts: { partNumber: number; signedUrl: string }[]; expiresAt: string }

export interface MediaView {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  workOrderId: string | null;
  checklistItemId: string | null;
  contentHash: string;
  sizeBytes: number;
  capturedAt: string | null;
  receivedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceFromSiteM: number | null;
  uploadedBy: string;
  /** Named so the logger's redact-by-key-name rule catches it, like every other signed-URL field. */
  thumbnail: { signedUrl: string } | null;
}

export interface AttachedMedia {
  id: string;
  kind: MediaKind;
  contentHash: string;
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceFromSiteM: number | null;
}
