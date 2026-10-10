import 'server-only';
import type {
  CancelWorkOrderDto, CreateWorkOrdersDto, UpdateWorkOrderDto, WorkOrderEventKind, WorkOrderPage, WorkOrderProjectSummary, WorkOrderType,
} from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';
import type { TaskStatus } from './project-api';

/**
 * Work orders: QC checklists assigned to project sites. The QC service owns
 * them; the gateway's `/api/v1/work-orders` prefix reaches it. Response shapes
 * are written as the wire sees them, dates as ISO strings.
 */

export type WorkOrderStatus = TaskStatus;

/**
 * A work order as the list returns it, with its site and its project. The
 * project code is the work order's Project ID (the DU) — the same site code
 * exists in several projects, and only the project tells them apart. Both are
 * as they stood when the work order was raised.
 */
export interface WorkOrder {
  id: string; projectId: string; siteId: string;
  templateId: string; templateName: string; workOrderType: WorkOrderType;
  title: string; status: WorkOrderStatus; assigneeId: string;
  plannedCompletionAt: string; actualCompletionAt: string | null;
  currentSubmissionId: string | null; currentAttemptNo: number | null; cancelReason: string | null;
  createdBy: string; createdAt: string;
  site: { id: string; siteCode: string; name: string; city: string | null; area: string | null };
  project: { id: string; code: string; name: string };
}

export interface WorkOrderEvent {
  id: string; workOrderId: string; kind: WorkOrderEventKind; at: string; actorId: string | null;
  detail: Record<string, string | number | null>;
}

export type WorkOrderDetail = WorkOrder & { events: WorkOrderEvent[] };

/** One project's work orders in brief, for its dashboard. */
export interface WorkOrderBrief {
  id: string; siteId: string; siteCode: string; title: string; workOrderType: WorkOrderType;
  status: WorkOrderStatus; assigneeId: string; plannedCompletionAt: string;
}

export type WorkOrderView = 'open' | 'overdue' | 'closed';

export interface WorkOrderFilter {
  projectId?: string | undefined;
  status?: WorkOrderStatus | undefined;
  view?: WorkOrderView | undefined;
  workOrderType?: WorkOrderType | undefined;
  assigneeId?: string | undefined;
  q?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

/** The workspace queue: every project the caller can see, narrowed by the filter. */
export async function listWorkOrders(filter: WorkOrderFilter = {}): Promise<ApiResult<WorkOrderPage<WorkOrder>>> {
  return authFetch<WorkOrderPage<WorkOrder>>('/api/v1/work-orders', {
    query: {
      projectId: filter.projectId,
      status: filter.status,
      view: filter.view,
      workOrderType: filter.workOrderType,
      assigneeId: filter.assigneeId,
      q: filter.q,
      page: filter.page === undefined ? undefined : String(filter.page),
      limit: filter.limit === undefined ? undefined : String(filter.limit),
    },
  });
}

/** Every work order of one project the caller can see, in brief. */
export async function listProjectWorkOrders(projectId: string): Promise<ApiResult<WorkOrderBrief[]>> {
  return authFetch<WorkOrderBrief[]>(`/api/v1/work-orders/by-project/${projectId}`);
}

/** Per-project work order counts for the Director's portfolio. */
export async function getWorkOrderSummary(): Promise<ApiResult<WorkOrderProjectSummary[]>> {
  return authFetch<WorkOrderProjectSummary[]>('/api/v1/work-orders/summary');
}

export async function getWorkOrder(id: string): Promise<ApiResult<WorkOrderDetail>> {
  return authFetch<WorkOrderDetail>(`/api/v1/work-orders/${id}`);
}

/** One work order per site; the service checks the template and that the person can reach every site. */
export async function createWorkOrders(batch: CreateWorkOrdersDto): Promise<ApiResult<{ created: WorkOrder[] }>> {
  return authFetch<{ created: WorkOrder[] }>('/api/v1/work-orders', { method: 'POST', json: batch });
}

export async function updateWorkOrder(id: string, changes: UpdateWorkOrderDto): Promise<ApiResult<WorkOrderDetail>> {
  return authFetch<WorkOrderDetail>(`/api/v1/work-orders/${id}`, { method: 'PATCH', json: changes });
}

export async function cancelWorkOrder(id: string, body: CancelWorkOrderDto): Promise<ApiResult<WorkOrderDetail>> {
  return authFetch<WorkOrderDetail>(`/api/v1/work-orders/${id}/cancel`, { method: 'POST', json: body });
}
