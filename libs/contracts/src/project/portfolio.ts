/**
 * `GET /dashboard/portfolio` (project): one entry per ACTIVE or ON_HOLD
 * project in the caller's scope. Dates are ISO strings.
 */
export interface PortfolioProject {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'ON_HOLD';
  startDate: string | null;
  targetDate: string | null;
  sites: { total: number; byStatus: Record<string, number> };
  tasks: { live: number; completed: number; overdue: number; byStatus: Record<string, number> };
  /** Sites with a completed task of every type a milestone requires; null when no milestone declares requirements. */
  sitesComplete: number | null;
  /** The first milestone, by sequence, that some site has not yet met. */
  nextMilestone: { name: string; targetDate: string | null; percent: number } | null;
  /** Completed sites (when sitesComplete is not null) or completed tasks, per rolling week, oldest first. */
  completedByWeek: number[];
}
