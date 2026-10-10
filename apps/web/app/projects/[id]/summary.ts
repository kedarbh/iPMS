import type { CurrentUser } from '../../lib/iam-api';
import type { ProjectDetail, Task, TaskStatus } from '../../lib/project-api';
import type { WorkOrderBrief } from '../../lib/work-order-api';
import type { WorkOrderType } from '../../quality/work-orders/labels';

/**
 * Everything the project landing pages show, derived from the project detail
 * and its work: the project's own planned tasks, and the work orders QC holds
 * for its sites. Pure, and given `now` rather than reading the clock, so the
 * rules are testable without rendering a page.
 *
 * Neither service has a summary endpoint of its own, so this is computed here
 * from the calls the page already makes.
 */

/**
 * One piece of work on a site, whichever service holds it. A planned task
 * carries a task type, which is what milestones count; a work order carries
 * its type of check instead.
 */
export interface Work {
  id: string; siteId: string; title: string; status: TaskStatus; assigneeId: string | null;
  plannedCompletionAt: string | null; taskTypeId: string | null; workOrderType: WorkOrderType | null;
}

export function workOf(tasks: readonly Task[], workOrders: readonly WorkOrderBrief[]): Work[] {
  return [
    ...tasks.map((task) => ({
      id: task.id, siteId: task.siteId, title: task.title, status: task.status, assigneeId: task.assigneeId,
      plannedCompletionAt: task.plannedCompletionAt, taskTypeId: task.taskTypeId, workOrderType: null,
    })),
    ...workOrders.map((order) => ({
      id: order.id, siteId: order.siteId, title: order.title, status: order.status, assigneeId: order.assigneeId,
      plannedCompletionAt: order.plannedCompletionAt, taskTypeId: null, workOrderType: order.workOrderType,
    })),
  ];
}

export type Tone = 'green' | 'amber' | 'slate' | 'red' | 'blue';

const CLOSED: ReadonlySet<TaskStatus> = new Set(['COMPLETED', 'CANCELLED']);
const DAY_MS = 86_400_000;

/**
 * Which landing a viewer gets on `/projects/[id]`.
 *
 * The overview is built around milestone progress, and `milestone.view` is the
 * grant that separates the people who oversee delivery (administrators,
 * project and QC managers, viewers) from the field role, which is not given it.
 * Everyone else lands on their own tasks.
 *
 * UX only, like every other permission check in this app: the gateway decides
 * what each call may return.
 */
export function landingFor(user: CurrentUser): 'overview' | 'tasks' {
  return user.isActive && user.permissions.includes('milestone.view') ? 'overview' : 'tasks';
}

export interface MilestoneProgress {
  id: string;
  name: string;
  percent: number;
  label: string;
  tone: Tone;
}

export interface AttentionItem {
  taskId: string;
  siteCode: string;
  title: string;
  detail: string;
  status: string;
  tone: Tone;
}

export interface Deadline {
  taskId: string;
  siteCode: string;
  title: string;
  due: string;
  day: string;
  inDays: number;
}

export interface RegionProgress { name: string; percent: number; sites: number }

export interface ProjectSummary {
  siteCount: number;
  sitesInDelivery: number;
  openTaskCount: number;
  taskCount: number;
  completedTaskCount: number;
  reviewingCount: number;
  rectifyingCount: number;
  /** Sites that satisfy every milestone with requirements; null when no milestone declares any. */
  sitesComplete: number | null;
  completion: number;
  milestones: MilestoneProgress[];
  attention: AttentionItem[];
  attentionTotal: number;
  deadlines: Deadline[];
  regions: RegionProgress[];
}

const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/**
 * A project's completion, as its page and the Director's portfolio both show
 * it: sites that met every milestone requirement when some milestone declares
 * requirements, otherwise completed work over live work.
 */
export function completionOf(units: { sitesComplete: number | null; sites: number; completed: number; live: number }): number {
  return units.sitesComplete === null ? percent(units.completed, units.live) : percent(units.sitesComplete, units.sites);
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function daysUntil(iso: string, now: Date): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY_MS);
}

function milestoneBadge(met: number, total: number, targetDate: string | null, now: Date): { label: string; tone: Tone } {
  if (total > 0 && met === total) return { label: 'Complete', tone: 'green' };
  if (targetDate && new Date(targetDate).getTime() < now.getTime()) return { label: 'Overdue', tone: 'amber' };
  if (met === 0) return { label: 'Not started', tone: 'slate' };
  return { label: 'In progress', tone: 'green' };
}

/** Why a task needs someone's attention, most urgent first; null when it does not. */
function attentionFor(task: Work, now: Date): { rank: number; status: string; detail: string; tone: Tone } | null {
  if (task.status === 'RECTIFYING') return { rank: 0, status: 'Action needed', detail: 'Returned from QC for rework', tone: 'red' };
  if (task.status === 'REVIEWING') return { rank: 1, status: 'Review', detail: 'Awaiting QC review', tone: 'blue' };
  if (CLOSED.has(task.status) || !task.plannedCompletionAt) return null;
  const inDays = daysUntil(task.plannedCompletionAt, now);
  if (inDays < 0) return { rank: 2, status: 'Overdue', detail: `Was due ${formatDay(task.plannedCompletionAt)}`, tone: 'amber' };
  if (inDays <= 2) return { rank: 3, status: 'Due soon', detail: inDays === 0 ? 'Due today' : `Due ${formatDay(task.plannedCompletionAt)}`, tone: 'amber' };
  return null;
}

