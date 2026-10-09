import { z } from 'zod';

export const NOTIFICATION_TYPES = [
  'QC_SUBMISSION_SUBMITTED',
  'QC_SUBMISSION_APPROVED',
  'QC_SUBMISSION_REJECTED',
  'FINANCE_APPROVAL_NEEDED',
  'FINANCE_PAYMENT_DUE',
  'FINANCE_REQUEST_APPROVED',
  'FINANCE_REQUEST_RETURNED',
  'FINANCE_REQUEST_REJECTED',
  'FINANCE_REQUEST_CANCELLED',
  'FINANCE_REQUEST_PAID',
  'FINANCE_SETTLEMENT_SETTLED',
  'FINANCE_CASH_RETURNED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * `type` is a plain string, not `NotificationType`: the column is a varchar and
 * seeded or future rows carry types this slice does not emit.
 */
export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  workOrderId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationDto[];
  nextCursor: string | null;
}

export interface UnreadCount {
  count: number;
}

export const ListNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(200).optional(),
  unreadOnly: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

/**
 * Any UUID shape, not `UuidSchema`: that one demands v7, and ids in seeded
 * environments are not.
 */
export const NotificationIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Invalid id',
);

export const PUSH_PLATFORMS = ['ANDROID', 'IOS'] as const;

/** A device telling the service where to send pushes. The token is the push provider's own (FCM). */
export const RegisterPushTokenSchema = z.object({
  token: z.string().trim().min(20).max(500),
  platform: z.enum(PUSH_PLATFORMS),
}).strict();
export type RegisterPushTokenDto = z.infer<typeof RegisterPushTokenSchema>;

/** A device that no longer wants pushes (signed out, or push switched off). */
export const UnregisterPushTokenSchema = z.object({ token: z.string().trim().min(20).max(500) }).strict();
export type UnregisterPushTokenDto = z.infer<typeof UnregisterPushTokenSchema>;
