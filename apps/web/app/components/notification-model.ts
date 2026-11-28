import type { NotificationDto } from '@ipms/contracts';

export type Category = 'work-order' | 'qc' | 'finance' | 'system';

export interface NotificationItem {
  id: string;
  category: Category;
  title: string;
  description: string;
  time: string;
  unread: boolean;
  href?: string;
}

export function categoryOf(type: string): Category {
  if (type.startsWith('QC_')) return 'qc';
  if (type.startsWith('WORK_ORDER_')) return 'work-order';
  if (type.startsWith('FINANCE_')) return 'finance';
  return 'system';
}

export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor(Math.max(0, now.getTime() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

export function toItem(dto: NotificationDto, now: Date): NotificationItem {
  return {
    id: dto.id,
    category: categoryOf(dto.type),
    title: dto.title,
    description: dto.body,
    time: relativeTime(dto.createdAt, now),
    unread: !dto.isRead,
    ...(dto.actionUrl === null ? {} : { href: dto.actionUrl }),
  };
}

export function markOneRead(items: NotificationItem[], id: string): NotificationItem[] {
  return items.map((item) => (item.id === id ? { ...item, unread: false } : item));
}

export function markIdsUnread(
  items: NotificationItem[],
  ids: ReadonlySet<string>,
): NotificationItem[] {
  return items.map((item) => (ids.has(item.id) ? { ...item, unread: true } : item));
}

export function markEveryRead(items: NotificationItem[]): NotificationItem[] {
  return items.map((item) => ({ ...item, unread: false }));
}
