import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { Prisma, WorkOrder } from '@prisma-clients/qc';

/**
 * What a caller may read. `onlyAssignee` is set for a caller without
 * `task.view_all` — a field engineer — and narrows every read to the work
 * assigned to them, cancelled work excluded: their queue is their own work.
 */
export type WorkOrderScope = AuthzScope & { onlyAssignee?: string };

/** The scope filter plus, for a restricted caller, the own-work filter. ANDed by every read. */
export function reachWhere(scope: WorkOrderScope): Prisma.WorkOrderWhereInput[] {
  return [
    scopeWhere(scope),
    ...(scope.onlyAssignee ? [{ assigneeId: scope.onlyAssignee, status: { not: 'CANCELLED' } }] : []),
  ];
}

export type WorkOrderRow = WorkOrder;

export const OPEN = ['NOT_STARTED', 'ONGOING', 'REVIEWING', 'RECTIFYING'];
export const CLOSED = ['COMPLETED', 'CANCELLED'];

/**
 * A work order as the API returns it: with its site and project as nested
 * objects, the shape the queue has always rendered. The copies taken when it
 * was raised stand in for project's own records.
 */
export function toView(row: WorkOrderRow) {
  const { projectCode, projectName, siteCode, siteName, siteCity, siteArea, ...rest } = row;
  return {
    ...rest,
    site: { id: row.siteId, siteCode, name: siteName, city: siteCity, area: siteArea },
    project: { id: row.projectId, code: projectCode, name: projectName },
  };
}
