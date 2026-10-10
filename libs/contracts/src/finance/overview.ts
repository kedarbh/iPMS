import type { RequestKind } from './finance.js';

/** A warning on a request waiting for an approver. The web phrases it; amounts are two-decimal strings. */
export type RequestFlag =
  | { code: 'DUPLICATE_BILL'; tone: 'red'; matches: { requestId: string; number: string; vendor: string; invoiceNumber: string | null }[] }
  | { code: 'REQUESTER_HOLDS_CASH'; tone: 'red' | 'amber'; outstanding: string; advances: number; overdue: number; oldestOverdueDays: number | null }
  | { code: 'UNUSUAL_AMOUNT'; tone: 'amber'; ratio: number; median: string; category: string }
  | { code: 'WAITING_LONG'; tone: 'amber'; days: number };

/** "Before you decide": sent with a request's detail only to the approver at its current step. */
export interface DecisionContext {
  requester: { openAdvances: number; outstanding: string; overdue: number; oldestOverdueDays: number | null };
  category: { median: string; p25: string; p75: string; samples: number } | null;
  project: { thisMonth: string; average3: string };
  flags: RequestFlag[];
}

export type PendingStatus = 'PENDING_PM' | 'PENDING_DIRECTOR' | 'PENDING_FINANCE';

export interface PipelineStep { status: PendingStatus; count: number; amount: string; oldestSince: string | null; mine: boolean }

export interface OverviewQueueItem {
  id: string; number: string; kind: RequestKind; status: PendingStatus;
  projectId: string; projectCode: string; projectName: string;
  requesterId: string; purpose: string; category: string;
  amount: string; waitingSince: string; flags: RequestFlag[];
}

export interface ProjectMoney {
  projectId: string; code: string; name: string;
  spentToDate: string;
  /** One amount per entry of FinanceOverview.months. */
  spentByMonth: string[];
  cashHeld: string;
  overdueSettlements: { count: number; amount: string };
}

/** `GET /finance/overview`: money in the caller's project scope. */
export interface FinanceOverview {
  /** The six months spentByMonth covers, `YYYY-MM`, oldest first; the last is the current month in Kathmandu. */
  months: string[];
  pipeline: { steps: PipelineStep[]; paidThisMonth: { count: number; amount: string } };
  queue: OverviewQueueItem[];
  projects: ProjectMoney[];
  categories: { categoryId: string; name: string; amount: string }[];
  cashHolders: { requesterId: string; outstanding: string; open: number; overdue: number }[];
  decisions: {
    approved: { count: number; amount: string };
    trimmed: { count: number; saved: string };
    returned: number;
    rejected: number;
    medianHoursToDecide: number | null;
  };
}