export function summarizeProject(project: ProjectDetail, tasks: Work[], now: Date, limit = 5): ProjectSummary {
  const siteCode = new Map(project.sites.map((site) => [site.id, site.siteCode]));
  const live = tasks.filter((task) => task.status !== 'CANCELLED');
  const completed = live.filter((task) => task.status === 'COMPLETED');

  // Which task types each site has completed: the currency milestones are paid in.
  const done = new Map<string, Set<string>>();
  for (const task of completed) {
    // A work order has no task type, so it cannot count towards a milestone.
    if (task.taskTypeId === null) continue;
    const set = done.get(task.siteId) ?? new Set<string>();
    set.add(task.taskTypeId);
    done.set(task.siteId, set);
  }
  const meets = (siteId: string, taskTypeIds: string[]) => taskTypeIds.every((id) => done.get(siteId)?.has(id));

  const ordered = [...project.milestones].sort((a, b) => a.sequence - b.sequence);
  const milestones = ordered.map((milestone) => {
    const required = milestone.requirements.map((r) => r.taskTypeId);
    const met = required.length === 0 ? 0 : project.sites.filter((site) => meets(site.id, required)).length;
    return {
      id: milestone.id,
      name: milestone.name,
      percent: percent(met, project.sites.length),
      ...(required.length === 0
        ? { label: 'No requirements', tone: 'slate' as const }
        : milestoneBadge(met, project.sites.length, milestone.targetDate, now)),
    };
  });

  const measured = ordered.filter((milestone) => milestone.requirements.length > 0);
  const allRequired = [...new Set(measured.flatMap((m) => m.requirements.map((r) => r.taskTypeId)))];
  const sitesComplete = measured.length === 0 ? null : project.sites.filter((site) => meets(site.id, allRequired)).length;

  const flagged = live
    .map((task) => ({ task, why: attentionFor(task, now) }))
    .filter((entry): entry is { task: Work; why: NonNullable<ReturnType<typeof attentionFor>> } => entry.why !== null)
    .sort((a, b) => a.why.rank - b.why.rank || (a.task.plannedCompletionAt ?? '').localeCompare(b.task.plannedCompletionAt ?? ''));

  const deadlines = live
    .filter((task) => !CLOSED.has(task.status) && task.plannedCompletionAt && daysUntil(task.plannedCompletionAt, now) >= 0)
    .sort((a, b) => (a.plannedCompletionAt ?? '').localeCompare(b.plannedCompletionAt ?? ''))
    .slice(0, limit)
    .map((task) => ({
      taskId: task.id,
      siteCode: siteCode.get(task.siteId) ?? '—',
      title: task.title,
      due: formatDay(task.plannedCompletionAt as string),
      day: String(new Date(task.plannedCompletionAt as string).getUTCDate()),
      inDays: daysUntil(task.plannedCompletionAt as string, now),
    }));

  const regionOf = new Map(project.sites.map((site) => [site.id, site.region?.name ?? 'No region']));
  const regionNames = [...new Set(project.sites.map((site) => regionOf.get(site.id) as string))].sort();
  const regions = regionNames.map((name) => {
    const inRegion = live.filter((task) => regionOf.get(task.siteId) === name);
    return {
      name,
      sites: project.sites.filter((site) => regionOf.get(site.id) === name).length,
      percent: percent(inRegion.filter((task) => task.status === 'COMPLETED').length, inRegion.length),
    };
  });

  return {
    siteCount: project.sites.length,
    sitesInDelivery: project.sites.filter((site) => site.status === 'IN_DELIVERY').length,
    openTaskCount: live.length - completed.length,
    taskCount: live.length,
    completedTaskCount: completed.length,
    reviewingCount: live.filter((task) => task.status === 'REVIEWING').length,
    rectifyingCount: live.filter((task) => task.status === 'RECTIFYING').length,
    sitesComplete,
    completion: completionOf({ sitesComplete, sites: project.sites.length, completed: completed.length, live: live.length }),
    milestones,
    attention: flagged.slice(0, limit).map(({ task, why }) => ({
      taskId: task.id,
      siteCode: siteCode.get(task.siteId) ?? '—',
      title: task.title,
      detail: why.detail,
      status: why.status,
      tone: why.tone,
    })),
    attentionTotal: flagged.length,
    deadlines,
    regions,
  };
}

/** Work that needs the engineer first: rework, then what is in hand, then what is waiting on others. */
const WORK_ORDER: Record<TaskStatus, number> = {
  RECTIFYING: 0, ONGOING: 1, NOT_STARTED: 2, REVIEWING: 3, COMPLETED: 4, CANCELLED: 5,
};

export function myTasks<T extends Pick<Work, 'assigneeId' | 'status' | 'plannedCompletionAt'>>(tasks: T[], userId: string): T[] {
  return tasks
    .filter((task) => task.assigneeId === userId)
    .sort((a, b) => WORK_ORDER[a.status] - WORK_ORDER[b.status]
      // Undated work sorts after dated work within a status.
      || (a.plannedCompletionAt ?? '9999').localeCompare(b.plannedCompletionAt ?? '9999'));
}

export const STATUS_LABEL: Record<TaskStatus, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: 'Not started', tone: 'slate' },
  ONGOING: { label: 'Ongoing', tone: 'blue' },
  REVIEWING: { label: 'In review', tone: 'amber' },
  RECTIFYING: { label: 'Needs rework', tone: 'red' },
  COMPLETED: { label: 'Completed', tone: 'green' },
  CANCELLED: { label: 'Cancelled', tone: 'slate' },
};
