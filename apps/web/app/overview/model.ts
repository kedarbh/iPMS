import type { AuditEvent } from '../lib/audit-api';
import type { TaskStatus } from '../lib/project-api';

/** Pure rules behind the overview, kept free of the server so they can be tested. */

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

type Counts = Partial<Record<TaskStatus | 'ALL' | 'OVERDUE', number>>;

export const STATUS_SEGMENTS = [
  { status: 'COMPLETED', label: 'Approved', tone: 'green' },
  { status: 'REVIEWING', label: 'In QC review', tone: 'amber' },
  { status: 'RECTIFYING', label: 'Returned for rework', tone: 'red' },
  { status: 'ONGOING', label: 'In progress', tone: 'blue' },
  { status: 'NOT_STARTED', label: 'Not started', tone: 'slate' },
] as const;

/** Work orders by status, cancelled ones left out so the shares add to 100. */
export function statusBreakdown(counts: Counts) {
  const total = STATUS_SEGMENTS.reduce((sum, { status }) => sum + (counts[status] ?? 0), 0);
  return {
    total,
    segments: STATUS_SEGMENTS.map((segment) => {
      const count = counts[segment.status] ?? 0;
      return { ...segment, count, share: percent(count, total), width: total > 0 ? (count / total) * 100 : 0 };
    }),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today, 9:12" · "Yesterday, 17:30" · "30 Sep, 16:20" — in the viewer's local time. */
export function whenLabel(at: Date, now: Date): string {
  const time = `${at.getHours()}:${pad(at.getMinutes())}`;
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]}, ${time}`;
}

export type LogFilter = 'all' | 'approvals' | 'rework' | 'finance';
export const LOG_FILTERS: readonly { key: LogFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'rework', label: 'Rework' },
  { key: 'finance', label: 'Finance' },
];

export function parseLogFilter(value: string | undefined): LogFilter {
  return LOG_FILTERS.some(({ key }) => key === value) ? (value as LogFilter) : 'all';
}

export interface LogRow {
  key: string;
  at: Date;
  tag: string;
  tone: 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'slate';
  group: Exclude<LogFilter, 'all'> | 'other';
  text: string;
  actor: string;
  actorRole: string;
  ref: string;
}

const OBJECT_PREFIX: Record<string, string> = {
  WorkOrder: 'WO', Project: 'PRJ', Site: 'SITE', Task: 'TASK', TaskType: 'TYPE', QcTemplate: 'TPL', Role: 'ROLE', Media: 'MEDIA',
  FinanceRequest: 'FIN', ExpenseCategory: 'CAT', Payment: 'PAY',
};

const FINANCE_OBJECTS = new Set(['FinanceRequest', 'ExpenseCategory', 'Payment']);

const FINANCE_VERB_ROW: Record<string, Pick<LogRow, 'tag' | 'tone'>> = {
  created: { tag: 'Created', tone: 'blue' },
  submitted: { tag: 'Submitted', tone: 'blue' },
  approved: { tag: 'Approved', tone: 'green' },
  approved_by_pm: { tag: 'Approved', tone: 'green' },
  paid: { tag: 'Paid', tone: 'green' },
  settled: { tag: 'Settled', tone: 'green' },
  cash_returned: { tag: 'Returned', tone: 'green' },
  rejected: { tag: 'Rejected', tone: 'red' },
  cancelled: { tag: 'Cancelled', tone: 'red' },
  returned: { tag: 'Returned', tone: 'amber' },
};

const WORK_ORDER_STATUS_ROW: Partial<Record<string, Pick<LogRow, 'tag' | 'tone' | 'group'> & { text: string }>> = {
  COMPLETED: { tag: 'Approved', tone: 'green', group: 'approvals', text: 'Work order approved' },
  RECTIFYING: { tag: 'Rework', tone: 'amber', group: 'rework', text: 'Work order returned for rework' },
  REVIEWING: { tag: 'Submitted', tone: 'blue', group: 'other', text: 'Work order submitted for QC review' },
  ONGOING: { tag: 'Started', tone: 'slate', group: 'other', text: 'Work order started' },
};

/** "qc_template.published" → "QC template published". */
function sentence(action: string): string {
  const words = action.replace(/[._]/g, ' ').trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).replace(/^Qc /, 'QC ');
}

/** Reads a ledger entry the way a person would: what happened, to what, and by whom. */
export function auditRow(event: AuditEvent, actorName: string, actorRole: string): LogRow {
  const status = typeof event.newState.status === 'string' ? event.newState.status : undefined;
  const mapped = event.action === 'work_order.status_changed' && status ? WORK_ORDER_STATUS_ROW[status] : undefined;
  const base = { key: event.id, at: new Date(event.timestamp), actor: actorName, actorRole };
  const ref = `${OBJECT_PREFIX[event.objectType] ?? 'OBJ'}-${event.objectId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  if (mapped) return { ...base, ...mapped, ref };
  if (FINANCE_OBJECTS.has(event.objectType)) {
    // "finance.request.paid" → "Request paid"; the verb picks the tag.
    const rest = event.action.replace(/^finance\./, '');
    const verb = rest.split('.').pop() ?? '';
    const row = FINANCE_VERB_ROW[verb] ?? { tag: 'Updated', tone: 'slate' as const };
    return { ...base, ...row, group: 'finance', text: sentence(rest), ref };
  }
  if (event.action === 'work_order.cancelled') return { ...base, tag: 'Cancelled', tone: 'red', group: 'other', text: 'Work order cancelled', ref };
  if (event.action === 'media.rejected') return { ...base, tag: 'Rejected', tone: 'red', group: 'other', text: 'Evidence photo rejected', ref };
  if (event.action.endsWith('.created')) return { ...base, tag: 'Created', tone: 'blue', group: 'other', text: sentence(event.action), ref };
  if (event.action.startsWith('role.')) return { ...base, tag: 'Access', tone: 'purple', group: 'other', text: sentence(event.action), ref };
  return { ...base, tag: 'Updated', tone: 'slate', group: 'other', text: sentence(event.action), ref };
}

export function filterLog(rows: readonly LogRow[], filter: LogFilter): LogRow[] {
  return filter === 'all' ? [...rows] : rows.filter((row) => row.group === filter);
}

export function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function firstName(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? '';
}

/** "Friday, 2 October" */
export function dayLabel(now: Date): string {
  const weekday = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = now.toLocaleDateString('en-GB', { month: 'long' });
  return `${weekday}, ${now.getDate()} ${month}`;
}

/** The short reference a work order goes by on screen, e.g. WO-3F2A91. */
export function workOrderRef(id: string): string {
  return `WO-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export type HomeView = 'admin' | 'manager' | 'director' | 'qc' | 'finance' | 'engineer';

/**
 * Which home a signed-in person lands on. The most senior role wins, and
 * anyone without a role of their own (a custom role, say) gets the
 * organisation view, which only shows what their permissions already allow.
 */
export function homeFor(roles: readonly string[]): HomeView {
  if (roles.includes('SUPER_ADMIN')) return 'admin';
  if (roles.includes('PROJECT_MANAGER')) return 'manager';
  if (roles.includes('PROJECT_DIRECTOR')) return 'director';
  if (roles.includes('QC_MANAGER')) return 'qc';
  if (roles.includes('FINANCE')) return 'finance';
  if (roles.includes('FIELD_ENGINEER')) return 'engineer';
  return 'admin';
}
