import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { SUMMARY_WEEKS, weeklyCounts, type PortfolioProject } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/project';
import { projectScope, siteScope } from '../scope/project-scope.js';

const OPEN = ['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING'];
const WEEK_MS = 7 * 86_400_000;

type Counted = { projectId: string; status: string; _count: { _all: number } };

function byStatus(rows: readonly Counted[], projectId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) if (row.projectId === projectId) counts[row.status] = row._count._all;
  return counts;
}

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

/**
 * Every ACTIVE or ON_HOLD project in scope, summarised for the Director's
 * portfolio. Completion follows the project page's rule (summarizeProject in
 * the web app): when a milestone declares requirements, a site is complete
 * once it has a completed task of every required type; otherwise the unit is
 * the task. Counts are grouped in SQL, so there is no cap on projects or tasks.
 */
export async function summarizePortfolio(prisma: PrismaClient, scope: AuthzScope, now = new Date()): Promise<PortfolioProject[]> {
  const projects = await prisma.project.findMany({
    where: { AND: [{ status: { in: ['ACTIVE', 'ON_HOLD'] } }, projectScope(scope) as Prisma.ProjectWhereInput] },
    select: { id: true, code: true, name: true, status: true, startDate: true, targetDate: true },
    orderBy: { code: 'asc' },
  });
  if (projects.length === 0) return [];

  const inProjects = { projectId: { in: projects.map((p) => p.id) } };
  const sitesWhere: Prisma.SiteWhereInput = { AND: [inProjects, siteScope(scope) as Prisma.SiteWhereInput] };
  const tasksWhere = (...more: Prisma.TaskWhereInput[]): Prisma.TaskWhereInput => ({ AND: [inProjects, scopeWhere(scope) as Prisma.TaskWhereInput, ...more] });
  const since = new Date(now.getTime() - SUMMARY_WEEKS * WEEK_MS);

  const [sites, siteCounts, taskCounts, overdue, milestones, done, recent] = await Promise.all([
    prisma.site.findMany({ where: sitesWhere, select: { id: true, projectId: true } }),
    prisma.site.groupBy({ by: ['projectId', 'status'], where: sitesWhere, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['projectId', 'status'], where: tasksWhere(), _count: { _all: true } }),
    prisma.task.groupBy({ by: ['projectId'], where: tasksWhere({ status: { in: OPEN } }, { plannedCompletionAt: { lt: now } }), _count: { _all: true } }),
    prisma.milestone.findMany({ where: inProjects, include: { requirements: { select: { taskTypeId: true } } }, orderBy: { sequence: 'asc' } }),
    prisma.task.groupBy({ by: ['siteId', 'taskTypeId'], where: tasksWhere({ status: 'COMPLETED' }), _max: { actualCompletionAt: true } }),
    prisma.task.findMany({ where: tasksWhere({ status: 'COMPLETED' }, { actualCompletionAt: { gte: since } }), select: { projectId: true, actualCompletionAt: true } }),
  ]);

  // Which task types each site has completed, and the latest day it completed each.
  const doneAt = new Map<string, Map<string, Date | null>>();
  for (const row of done) {
    const types = doneAt.get(row.siteId) ?? new Map<string, Date | null>();
    types.set(row.taskTypeId, row._max.actualCompletionAt);
    doneAt.set(row.siteId, types);
  }
  /** Whether a site has met every one of these task types, and the day it met the last of them. */
  const meets = (siteId: string, required: readonly string[]): { met: boolean; at: Date | null } => {
    const types = doneAt.get(siteId);
    let at: Date | null = null;
    for (const id of required) {
      if (!types?.has(id)) return { met: false, at: null };
      const day = types.get(id) ?? null;
      if (day && (!at || day > at)) at = day;
    }
    return { met: true, at };
  };

  return projects.map((project) => {
    const siteIds = sites.filter((s) => s.projectId === project.id).map((s) => s.id);
    const measured = milestones.filter((m) => m.projectId === project.id && m.requirements.length > 0);
    const tasks = byStatus(taskCounts, project.id);
    const live = Object.entries(tasks).reduce((total, [status, n]) => (status === 'CANCELLED' ? total : total + n), 0);

    let sitesComplete: number | null = null;
    let completions: Date[];
    if (measured.length > 0) {
      const required = [...new Set(measured.flatMap((m) => m.requirements.map((r) => r.taskTypeId)))];
      const met = siteIds.map((id) => meets(id, required)).filter((m) => m.met);
      sitesComplete = met.length;
      completions = met.flatMap((m) => (m.at ? [m.at] : []));
    } else {
      completions = recent.flatMap((t) => (t.projectId === project.id && t.actualCompletionAt ? [t.actualCompletionAt] : []));
    }

    const next = measured
      .map((milestone) => ({ milestone, met: siteIds.filter((id) => meets(id, milestone.requirements.map((r) => r.taskTypeId)).met).length }))
      .find(({ met }) => siteIds.length === 0 || met < siteIds.length);

    return {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status as PortfolioProject['status'],
      startDate: iso(project.startDate),
      targetDate: iso(project.targetDate),
      sites: { total: siteIds.length, byStatus: byStatus(siteCounts, project.id) },
      tasks: { live, completed: tasks['COMPLETED'] ?? 0, overdue: overdue.find((o) => o.projectId === project.id)?._count._all ?? 0, byStatus: tasks },
      sitesComplete,
      nextMilestone: next
        ? { name: next.milestone.name, targetDate: iso(next.milestone.targetDate), percent: siteIds.length === 0 ? 0 : Math.round((next.met / siteIds.length) * 100) }
        : null,
      completedByWeek: weeklyCounts(completions, now, SUMMARY_WEEKS),
    };
  });
}
