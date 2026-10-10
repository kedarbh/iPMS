/** `GET /work-orders/summary` (qc): one entry per project the caller can see work orders in. */
export interface WorkOrderProjectSummary {
  projectId: string;
  byStatus: Record<string, number>;
  /** Open work orders past their planned completion. */
  overdue: number;
  /** Approved in the last 90 days, and how many of those were never rejected. */
  approved90: number;
  firstTime90: number;
  reviewing: { count: number; oldestSubmittedAt: string | null };
  /** Completed per rolling week, oldest first. */
  completedByWeek: number[];
}
