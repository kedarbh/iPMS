# Project Director Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Project Director a web home that shows what waits on them, how every project in their scope is doing (schedule, quality, money), where money goes and what they decided, and complete their finance pipeline with flags, decision context, a Decided by me tab and approve-then-next.

**Architecture:** Each service that owns the data gains one summary read: project `GET /dashboard/portfolio`, qc `GET /work-orders/summary`, finance `GET /finance/overview` (plus flags on awaiting rows and a `context` block on request detail). The web composes the three in a new `DirectorOverview` server component, and a pure `director-model.ts` applies the health rules. No migrations, no new permissions, no gateway changes.

**Tech Stack:** NestJS 12 + Prisma 7 (Postgres 17) services, Vitest with Testcontainers for integration specs, Next.js 16 server components and server actions, `@ipms/contracts` for shared types.

**Spec:** `docs/superpowers/specs/2026-10-10-project-director-dashboard-design.md`

## Global Constraints

- Branch: `kedar/director-dashboard`. Commit after every task, messages in the repo's `type(scope): summary` style, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `@ipms/contracts` is loaded from its built `dist` at runtime (services and their tests). After changing anything in `libs/contracts`, run `pnpm --filter @ipms/contracts build` before running a service's tests.
- TypeScript runs with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. An optional prop that may receive `undefined` must be typed `?: T | undefined`.
- Money is a two-decimal string on the wire (`"1500.00"`). Finance arithmetic goes through `toMinor`/`fromMinor`/`sumMoney` in `apps/finance/src/money.ts`; never add floats in the service.
- Days, months and "today" are in Asia/Kathmandu (UTC+5:45, no DST). Week buckets are rolling seven-day windows ending at request time, oldest first; the last four are the 28 days pace uses.
- Every read filters by the caller's scope in the service that owns the data, using that service's existing helpers (`projectScope`/`siteScope`/`scopeWhere` in project, `reachWhere` in qc, `scopeWhere(scope, { project: 'projectId', site: null })` in finance). Out of scope is absent, never an error.
- Web imports from `@ipms/contracts` are `import type` only (the barrel pulls `node:crypto` and zod).
- Integration specs start their own Postgres container; Docker must be running.
- Thresholds live as named constants: web in `apps/web/app/overview/director-model.ts`, finance in `apps/finance/src/queries/flags.ts` and `norms.ts`.

## File Map

| File | Responsibility |
|---|---|
| `libs/contracts/src/common/calendar.ts` | Kathmandu day/month, recent months, rolling weekly counts, `SUMMARY_WEEKS` |
| `libs/contracts/src/project/portfolio.ts` | `PortfolioProject` wire type |
| `libs/contracts/src/qc/work-order-summary.ts` | `WorkOrderProjectSummary` wire type |
| `libs/contracts/src/finance/overview.ts` | `RequestFlag`, `DecisionContext`, `FinanceOverview` wire types |
| `apps/project/src/project/portfolio.ts` | `summarizePortfolio`: grouped counts, milestone completion, weekly completions |
| `apps/qc/src/work-orders/view.ts` | gains `WorkOrderScope` and `reachWhere` (moved from the service) |
| `apps/qc/src/work-orders/work-order-summary.ts` | `summarizeWorkOrders` |
| `apps/finance/src/queries/advances.ts` | `loadOpenAdvances`: outstanding, due day, overdue |
| `apps/finance/src/queries/norms.ts` | `categoryNorms`, `normOf`, `quantile` |
| `apps/finance/src/queries/flags.ts` | `requestFlags`, `standingOf` |
| `apps/finance/src/queries/spend.ts` | `loadClosed`, `spendByMonth` |
| `apps/finance/src/queries/overview.service.ts` | `OverviewService` |
| `apps/finance/src/http/overview.controller.ts` | `GET /finance/overview` |
| `apps/finance/src/queries/context.ts` | `decisionContext` for request detail |
| `apps/web/app/overview/director-model.ts` | pure health rules, headline, money formatting |
| `apps/web/app/overview/director-panels.tsx` | presentational panels of the Director home |
| `apps/web/app/overview/director-overview.tsx` | data loading for the Director home |
| `apps/web/app/overview/director.css` | `dr-` styles |
| `apps/web/app/finance/decided.tsx` | `DecidedNotice` confirmation line |
| `apps/web/app/finance/requests/[id]/context-panel.tsx` | "Before you decide" panel |
| `e2e/director-finance.e2e.spec.ts` | end-to-end Director flow through the gateway |

---

### Task 1: Shared calendar helpers and wire types

**Files:**
- Create: `libs/contracts/src/common/calendar.ts`
- Create: `libs/contracts/src/common/calendar.spec.ts`
- Create: `libs/contracts/src/project/portfolio.ts`
- Create: `libs/contracts/src/qc/work-order-summary.ts`
- Create: `libs/contracts/src/finance/overview.ts`
- Modify: `libs/contracts/src/index.ts`

**Interfaces:**
- Produces: `kathmanduDay(at: Date): string`, `kathmanduMonth(at: Date): string`, `recentMonths(now: Date, count: number): string[]`, `weeklyCounts(instants: readonly Date[], now: Date, weeks: number): number[]`, `SUMMARY_WEEKS = 8`; types `PortfolioProject`, `WorkOrderProjectSummary`, `RequestFlag`, `DecisionContext`, `PendingStatus`, `PipelineStep`, `OverviewQueueItem`, `ProjectMoney`, `FinanceOverview`.

- [ ] **Step 1: Write the failing test**

Create `libs/contracts/src/common/calendar.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { kathmanduDay, kathmanduMonth, recentMonths, weeklyCounts } from './calendar.js';

describe('kathmanduDay', () => {
  it('turns the day over at midnight Kathmandu time, 18:15 UTC', () => {
    expect(kathmanduDay(new Date('2026-09-30T18:14:59Z'))).toBe('2026-09-30');
    expect(kathmanduDay(new Date('2026-09-30T18:15:00Z'))).toBe('2026-10-01');
  });
});

describe('kathmanduMonth', () => {
  it('reads the month in Kathmandu, not UTC', () => {
    expect(kathmanduMonth(new Date('2026-09-30T19:00:00Z'))).toBe('2026-10');
    expect(kathmanduMonth(new Date('2026-09-30T18:00:00Z'))).toBe('2026-09');
  });
});

describe('recentMonths', () => {
  it('lists the months ending with the current one, oldest first, across a year end', () => {
    expect(recentMonths(new Date('2026-02-10T06:00:00Z'), 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('weeklyCounts', () => {
  const now = new Date('2026-10-10T06:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

  it('counts into rolling seven-day windows ending now, oldest first', () => {
    expect(weeklyCounts([ago(1), ago(6.9), ago(7.1), ago(20)], now, 4)).toEqual([0, 1, 1, 2]);
  });

  it('leaves out instants older than the first window or after now', () => {
    expect(weeklyCounts([ago(28.5), ago(-1)], now, 4)).toEqual([0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ipms/contracts exec vitest run src/common/calendar.spec.ts`
Expected: FAIL, `Failed to resolve import "./calendar.js"`.

- [ ] **Step 3: Write the helpers and the wire types**

Create `libs/contracts/src/common/calendar.ts`:

```ts
/** Nepal keeps one offset all year, UTC+5:45, so a fixed shift is exact. */
export const KATHMANDU_OFFSET_MINUTES = 345;

/** Rolling seven-day windows the portfolio and work-order summaries count completions in; the last four are the 28 days pace uses. */
export const SUMMARY_WEEKS = 8;

const WEEK_MS = 7 * 86_400_000;

/** The calendar day in Kathmandu at this instant, as `YYYY-MM-DD`. */
export function kathmanduDay(at: Date): string {
  return new Date(at.getTime() + KATHMANDU_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** The calendar month in Kathmandu at this instant, as `YYYY-MM`. */
export function kathmanduMonth(at: Date): string {
  return kathmanduDay(at).slice(0, 7);
}

/** The `count` months ending with the one `now` falls in (in Kathmandu), oldest first, as `YYYY-MM`. */
export function recentMonths(now: Date, count: number): string[] {
  const [year, month] = kathmanduMonth(now).split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1)).toISOString().slice(0, 7));
}

/**
 * Counts instants into rolling seven-day windows ending at `now`, oldest
 * first: the last window is the seven days up to `now`. Rolling rather than
 * calendar weeks, so the last four windows are exactly the last 28 days.
 * Instants after `now` or older than the first window are left out.
 */
export function weeklyCounts(instants: readonly Date[], now: Date, weeks: number): number[] {
  const counts = new Array<number>(weeks).fill(0);
  for (const at of instants) {
    const age = now.getTime() - at.getTime();
    if (age < 0) continue;
    const index = weeks - 1 - Math.floor(age / WEEK_MS);
    if (index >= 0) counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}
```

Create `libs/contracts/src/project/portfolio.ts`:

```ts
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
```

Create `libs/contracts/src/qc/work-order-summary.ts`:

```ts
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
```

Create `libs/contracts/src/finance/overview.ts`:

```ts
import type { RequestKind } from './finance.js';

/** A warning on a request waiting for an approver. The web phrases it; amounts are two-decimal strings. */
export type RequestFlag =
  | { code: 'DUPLICATE_BILL'; tone: 'red'; matches: { requestId: string; number: string }[] }
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
```

In `libs/contracts/src/index.ts`, add after `export * from './common/pagination.js';`:

```ts
export * from './common/calendar.js';
```

and add at the end of the file:

```ts
export * from './project/portfolio.js';
export * from './qc/work-order-summary.js';
export * from './finance/overview.js';
```

- [ ] **Step 4: Run the test, typecheck and build**

Run: `pnpm --filter @ipms/contracts exec vitest run src/common/calendar.spec.ts`
Expected: PASS, 5 tests.

Run: `pnpm --filter @ipms/contracts typecheck && pnpm --filter @ipms/contracts build`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add libs/contracts/src
git commit -m "feat(contracts): Kathmandu calendar helpers and Director dashboard wire types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: project — `GET /dashboard/portfolio`

**Files:**
- Create: `apps/project/src/project/portfolio.ts`
- Create: `apps/project/prisma/portfolio.integration.spec.ts`
- Modify: `apps/project/src/project/project.service.ts`
- Modify: `apps/project/src/project/project.controller.ts:13`
- Modify: `apps/project/src/project/project.controller.spec.ts`

**Interfaces:**
- Consumes: `SUMMARY_WEEKS`, `weeklyCounts`, `PortfolioProject` (Task 1); `projectScope`, `siteScope` from `apps/project/src/scope/project-scope.ts`.
- Produces: `summarizePortfolio(prisma: PrismaClient, scope: AuthzScope, now?: Date): Promise<PortfolioProject[]>`; `ProjectService.portfolio(scope)`; route `GET /dashboard/portfolio` (gateway `/api/v1/dashboard/portfolio`) requiring `project.view`.

- [ ] **Step 1: Write the failing integration test**

Create `apps/project/prisma/portfolio.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/project';
import type { AuthzScope } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { summarizePortfolio } from '../src/project/portfolio.js';
import { startTestDb } from './test-db.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
const NOW = new Date('2026-10-10T06:00:00Z');
const ACTOR = '01a0d000-0000-7000-8000-00000000ac70';
const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => {
  await prisma.task.deleteMany({});
  await prisma.milestoneRequirement.deleteMany({});
  await prisma.milestone.deleteMany({});
  await prisma.taskType.deleteMany({});
  await prisma.site.deleteMany({});
  await prisma.project.deleteMany({});
});

async function aProject(code: string, status = 'ACTIVE'): Promise<string> {
  const id = uuidv7();
  await prisma.project.create({ data: { id, code, name: `Project ${code}`, status, startDate: new Date('2026-01-01'), targetDate: new Date('2026-12-31') } });
  return id;
}
async function aSite(projectId: string, siteCode: string, status = 'PLANNED'): Promise<string> {
  const id = uuidv7();
  await prisma.site.create({ data: { id, projectId, siteCode, name: siteCode, status } });
  return id;
}
async function aType(projectId: string, code: string): Promise<string> {
  const id = uuidv7();
  await prisma.taskType.create({ data: { id, projectId, code, name: code, category: 'CIVIL' } });
  return id;
}
async function aMilestone(projectId: string, code: string, sequence: number, taskTypeIds: string[], targetDate: Date | null = null): Promise<void> {
  const id = uuidv7();
  await prisma.milestone.create({ data: { id, projectId, code, name: `Milestone ${code}`, kind: 'PROJECT', sequence, targetDate } });
  if (taskTypeIds.length > 0) await prisma.milestoneRequirement.createMany({ data: taskTypeIds.map((taskTypeId) => ({ milestoneId: id, taskTypeId })) });
}
async function aTask(projectId: string, siteId: string, taskTypeId: string, over: { status?: string; plannedCompletionAt?: Date; actualCompletionAt?: Date } = {}): Promise<void> {
  await prisma.task.create({
    data: {
      id: uuidv7(), projectId, siteId, taskTypeId, title: 'Work', origin: 'PLANNED', createdBy: ACTOR,
      status: over.status ?? 'NOT_STARTED', plannedCompletionAt: over.plannedCompletionAt ?? null, actualCompletionAt: over.actualCompletionAt ?? null,
    },
  });
}

describe('summarizePortfolio', () => {
  it('covers ACTIVE and ON_HOLD projects in scope, and nothing else', async () => {
    const active = await aProject('A1');
    const held = await aProject('A2', 'ON_HOLD');
    const draft = await aProject('A3', 'DRAFT');
    const done = await aProject('A4', 'COMPLETED');
    await aProject('B1');
    const scope: AuthzScope = { global: false, projectIds: [active, held, draft, done], siteIds: [] };
    expect((await summarizePortfolio(prisma, scope, NOW)).map((p) => p.code)).toEqual(['A1', 'A2']);
  });

  it('counts sites and tasks by status, and open tasks past their date as overdue', async () => {
    const p = await aProject('A1');
    const s1 = await aSite(p, 'S1', 'IN_DELIVERY');
    await aSite(p, 'S2');
    const t = await aType(p, 'FDN');
    await aTask(p, s1, t, { status: 'ONGOING', plannedCompletionAt: days(2) });
    await aTask(p, s1, t, { status: 'COMPLETED', plannedCompletionAt: days(5), actualCompletionAt: days(4) });
    await aTask(p, s1, t, { status: 'CANCELLED' });
    const [entry] = await summarizePortfolio(prisma, GLOBAL, NOW);
    expect(entry!.sites).toEqual({ total: 2, byStatus: { IN_DELIVERY: 1, PLANNED: 1 } });
    expect(entry!.tasks).toEqual({ live: 2, completed: 1, overdue: 1, byStatus: { ONGOING: 1, COMPLETED: 1, CANCELLED: 1 } });
    expect(entry!.sitesComplete).toBeNull();
    expect(entry!.startDate).toBe('2026-01-01T00:00:00.000Z');
  });

  it('counts a site complete once it has every required task type, dated by the last of them', async () => {
    const p = await aProject('A1');
    const s1 = await aSite(p, 'S1');
    const s2 = await aSite(p, 'S2');
    const fdn = await aType(p, 'FDN');
    const twr = await aType(p, 'TWR');
    await aMilestone(p, 'M1', 1, [fdn, twr]);
    await aTask(p, s1, fdn, { status: 'COMPLETED', actualCompletionAt: days(20) });
    await aTask(p, s1, twr, { status: 'COMPLETED', actualCompletionAt: days(3) });
    await aTask(p, s2, fdn, { status: 'COMPLETED', actualCompletionAt: days(2) });
    const [entry] = await summarizePortfolio(prisma, GLOBAL, NOW);
    expect(entry!.sitesComplete).toBe(1);
    expect(entry!.completedByWeek).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('counts completed tasks per rolling week when no milestone declares requirements', async () => {
    const p = await aProject('A1');
    const s = await aSite(p, 'S1');
    const t = await aType(p, 'FDN');
    await aMilestone(p, 'M0', 1, []);
    for (const ago of [1, 8, 9, 60]) await aTask(p, s, t, { status: 'COMPLETED', actualCompletionAt: days(ago) });
    const [entry] = await summarizePortfolio(prisma, GLOBAL, NOW);
    expect(entry!.sitesComplete).toBeNull();
    expect(entry!.completedByWeek).toEqual([0, 0, 0, 0, 0, 0, 2, 1]);
  });

  it('names the first milestone some site has not met as next', async () => {
    const p = await aProject('A1');
    const s1 = await aSite(p, 'S1');
    const s2 = await aSite(p, 'S2');
    const fdn = await aType(p, 'FDN');
    const pwr = await aType(p, 'PWR');
    await aMilestone(p, 'M1', 1, [fdn]);
    await aMilestone(p, 'M2', 2, [pwr], new Date('2026-10-20'));
    for (const s of [s1, s2]) await aTask(p, s, fdn, { status: 'COMPLETED', actualCompletionAt: days(10) });
    await aTask(p, s1, pwr, { status: 'COMPLETED', actualCompletionAt: days(1) });
    const [entry] = await summarizePortfolio(prisma, GLOBAL, NOW);
    expect(entry!.nextMilestone).toEqual({ name: 'Milestone M2', targetDate: '2026-10-20T00:00:00.000Z', percent: 50 });
  });

  it('counts only the sites a site-scoped caller holds', async () => {
    const p = await aProject('A1');
    const s1 = await aSite(p, 'S1');
    const s2 = await aSite(p, 'S2');
    const t = await aType(p, 'FDN');
    await aTask(p, s1, t, { status: 'ONGOING' });
    await aTask(p, s2, t, { status: 'ONGOING' });
    const [entry] = await summarizePortfolio(prisma, { global: false, projectIds: [], siteIds: [s1] }, NOW);
    expect(entry!.sites.total).toBe(1);
    expect(entry!.tasks.live).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter project exec vitest run prisma/portfolio.integration.spec.ts`
Expected: FAIL, `Failed to resolve import "../src/project/portfolio.js"`.

- [ ] **Step 3: Write `summarizePortfolio`**

Create `apps/project/src/project/portfolio.ts`:

```ts
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
```

- [ ] **Step 4: Run the integration test**

Run: `pnpm --filter project exec vitest run prisma/portfolio.integration.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the route, with a permission test first**

In `apps/project/src/project/project.controller.spec.ts`, add to the `EXPECTED` array:

```ts
    ['portfolio', 'project.view'],
```

Run: `pnpm --filter project exec vitest run src/project/project.controller.spec.ts`
Expected: FAIL, `portfolio requires project.view` (expected undefined to be 'project.view').

In `apps/project/src/project/project.service.ts`, add the import beside the other local imports:

```ts
import { summarizePortfolio } from './portfolio.js';
```

and add this method directly after `dashboard(scope: AuthzScope) { ... }`:

```ts
  /** The Director's portfolio: every ACTIVE or ON_HOLD project in scope, with the counts its health is judged by. */
  portfolio(scope: AuthzScope) { return summarizePortfolio(this.prisma, scope); }
```

In `apps/project/src/project/project.controller.ts`, add directly after the `@Get('dashboard')` line:

```ts
  /** For the Project Director's home. */
  @Get('dashboard/portfolio') @RequirePermission('project.view') portfolio(@ScopeOf() scope: AuthzScope){ return this.service.portfolio(scope); }
```

- [ ] **Step 6: Run the project tests and typecheck**

Run: `pnpm --filter project exec vitest run src/project/project.controller.spec.ts && pnpm --filter project typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/project
git commit -m "feat(project): portfolio summary for the Project Director

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: qc — `GET /work-orders/summary`

**Files:**
- Modify: `apps/qc/src/work-orders/view.ts`
- Modify: `apps/qc/src/work-orders/work-order.service.ts:17-34` (move `WorkOrderScope`/`reachWhere` out; add `summary`)
- Create: `apps/qc/src/work-orders/work-order-summary.ts`
- Modify: `apps/qc/src/work-orders/work-order.controller.ts`
- Modify: `apps/qc/src/work-orders/work-order.controller.spec.ts`
- Modify: `apps/qc/prisma/fixtures.ts` (`seedWorkOrder` overrides)
- Create: `apps/qc/prisma/work-order-summary.integration.spec.ts`

**Interfaces:**
- Consumes: `SUMMARY_WEEKS`, `weeklyCounts`, `WorkOrderProjectSummary` (Task 1).
- Produces: `summarizeWorkOrders(prisma, scope: WorkOrderScope, now?): Promise<WorkOrderProjectSummary[]>`; `WorkOrderService.summary(scope, now?)`; route `GET /work-orders/summary` requiring `task.view` (gateway `/api/v1/work-orders/summary`).

- [ ] **Step 1: Let `seedWorkOrder` take a project and dates**

In `apps/qc/prisma/fixtures.ts`, replace the whole `seedWorkOrder` function with:

```ts
/** A work order on a fresh project and site (unless given one), written without the service. */
export async function seedWorkOrder(
  prisma: PrismaClient,
  templateId: string,
  overrides: Partial<Pick<SeededWorkOrder, 'assigneeId' | 'status' | 'projectId'>> & { plannedCompletionAt?: Date; actualCompletionAt?: Date } = {},
): Promise<SeededWorkOrder> {
  const { plannedCompletionAt = new Date('2026-09-30T18:14:59Z'), actualCompletionAt = null, ...rest } = overrides;
  const row = {
    id: uuidv7(), projectId: uuidv7(), siteId: uuidv7(), assigneeId: ACTOR, templateId, status: 'NOT_STARTED', ...rest,
  };
  await prisma.workOrder.create({
    data: {
      ...row, projectCode: 'TI-L2100', projectName: 'Antenna upgrade', siteCode: 'KOS102X', siteName: 'KOS102X',
      templateName: 'Antenna + RRU', workOrderType: 'QUALITY_SELF_CHECK', title: '[Quality Self-check]KOS102X',
      plannedCompletionAt, actualCompletionAt, createdBy: ACTOR,
    },
  });
  return row;
}
```

- [ ] **Step 2: Write the failing integration test**

Create `apps/qc/prisma/work-order-summary.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import type { AuthzScope } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { summarizeWorkOrders } from '../src/work-orders/work-order-summary.js';
import { ACTOR, resetDb, seedPublishedTemplate, seedWorkOrder } from './fixtures.js';
import { startTestDb } from './test-db.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let templateId: string;
const NOW = new Date('2026-10-10T06:00:00Z');
const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const P1 = uuidv7();
const P2 = uuidv7();

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => {
  await resetDb(prisma);
  ({ templateId } = await seedPublishedTemplate(prisma));
});

const order = (projectId: string, over: Parameters<typeof seedWorkOrder>[2] = {}) => seedWorkOrder(prisma, templateId, { projectId, ...over });
const event = (workOrderId: string, kind: string, at: Date) =>
  prisma.workOrderEvent.create({ data: { id: uuidv7(), workOrderId, kind, at, actorId: ACTOR } });

describe('summarizeWorkOrders', () => {
  it('counts work orders by status per project, and open ones past their date as overdue', async () => {
    await order(P1, { status: 'ONGOING', plannedCompletionAt: days(1) });
    await order(P1, { status: 'COMPLETED', plannedCompletionAt: days(3), actualCompletionAt: days(2) });
    await order(P2, { status: 'NOT_STARTED', plannedCompletionAt: days(-5) });
    const result = await summarizeWorkOrders(prisma, GLOBAL, NOW);
    const p1 = result.find((s) => s.projectId === P1)!;
    expect(p1.byStatus).toMatchObject({ ONGOING: 1, COMPLETED: 1, NOT_STARTED: 0 });
    expect(p1.overdue).toBe(1);
    expect(result.find((s) => s.projectId === P2)!.overdue).toBe(0);
  });

  it('measures first-time approval over 90 days: approved work orders never rejected', async () => {
    const clean = await order(P1, { status: 'COMPLETED' });
    const reworked = await order(P1, { status: 'COMPLETED' });
    const old = await order(P1, { status: 'COMPLETED' });
    await event(clean.id, 'APPROVED', days(5));
    await event(reworked.id, 'REJECTED', days(12));
    await event(reworked.id, 'APPROVED', days(6));
    await event(old.id, 'APPROVED', days(100));
    const [p1] = await summarizeWorkOrders(prisma, GLOBAL, NOW);
    expect(p1).toMatchObject({ approved90: 2, firstTime90: 1 });
  });

  it('reports how many wait for review, and since when the oldest by its latest submission', async () => {
    const a = await order(P1, { status: 'REVIEWING' });
    const b = await order(P1, { status: 'REVIEWING' });
    await event(a.id, 'SUBMITTED', days(9));
    await event(a.id, 'SUBMITTED', days(4));
    await event(b.id, 'SUBMITTED', days(6));
    const [p1] = await summarizeWorkOrders(prisma, GLOBAL, NOW);
    expect(p1!.reviewing).toEqual({ count: 2, oldestSubmittedAt: days(6).toISOString() });
  });

  it('counts completions per rolling week', async () => {
    for (const ago of [1, 9, 70]) await order(P1, { status: 'COMPLETED', actualCompletionAt: days(ago) });
    const [p1] = await summarizeWorkOrders(prisma, GLOBAL, NOW);
    expect(p1!.completedByWeek).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('reads only what the caller may: their projects, and their own work without task.view_all', async () => {
    await order(P1, { status: 'ONGOING' });
    await order(P2, { status: 'ONGOING' });
    const mine = await order(P1, { status: 'NOT_STARTED', assigneeId: uuidv7() });
    const scoped = await summarizeWorkOrders(prisma, { global: false, projectIds: [P1], siteIds: [] }, NOW);
    expect(scoped.map((s) => s.projectId)).toEqual([P1]);
    const own = await summarizeWorkOrders(prisma, { global: false, projectIds: [P1], siteIds: [], onlyAssignee: mine.assigneeId }, NOW);
    expect(own[0]!.byStatus).toMatchObject({ ONGOING: 0, NOT_STARTED: 1 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter qc exec vitest run prisma/work-order-summary.integration.spec.ts`
Expected: FAIL, `Failed to resolve import "../src/work-orders/work-order-summary.js"`.

- [ ] **Step 4: Move the read filter into `view.ts`**

Replace the top of `apps/qc/src/work-orders/view.ts` (its first line, `import type { WorkOrder } from '@prisma-clients/qc';`) with:

```ts
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
```

In `apps/qc/src/work-orders/work-order.service.ts`, delete the `WorkOrderScope` type and the `reachWhere` function (the block from the `/** What a caller may read.` comment through the closing `}` of `reachWhere`), and change the `./view.js` import line to:

```ts
import { OPEN, CLOSED, reachWhere, toView, type WorkOrderRow, type WorkOrderScope } from './view.js';
import { summarizeWorkOrders } from './work-order-summary.js';

export type { WorkOrderScope } from './view.js';
```

Keep the `scopeWhere, type AuthzScope` import: the service still uses both.

- [ ] **Step 5: Write `summarizeWorkOrders`**

Create `apps/qc/src/work-orders/work-order-summary.ts`:

```ts
import { SUMMARY_WEEKS, TaskStatusSchema, weeklyCounts, type WorkOrderProjectSummary } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/qc';
import { OPEN, reachWhere, type WorkOrderScope } from './view.js';

const DAY_MS = 86_400_000;
/** First-time approval is measured over this many days. */
export const FIRST_TIME_DAYS = 90;

interface Tally { summary: WorkOrderProjectSummary; completions: Date[]; approved: Set<string> }

/**
 * Work orders per project, for the Director's portfolio: status counts,
 * overdue work, how much is approved first time, how long review is taking,
 * and completions per rolling week. Reads only what the caller may read.
 */
export async function summarizeWorkOrders(prisma: PrismaClient, scope: WorkOrderScope, now = new Date()): Promise<WorkOrderProjectSummary[]> {
  const reach: Prisma.WorkOrderWhereInput = { AND: reachWhere(scope) };
  const since90 = new Date(now.getTime() - FIRST_TIME_DAYS * DAY_MS);
  const sinceWeeks = new Date(now.getTime() - SUMMARY_WEEKS * 7 * DAY_MS);

  const [statuses, overdue, approvals, reviewing, completed] = await Promise.all([
    prisma.workOrder.groupBy({ by: ['projectId', 'status'], where: reach, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ['projectId'], where: { AND: [reach, { status: { in: OPEN } }, { plannedCompletionAt: { lt: now } }] }, _count: { _all: true } }),
    prisma.workOrderEvent.findMany({
      where: { kind: 'APPROVED', at: { gte: since90 }, workOrder: reach },
      select: { workOrderId: true, workOrder: { select: { projectId: true, events: { where: { kind: 'REJECTED' }, select: { id: true }, take: 1 } } } },
    }),
    prisma.workOrder.findMany({
      where: { AND: [reach, { status: 'REVIEWING' }] },
      select: { projectId: true, events: { where: { kind: 'SUBMITTED' }, orderBy: { at: 'desc' }, take: 1, select: { at: true } } },
    }),
    prisma.workOrder.findMany({
      where: { AND: [reach, { status: 'COMPLETED' }, { actualCompletionAt: { gte: sinceWeeks } }] },
      select: { projectId: true, actualCompletionAt: true },
    }),
  ]);

  const tallies = new Map<string, Tally>();
  const of = (projectId: string): Tally => {
    let tally = tallies.get(projectId);
    if (!tally) {
      tally = {
        summary: {
          projectId, byStatus: Object.fromEntries(TaskStatusSchema.options.map((status) => [status, 0])), overdue: 0,
          approved90: 0, firstTime90: 0, reviewing: { count: 0, oldestSubmittedAt: null }, completedByWeek: [],
        },
        completions: [],
        approved: new Set(),
      };
      tallies.set(projectId, tally);
    }
    return tally;
  };

  for (const row of statuses) of(row.projectId).summary.byStatus[row.status] = row._count._all;
  for (const row of overdue) of(row.projectId).summary.overdue = row._count._all;
  for (const event of approvals) {
    const tally = of(event.workOrder.projectId);
    if (tally.approved.has(event.workOrderId)) continue;
    tally.approved.add(event.workOrderId);
    tally.summary.approved90 += 1;
    if (event.workOrder.events.length === 0) tally.summary.firstTime90 += 1;
  }
  for (const order of reviewing) {
    const { summary } = of(order.projectId);
    summary.reviewing.count += 1;
    const submitted = order.events[0]?.at.toISOString() ?? null;
    if (submitted && (!summary.reviewing.oldestSubmittedAt || submitted < summary.reviewing.oldestSubmittedAt)) summary.reviewing.oldestSubmittedAt = submitted;
  }
  for (const order of completed) if (order.actualCompletionAt) of(order.projectId).completions.push(order.actualCompletionAt);

  return [...tallies.values()]
    .map(({ summary, completions }) => ({ ...summary, completedByWeek: weeklyCounts(completions, now, SUMMARY_WEEKS) }))
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
}
```

In `apps/qc/src/work-orders/work-order.service.ts`, add this method to `WorkOrderService` directly before `async list(`:

```ts
  /** Per-project work order counts for the Director's portfolio. */
  summary(scope: WorkOrderScope, now = new Date()) {
    return summarizeWorkOrders(this.prisma, scope, now);
  }
```

- [ ] **Step 6: Run the integration test**

Run: `pnpm --filter qc exec vitest run prisma/work-order-summary.integration.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Route, with a controller test first**

In `apps/qc/src/work-orders/work-order.controller.spec.ts`:
- add `summary: vi.fn()` to the `service` object in `make()`;
- add `['summary', 'task.view'],` to the `it.each` permission table;
- add this test inside `describe('WorkOrderController', ...)`:

```ts
  it('summarises within the caller’s reach', async () => {
    const { controller, service } = make();
    await controller.summary(req(['task.view']));
    await controller.summary(req(['task.view', 'task.view_all']));
    expect(service.summary.mock.calls[0]![0]).toEqual({ ...SCOPE, onlyAssignee: 'u-1' });
    expect(service.summary.mock.calls[1]![0]).toEqual(SCOPE);
  });
```

Run: `pnpm --filter qc exec vitest run src/work-orders/work-order.controller.spec.ts`
Expected: FAIL, `controller.summary is not a function`.

In `apps/qc/src/work-orders/work-order.controller.ts`, add directly before the `@Get(':id')` handler:

```ts
  /** Per-project counts for the Director's portfolio, within what the caller may read. */
  @Get('summary') @RequirePermission('task.view')
  async summary(@Req() req: Authed) {
    return this.workOrders.summary(await this.readScope(req));
  }
```

- [ ] **Step 8: Run the qc suite and typecheck**

Run: `pnpm --filter qc exec vitest run src/work-orders prisma/work-order-summary.integration.spec.ts prisma/work-orders.integration.spec.ts && pnpm --filter qc typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 9: Commit**

```bash
git add apps/qc
git commit -m "feat(qc): work order summary per project for the Project Director

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: finance — flags on waiting requests, oldest first

**Files:**
- Create: `apps/finance/src/queries/advances.ts`
- Create: `apps/finance/src/queries/norms.ts`
- Create: `apps/finance/src/queries/norms.spec.ts`
- Create: `apps/finance/src/queries/flags.ts`
- Create: `apps/finance/src/queries/flags.integration.spec.ts`
- Modify: `apps/finance/src/queries/query.service.ts` (`list`)
- Modify: `apps/finance/src/queries/query.service.integration.spec.ts`

**Interfaces:**
- Consumes: `kathmanduDay`, `RequestFlag` (Task 1); `advanceBalance`, `settlementDueOn`, `findDuplicates`, money helpers, `PENDING_STATUSES`, `isPending`.
- Produces:
  - `loadOpenAdvances(prisma, scope, now: Date, requesterIds?: readonly string[]): Promise<OpenAdvance[]>` with `OpenAdvance { id, requesterId, projectId, projectCode, projectName, outstanding, dueOn, inReview, overdue, daysOverdue }`
  - `categoryNorms(prisma, scope, keys: { kind; categoryId }[], now): Promise<Map<string, CategoryNorm>>`, `normKey(kind, categoryId)`, `normOf(amounts)`, `quantile(sorted, q)`
  - `requestFlags(prisma, rows: readonly FlaggedRow[], scope, now): Promise<Map<string, RequestFlag[]>>`, `standingOf(row, open)`, `FlaggedRow`
  - `GET /finance/requests?view=awaiting` rows gain `flags`, ordered by `updatedAt` ascending.

- [ ] **Step 1: Write the failing pure test for norms**

Create `apps/finance/src/queries/norms.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normOf, quantile } from './norms.js';

describe('quantile', () => {
  it('takes the nearest rank', () => {
    const sorted = [100n, 200n, 300n, 400n, 500n];
    expect(quantile(sorted, 0.5)).toBe(300n);
    expect(quantile(sorted, 0.25)).toBe(200n);
    expect(quantile(sorted, 0.75)).toBe(400n);
  });
});

describe('normOf', () => {
  it('needs at least five amounts to say what is usual', () => {
    expect(normOf(['1.00', '2.00', '3.00', '4.00'])).toBeNull();
  });

  it('gives the median and the middle half', () => {
    expect(normOf(['500.00', '100.00', '400.00', '200.00', '300.00'])).toEqual({ median: '300.00', p25: '200.00', p75: '400.00', samples: 5 });
  });
});
```

Run: `pnpm --filter finance exec vitest run src/queries/norms.spec.ts`
Expected: FAIL, `Failed to resolve import "./norms.js"`.

- [ ] **Step 2: Write `norms.ts` and `advances.ts`**

Create `apps/finance/src/queries/norms.ts`:

```ts
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { fromMinor, toMinor } from '../money.js';

export const NORM_WINDOW_DAYS = 180;
export const NORM_MIN_SAMPLES = 5;
const DAY_MS = 86_400_000;

export interface CategoryNorm { median: string; p25: string; p75: string; samples: number }

export const normKey = (kind: string, categoryId: string): string => `${kind}:${categoryId}`;

/** The nearest-rank quantile of amounts already sorted ascending. */
export function quantile(sorted: readonly bigint[], q: number): bigint {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0n;
}

/** The spread of a sample of amounts; null below the minimum sample size. */
export function normOf(amounts: readonly string[]): CategoryNorm | null {
  if (amounts.length < NORM_MIN_SAMPLES) return null;
  const sorted = amounts.map((a) => toMinor(a)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { median: fromMinor(quantile(sorted, 0.5)), p25: fromMinor(quantile(sorted, 0.25)), p75: fromMinor(quantile(sorted, 0.75)), samples: sorted.length };
}

/**
 * What requests of each kind and category usually come to: the approved
 * amounts of those Finance closed in the last 180 days, in the caller's scope.
 * Keyed by normKey; a key is absent when there are too few to compare.
 */
export async function categoryNorms(
  prisma: PrismaClient, scope: AuthzScope, keys: readonly { kind: string; categoryId: string }[], now: Date,
): Promise<Map<string, CategoryNorm>> {
  const wanted = [...new Map(keys.map((k) => [normKey(k.kind, k.categoryId), k])).values()];
  if (wanted.length === 0) return new Map();
  const since = new Date(now.getTime() - NORM_WINDOW_DAYS * DAY_MS);
  const rows = await prisma.financeRequest.findMany({
    where: {
      AND: [
        scopeWhere(scope, { project: 'projectId', site: null }) as Prisma.FinanceRequestWhereInput,
        { OR: wanted.map((k) => ({ kind: k.kind, categoryId: k.categoryId })) },
        { actions: { some: { step: 'FINANCE', action: 'PAID', at: { gte: since } } } },
      ],
    },
    select: { kind: true, categoryId: true, approvedAmount: true },
  });
  const samples = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.approvedAmount) continue;
    const key = normKey(row.kind, row.categoryId);
    samples.set(key, [...(samples.get(key) ?? []), row.approvedAmount.toFixed(2)]);
  }
  const norms = new Map<string, CategoryNorm>();
  for (const [key, amounts] of samples) {
    const norm = normOf(amounts);
    if (norm) norms.set(key, norm);
  }
  return norms;
}
```

Create `apps/finance/src/queries/advances.ts`:

```ts
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { kathmanduDay } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { advanceBalance } from '../balance.js';
import { compareMoney } from '../money.js';
import { settlementDueOn } from '../settlement.js';
import { PENDING_STATUSES } from '../workflow.js';

const DAY_MS = 86_400_000;

/** A paid advance with money still out. */
export interface OpenAdvance {
  id: string; requesterId: string; projectId: string; projectCode: string; projectName: string;
  outstanding: string;
  /** The last day to settle, `YYYY-MM-DD`; null if no payout is recorded. */
  dueOn: string | null;
  /** A settlement against it is waiting for approval. */
  inReview: boolean;
  /** Past its settle-by day with no settlement under review. */
  overdue: boolean;
  /** Whole days past the settle-by day; 0 when not overdue. */
  daysOverdue: number;
}

/**
 * Paid advances in the caller's project scope that still have money out,
 * optionally only those of some requesters. Overdue means past the
 * settle-by day (in Kathmandu) with no settlement under review, the rule
 * mobile uses.
 */
export async function loadOpenAdvances(prisma: PrismaClient, scope: AuthzScope, now: Date, requesterIds?: readonly string[]): Promise<OpenAdvance[]> {
  const advances = await prisma.financeRequest.findMany({
    where: {
      AND: [
        scopeWhere(scope, { project: 'projectId', site: null }) as Prisma.FinanceRequestWhereInput,
        { kind: 'ADVANCE', status: 'PAID' },
        requesterIds ? { requesterId: { in: [...requesterIds] } } : {},
      ],
    },
    select: { id: true, requesterId: true, projectId: true, projectCode: true, projectName: true, approvedAmount: true },
  });
  if (advances.length === 0) return [];
  const ids = advances.map((a) => a.id);
  const [settled, payments, pending] = await Promise.all([
    prisma.financeRequest.findMany({ where: { advanceId: { in: ids }, status: 'SETTLED' }, select: { advanceId: true, appliedAmount: true } }),
    prisma.payment.findMany({ where: { requestId: { in: ids } }, select: { requestId: true, kind: true, amount: true, paidOn: true } }),
    prisma.financeRequest.findMany({ where: { advanceId: { in: ids }, status: { in: [...PENDING_STATUSES] } }, select: { advanceId: true } }),
  ]);
  const today = kathmanduDay(now);
  const open: OpenAdvance[] = [];
  for (const advance of advances) {
    const mine = payments.filter((p) => p.requestId === advance.id);
    const balance = advanceBalance({
      paid: advance.approvedAmount?.toFixed(2) ?? '0.00',
      applied: settled.filter((s) => s.advanceId === advance.id).map((s) => s.appliedAmount?.toFixed(2) ?? '0.00'),
      cashReturned: mine.filter((p) => p.kind === 'CASH_RETURN').map((p) => p.amount.toFixed(2)),
    });
    if (compareMoney(balance.outstanding, '0') <= 0) continue;
    const payout = mine.find((p) => p.kind === 'PAYOUT');
    const dueOn = payout ? settlementDueOn(payout.paidOn) : null;
    const inReview = pending.some((s) => s.advanceId === advance.id);
    const overdue = dueOn !== null && dueOn < today && !inReview;
    open.push({
      id: advance.id, requesterId: advance.requesterId, projectId: advance.projectId, projectCode: advance.projectCode, projectName: advance.projectName,
      outstanding: balance.outstanding, dueOn, inReview, overdue,
      daysOverdue: overdue && dueOn ? Math.round((Date.parse(today) - Date.parse(dueOn)) / DAY_MS) : 0,
    });
  }
  return open;
}
```

Run: `pnpm --filter finance exec vitest run src/queries/norms.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 3: Write the failing integration test for flags**

Create `apps/finance/src/queries/flags.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RequestFlag } from '@ipms/contracts';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, OTHER_PROJECT, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { RequestService } from '../requests/request.service.js';
import { requestFlags } from './flags.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService;
let approvals: ApprovalService;
let payments: PaymentService;
let categoryId: string;
const DAY = 86_400_000;
const NOW = new Date('2026-10-10T06:00:00Z');

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma); payments = new PaymentService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const advance = async (amount = '1000', requester = ACTORS.engineer) => {
  const r = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Travel', amount }, requester, scopes.project, PROJECT);
  return requests.submit(r.id, requester);
};
const reimbursement = async (amount: string, invoice: { vendor: string; invoiceNumber?: string; invoiceDate?: Date }, requester = ACTORS.engineer, project = PROJECT) => {
  const scope = project.id === PROJECT.id ? scopes.project : scopes.otherProject;
  const r = await requests.create({
    kind: 'REIMBURSEMENT', projectId: project.id, categoryId, purpose: 'Fuel',
    invoices: [{ vendor: invoice.vendor, ...(invoice.invoiceNumber ? { invoiceNumber: invoice.invoiceNumber } : {}), invoiceDate: invoice.invoiceDate ?? new Date('2026-10-01'), amount }],
  }, requester, scope, project);
  return requests.submit(r.id, requester);
};
const close = async (id: string, paidOn = new Date('2026-10-09')) => {
  await approvals.approve(id, {}, ACTORS.pm, scopes.project);
  await approvals.approve(id, {}, ACTORS.director, scopes.project);
  await payments.pay(id, { mode: 'CASH', reference: `V-${id.slice(-6)}`, paidOn }, ACTORS.finance, scopes.global);
};
const flagsFor = async (id: string, now = NOW): Promise<RequestFlag[]> => {
  const row = await prisma.financeRequest.findUniqueOrThrow({ where: { id }, include: { category: { select: { name: true } } } });
  return (await requestFlags(prisma, [row], scopes.project, now)).get(id) ?? [];
};

describe('requestFlags', () => {
  it('flags nothing on a fresh request from someone holding no cash', async () => {
    const r = await advance();
    expect(await flagsFor(r.id)).toEqual([]);
  });

  it('says when the requester already holds unsettled cash, red once an advance is overdue', async () => {
    const fresh = await advance('1000'); await close(fresh.id, new Date('2026-10-09'));
    const next = await advance('300');
    expect(await flagsFor(next.id)).toEqual([{ code: 'REQUESTER_HOLDS_CASH', tone: 'amber', outstanding: '1000.00', advances: 1, overdue: 0, oldestOverdueDays: null }]);

    const late = await advance('1000'); await close(late.id, new Date('2026-09-30'));
    expect(await flagsFor(next.id)).toEqual([{ code: 'REQUESTER_HOLDS_CASH', tone: 'red', outstanding: '2000.00', advances: 2, overdue: 1, oldestOverdueDays: 3 }]);
  });

  it('leaves out the advance a settlement settles', async () => {
    const a = await advance('1000'); await close(a.id);
    const s = await requests.create({
      kind: 'SETTLEMENT', advanceId: a.id, categoryId, purpose: 'Bills',
      invoices: [{ vendor: 'Hotel', invoiceNumber: 'H-1', invoiceDate: new Date('2026-10-01'), amount: '500' }],
    }, ACTORS.engineer, scopes.project);
    await requests.submit(s.id, ACTORS.engineer);
    expect((await flagsFor(s.id)).map((f) => f.code)).not.toContain('REQUESTER_HOLDS_CASH');
  });

  it('flags an amount over twice the usual for its kind and category, once five have closed', async () => {
    for (let n = 1; n <= 4; n += 1) { const r = await reimbursement('1000', { vendor: 'Fuel stop', invoiceNumber: `F-${n}` }); await close(r.id); }
    const big = await reimbursement('2500', { vendor: 'Fuel stop', invoiceNumber: 'F-99' });
    expect((await flagsFor(big.id)).map((f) => f.code)).not.toContain('UNUSUAL_AMOUNT');

    const fifth = await reimbursement('1000', { vendor: 'Fuel stop', invoiceNumber: 'F-5' }); await close(fifth.id);
    expect(await flagsFor(big.id)).toContainEqual({ code: 'UNUSUAL_AMOUNT', tone: 'amber', ratio: 2.5, median: '1000.00', category: expect.any(String) });
  });

  it('flags a bill already on another live request in scope, and not one outside it', async () => {
    const first = await reimbursement('750', { vendor: 'Hardware' });
    const second = await reimbursement('750', { vendor: 'Hardware' }, ACTORS.otherEngineer);
    expect(await flagsFor(second.id)).toContainEqual({ code: 'DUPLICATE_BILL', tone: 'red', matches: [{ requestId: first.id, number: first.number }] });

    await resetDb(prisma);
    await reimbursement('750', { vendor: 'Hardware' }, ACTORS.otherEngineer, OTHER_PROJECT);
    const mine = await reimbursement('750', { vendor: 'Hardware' });
    expect((await flagsFor(mine.id)).map((f) => f.code)).not.toContain('DUPLICATE_BILL');
  });

  it('flags a long wait at the current step', async () => {
    const r = await advance();
    await prisma.$executeRaw`UPDATE "finance_request" SET "updatedAt" = ${new Date(Date.now() - 5 * DAY)} WHERE "id" = ${r.id}::uuid`;
    expect(await flagsFor(r.id, new Date())).toEqual([{ code: 'WAITING_LONG', tone: 'amber', days: 5 }]);
  });

  it('flags only requests that are waiting for someone', async () => {
    const paid = await advance(); await close(paid.id);
    expect(await flagsFor(paid.id)).toEqual([]);
  });
});
```

Run: `pnpm --filter finance exec vitest run src/queries/flags.integration.spec.ts`
Expected: FAIL, `Failed to resolve import "./flags.js"`.

- [ ] **Step 4: Write `flags.ts`**

Create `apps/finance/src/queries/flags.ts`:

```ts
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import type { RequestFlag } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { findDuplicates, type DuplicateHit } from '../duplicates.js';
import { sumMoney, toMinor } from '../money.js';
import { isPending } from '../workflow.js';
import { loadOpenAdvances, type OpenAdvance } from './advances.js';
import { categoryNorms, normKey } from './norms.js';

export const WAITING_LONG_DAYS = 3;
export const UNUSUAL_RATIO = 2;
const DAY_MS = 86_400_000;

type Money = { toFixed(digits: number): string };

/** The fields a flag is computed from; a Prisma row with its category satisfies it. */
export interface FlaggedRow {
  id: string; kind: string; status: string; categoryId: string; requesterId: string; advanceId: string | null;
  requestedAmount: Money; approvedAmount: Money | null; updatedAt: Date; category: { name: string };
}

/** What the requester still holds, leaving out this request and the advance a settlement settles. */
export function standingOf(row: Pick<FlaggedRow, 'id' | 'requesterId' | 'advanceId'>, open: readonly OpenAdvance[]) {
  const held = open.filter((a) => a.requesterId === row.requesterId && a.id !== row.id && a.id !== row.advanceId);
  const overdue = held.filter((a) => a.overdue);
  return {
    openAdvances: held.length,
    outstanding: sumMoney(held.map((a) => a.outstanding)),
    overdue: overdue.length,
    oldestOverdueDays: overdue.length > 0 ? Math.max(...overdue.map((a) => a.daysOverdue)) : null,
  };
}

/**
 * Warnings for requests waiting on an approver: a bill that may already have
 * been claimed, a requester already holding unsettled cash, an amount well
 * above the usual for its kind and category, and a long wait at the current
 * step. Only pending rows are flagged, and everything counted is in the
 * caller's scope, so a flag reveals nothing the caller could not open.
 */
export async function requestFlags(prisma: PrismaClient, rows: readonly FlaggedRow[], scope: AuthzScope, now: Date): Promise<Map<string, RequestFlag[]>> {
  const pending = rows.filter((r) => isPending(r.status));
  const flags = new Map<string, RequestFlag[]>();
  if (pending.length === 0) return flags;

  const withBills = pending.filter((r) => r.kind !== 'ADVANCE');
  const [open, norms, bills] = await Promise.all([
    loadOpenAdvances(prisma, scope, now, [...new Set(pending.map((r) => r.requesterId))]),
    categoryNorms(prisma, scope, pending.map((r) => ({ kind: r.kind, categoryId: r.categoryId })), now),
    withBills.length === 0 ? Promise.resolve([]) : prisma.requestInvoice.findMany({
      where: { requestId: { in: withBills.map((r) => r.id) } },
      select: { requestId: true, vendor: true, invoiceNumber: true, invoiceDate: true, amount: true },
    }),
  ]);

  // findDuplicates looks at anyone's requests; keep only matches the caller could open.
  const found = new Map<string, DuplicateHit[]>(await Promise.all(withBills.map(async (row) => {
    const mine = bills.filter((b) => b.requestId === row.id).map((b) => ({ vendor: b.vendor, invoiceNumber: b.invoiceNumber, invoiceDate: b.invoiceDate, amount: b.amount.toFixed(2) }));
    return [row.id, (await findDuplicates(prisma, row.id, mine)).filter((h) => h.reason !== 'NUMBER_OTHER_YEAR')] as const;
  })));
  const hitIds = [...new Set([...found.values()].flat().map((h) => h.requestId))];
  const visible = new Set(hitIds.length === 0 ? [] : (await prisma.financeRequest.findMany({
    where: { AND: [{ id: { in: hitIds } }, scopeWhere(scope, { project: 'projectId', site: null }) as Prisma.FinanceRequestWhereInput] },
    select: { id: true },
  })).map((r) => r.id));

  for (const row of pending) {
    const list: RequestFlag[] = [];

    const hits = (found.get(row.id) ?? []).filter((h) => visible.has(h.requestId));
    if (hits.length > 0) {
      list.push({ code: 'DUPLICATE_BILL', tone: 'red', matches: [...new Map(hits.map((h) => [h.requestId, { requestId: h.requestId, number: h.number }])).values()] });
    }

    const standing = standingOf(row, open);
    if (standing.openAdvances > 0) {
      list.push({ code: 'REQUESTER_HOLDS_CASH', tone: standing.overdue > 0 ? 'red' : 'amber', outstanding: standing.outstanding, advances: standing.openAdvances, overdue: standing.overdue, oldestOverdueDays: standing.oldestOverdueDays });
    }

    const amount = (row.approvedAmount ?? row.requestedAmount).toFixed(2);
    const norm = norms.get(normKey(row.kind, row.categoryId));
    if (norm && toMinor(norm.median) > 0n && toMinor(amount) > BigInt(UNUSUAL_RATIO) * toMinor(norm.median)) {
      list.push({ code: 'UNUSUAL_AMOUNT', tone: 'amber', ratio: Math.round((Number(amount) / Number(norm.median)) * 10) / 10, median: norm.median, category: row.category.name });
    }

    const days = Math.floor((now.getTime() - row.updatedAt.getTime()) / DAY_MS);
    if (days > WAITING_LONG_DAYS) list.push({ code: 'WAITING_LONG', tone: 'amber', days });

    flags.set(row.id, list);
  }
  return flags;
}
```

Run: `pnpm --filter finance exec vitest run src/queries/flags.integration.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Order the awaiting list oldest first and attach flags, test first**

In `apps/finance/src/queries/query.service.integration.spec.ts`, add inside `describe('list', ...)`:

```ts
  it('lists what awaits the caller oldest-waiting first, with flags', async () => {
    const older = await make();
    const newer = await make();
    await prisma.$executeRaw`UPDATE "finance_request" SET "updatedAt" = ${new Date(Date.now() - 5 * 86_400_000)} WHERE "id" = ${older.id}::uuid`;
    const page = await queries.list(ACTORS.pm, scopes.project, { view: 'awaiting', page: 1, limit: 20 });
    expect(page.items.map((i) => i.id)).toEqual([older.id, newer.id]);
    expect(page.items[0]!.flags).toEqual([{ code: 'WAITING_LONG', tone: 'amber', days: 5 }]);
    expect(page.items[1]!.flags).toEqual([]);
  });

  it('carries no flags outside the awaiting view', async () => {
    await make();
    const page = await queries.list(ACTORS.pm, scopes.project, { view: 'all', page: 1, limit: 20 });
    expect(page.items[0]).not.toHaveProperty('flags');
  });
```

Run: `pnpm --filter finance exec vitest run src/queries/query.service.integration.spec.ts`
Expected: FAIL on the new awaiting test (order and missing `flags`).

In `apps/finance/src/queries/query.service.ts`, add the import:

```ts
import { requestFlags } from './flags.js';
```

and replace the body of `list` from `const [items, total] = await Promise.all([` through its `return` with:

```ts
    // The awaiting queue is read oldest-waiting first; a pending request changes only when it moves, so updatedAt is when it arrived.
    const orderBy = query.view === 'handled' ? { updatedAt: 'desc' as const } : query.view === 'awaiting' ? { updatedAt: 'asc' as const } : { createdAt: 'desc' as const };
    const [items, total] = await Promise.all([
      this.prisma.financeRequest.findMany({
        where: full, orderBy, skip: (query.page - 1) * query.limit, take: query.limit,
        include: { category: { select: { code: true, name: true } } },
      }),
      this.prisma.financeRequest.count({ where: full }),
    ]);
    const [facts, flags] = await Promise.all([
      listFacts(this.prisma, items),
      query.view === 'awaiting' ? requestFlags(this.prisma, items, scope, new Date()) : Promise.resolve(new Map<string, never[]>()),
    ]);
    return {
      items: items.map((row) => {
        const rowFlags = flags.get(row.id);
        return { ...serializeRequest(row), category: row.category, ...facts.get(row.id), ...(rowFlags ? { flags: rowFlags } : {}) };
      }),
      total, page: query.page, limit: query.limit,
    };
```

- [ ] **Step 6: Run the finance query suite and typecheck**

Run: `pnpm --filter finance exec vitest run src/queries && pnpm --filter finance typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/finance/src/queries
git commit -m "feat(finance): flag waiting requests and list them oldest first

Duplicate bills in scope, unsettled cash the requester holds, amounts over twice
the usual for their kind and category, and long waits at the current step.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: finance — `GET /finance/overview`

**Files:**
- Create: `apps/finance/src/queries/spend.ts`
- Create: `apps/finance/src/queries/overview.service.ts`
- Create: `apps/finance/src/queries/overview.service.integration.spec.ts`
- Create: `apps/finance/src/http/overview.controller.ts`
- Modify: `apps/finance/src/http/controllers.spec.ts`
- Modify: `apps/finance/src/app.module.ts`

**Interfaces:**
- Consumes: `loadOpenAdvances`, `requestFlags` (Task 4); `recentMonths`, `kathmanduMonth`, `FinanceOverview`, `PendingStatus` (Task 1); `awaitingStatuses`, `PENDING_STATUSES`.
- Produces: `loadClosed(prisma, where, since?): Promise<ClosedRequest[]>`, `spendByMonth(closed, months): string[]`, `median(values): number | null`, `OverviewService.overview(actor, scope, now?)`, route `GET /finance/overview` requiring `finance_request.view_all`.

- [ ] **Step 1: Write the failing integration test**

Create `apps/finance/src/queries/overview.service.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, OTHER_PROJECT, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { RequestService } from '../requests/request.service.js';
import { OverviewService } from './overview.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService;
let approvals: ApprovalService;
let payments: PaymentService;
let overviews: OverviewService;
let categoryId: string;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-10-10T06:00:00Z');

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma); payments = new PaymentService(prisma); overviews = new OverviewService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const raise = async (requester = ACTORS.engineer, amount = '1000', project = PROJECT) => {
  const scope = project.id === PROJECT.id ? scopes.project : scopes.otherProject;
  const r = await requests.create({ kind: 'ADVANCE', projectId: project.id, categoryId, purpose: 'Travel', amount }, requester, scope, project);
  return requests.submit(r.id, requester);
};
const reimburse = async (amount: string, n: number) => {
  const r = await requests.create({
    kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel',
    invoices: [{ vendor: 'Fuel stop', invoiceNumber: `F-${n}`, invoiceDate: new Date('2026-09-25'), amount }],
  }, ACTORS.engineer, scopes.project, PROJECT);
  return requests.submit(r.id, ACTORS.engineer);
};
const throughDirector = async (id: string, amount?: string) => {
  await approvals.approve(id, {}, ACTORS.pm, scopes.project);
  await approvals.approve(id, amount ? { amount } : {}, ACTORS.director, scopes.project);
};
const pay = (id: string, paidOn = new Date('2026-10-09')) =>
  payments.pay(id, { mode: 'CASH', reference: `V-${id.slice(-6)}`, paidOn }, ACTORS.finance, scopes.global);
const setUpdatedAt = (id: string, at: Date) => prisma.$executeRaw`UPDATE "finance_request" SET "updatedAt" = ${at} WHERE "id" = ${id}::uuid`;
const setActionAt = (id: string, step: string, action: string, at: Date) =>
  prisma.$executeRaw`UPDATE "approval_action" SET "at" = ${at} WHERE "requestId" = ${id}::uuid AND "step" = ${step} AND "action" = ${action}`;

describe('OverviewService', () => {
  it('refuses a caller without view_all', async () => {
    await expect(overviews.overview(ACTORS.engineer, scopes.project)).rejects.toThrow(/view_all/);
  });

  it('counts each pending step and marks the caller’s own', async () => {
    await raise(ACTORS.engineer, '1000');
    await raise(ACTORS.pm, '2500');
    const ready = await raise(ACTORS.engineer, '400');
    await throughDirector(ready.id);
    const { pipeline } = await overviews.overview(ACTORS.director, scopes.project);
    expect(pipeline.steps).toEqual([
      { status: 'PENDING_PM', count: 1, amount: '1000.00', oldestSince: expect.any(String), mine: false },
      { status: 'PENDING_DIRECTOR', count: 1, amount: '2500.00', oldestSince: expect.any(String), mine: true },
      { status: 'PENDING_FINANCE', count: 1, amount: '400.00', oldestSince: expect.any(String), mine: false },
    ]);
  });

  it('leaves the caller’s own requests out of their step and their queue', async () => {
    const both = { id: ACTORS.pm.id, permissions: [...ACTORS.pm.permissions, 'finance_approval.director'] };
    await raise(ACTORS.pm, '700');
    const theirs = await raise(ACTORS.otherPm, '300');
    const view = await overviews.overview(both, scopes.project);
    expect(view.pipeline.steps.find((s) => s.status === 'PENDING_DIRECTOR')).toMatchObject({ count: 1, amount: '300.00', mine: true });
    expect(view.queue.map((q) => q.id)).toEqual([theirs.id]);
  });

  it('queues the five longest waiting at the caller’s step, oldest first, with flags', async () => {
    const raised = [];
    for (let i = 0; i < 6; i += 1) raised.push(await raise(ACTORS.pm, '100'));
    await setUpdatedAt(raised[3]!.id, new Date(Date.now() - 5 * DAY));
    const { queue } = await overviews.overview(ACTORS.director, scopes.project);
    expect(queue).toHaveLength(5);
    expect(queue[0]).toMatchObject({ id: raised[3]!.id, kind: 'ADVANCE', amount: '100.00', flags: [{ code: 'WAITING_LONG', tone: 'amber', days: 5 }] });
  });

  it('files spend under the month Finance closed it, in Kathmandu time', async () => {
    const october = await reimburse('600', 1); await throughDirector(october.id); await pay(october.id);
    const september = await reimburse('250', 2); await throughDirector(september.id); await pay(september.id);
    await setActionAt(october.id, 'FINANCE', 'PAID', new Date('2026-09-30T19:00:00Z'));   // 00:45 on 1 Oct in Kathmandu
    await setActionAt(september.id, 'FINANCE', 'PAID', new Date('2026-09-30T18:00:00Z')); // 23:45 on 30 Sep
    const view = await overviews.overview(ACTORS.director, scopes.project, NOW);
    expect(view.months).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(view.projects).toEqual([expect.objectContaining({ projectId: PROJECT.id, spentToDate: '850.00', spentByMonth: ['0.00', '0.00', '0.00', '0.00', '250.00', '600.00'] })]);
    expect(view.pipeline.paidThisMonth).toEqual({ count: 1, amount: '600.00' });
    expect(view.categories).toEqual([{ categoryId, name: expect.any(String), amount: '600.00' }]);
  });

  it('counts cash still with engineers, and settlements past their day with nothing under review', async () => {
    const fresh = await raise(ACTORS.engineer, '1000'); await throughDirector(fresh.id); await pay(fresh.id, new Date('2026-10-08'));
    const late = await raise(ACTORS.engineer, '500'); await throughDirector(late.id); await pay(late.id, new Date('2026-09-20'));
    const view = await overviews.overview(ACTORS.director, scopes.project, NOW);
    expect(view.projects).toEqual([expect.objectContaining({ spentToDate: '0.00', cashHeld: '1500.00', overdueSettlements: { count: 1, amount: '500.00' } })]);
    expect(view.cashHolders).toEqual([{ requesterId: ACTORS.engineer.id, outstanding: '1500.00', open: 2, overdue: 1 }]);

    const settling = await requests.create({
      kind: 'SETTLEMENT', advanceId: late.id, categoryId, purpose: 'Bills',
      invoices: [{ vendor: 'Hotel', invoiceNumber: 'H-1', invoiceDate: new Date('2026-09-22'), amount: '450' }],
    }, ACTORS.engineer, scopes.project);
    await requests.submit(settling.id, ACTORS.engineer);
    expect((await overviews.overview(ACTORS.director, scopes.project, NOW)).projects[0]!.overdueSettlements.count).toBe(0);
  });

  it('sums what the caller decided in 30 days, what they trimmed, and how long they took', async () => {
    const trimmedOne = await raise(ACTORS.engineer, '1000');
    const returnedOne = await raise(ACTORS.engineer, '200');
    const rejectedOne = await raise(ACTORS.engineer, '300');
    for (const r of [trimmedOne, returnedOne, rejectedOne]) await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    for (const [r, hours] of [[trimmedOne, 4], [returnedOne, 2], [rejectedOne, 10]] as const) {
      await setActionAt(r.id, 'REQUESTER', 'SUBMITTED', new Date(Date.now() - 24 * HOUR));
      await setActionAt(r.id, 'PM', 'APPROVED', new Date(Date.now() - hours * HOUR));
    }
    await approvals.approve(trimmedOne.id, { amount: '800' }, ACTORS.director, scopes.project);
    await approvals.returnToRequester(returnedOne.id, 'Add the quotation', ACTORS.director, scopes.project);
    await approvals.reject(rejectedOne.id, 'Not in budget', ACTORS.director, scopes.project);
    const { decisions } = await overviews.overview(ACTORS.director, scopes.project);
    expect(decisions).toMatchObject({ approved: { count: 1, amount: '800.00' }, trimmed: { count: 1, saved: '200.00' }, returned: 1, rejected: 1 });
    expect(decisions.medianHoursToDecide).toBeCloseTo(4, 0);
  });

  it('counts nothing outside the caller’s projects', async () => {
    await raise(ACTORS.otherEngineer, '999', OTHER_PROJECT);
    const view = await overviews.overview(ACTORS.director, scopes.project);
    expect(view.pipeline.steps.every((s) => s.count === 0)).toBe(true);
    expect(view.projects).toEqual([]);
  });
});
```

Run: `pnpm --filter finance exec vitest run src/queries/overview.service.integration.spec.ts`
Expected: FAIL, `Failed to resolve import "./overview.service.js"`.

- [ ] **Step 2: Write `spend.ts`**

Create `apps/finance/src/queries/spend.ts`:

```ts
import { kathmanduMonth } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import { sumMoney } from '../money.js';

/** A request Finance has closed, with the month it closed and what it spent. */
export interface ClosedRequest {
  id: string; kind: string; projectId: string; projectCode: string; projectName: string;
  categoryId: string; category: string; requesterId: string;
  /** `YYYY-MM` in Kathmandu of Finance's PAID action. */
  month: string;
  /** Expense as the spend report counts it: a reimbursement's or settlement's approved amount. Null for an advance, whose cash is held, not spent. */
  spent: string | null;
  /** What Finance paid out when it closed the request. */
  paidOut: string;
}

/** Requests matching `where` that Finance has closed, optionally only since a moment. */
export async function loadClosed(prisma: PrismaClient, where: Prisma.FinanceRequestWhereInput, since?: Date): Promise<ClosedRequest[]> {
  const actions = await prisma.approvalAction.findMany({
    where: { step: 'FINANCE', action: 'PAID', ...(since ? { at: { gte: since } } : {}), request: where },
    select: {
      at: true, amount: true,
      request: { select: { id: true, kind: true, projectId: true, projectCode: true, projectName: true, categoryId: true, requesterId: true, approvedAmount: true, category: { select: { name: true } } } },
    },
  });
  return actions.map(({ at, amount, request }) => ({
    id: request.id, kind: request.kind, projectId: request.projectId, projectCode: request.projectCode, projectName: request.projectName,
    categoryId: request.categoryId, category: request.category.name, requesterId: request.requesterId,
    month: kathmanduMonth(at),
    spent: request.kind === 'ADVANCE' ? null : request.approvedAmount?.toFixed(2) ?? '0.00',
    paidOut: amount?.toFixed(2) ?? '0.00',
  }));
}

/** Spend in each of these months. */
export function spendByMonth(closed: readonly ClosedRequest[], months: readonly string[]): string[] {
  return months.map((month) => sumMoney(closed.flatMap((c) => (c.month === month && c.spent !== null ? [c.spent] : []))));
}
```

- [ ] **Step 3: Write `OverviewService`**

Create `apps/finance/src/queries/overview.service.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { scopeWhere, type AuthzScope } from '@ipms/authz';
import { recentMonths, type FinanceOverview, type PendingStatus, type ProjectMoney, type RequestKind } from '@ipms/contracts';
import type { Prisma, PrismaClient } from '@prisma-clients/finance';
import type { Actor } from '../common.js';
import { compareMoney, subMoney, sumMoney } from '../money.js';
import { PENDING_STATUSES, awaitingStatuses } from '../workflow.js';
import { loadOpenAdvances } from './advances.js';
import { requestFlags } from './flags.js';
import { loadClosed, spendByMonth } from './spend.js';

const VIEW_ALL = 'finance_request.view_all';
const DAY_MS = 86_400_000;
export const OVERVIEW_MONTHS = 6;
export const QUEUE_SIZE = 5;
export const TOP_HOLDERS = 5;
export const DECISION_WINDOW_DAYS = 30;

type Money = { toFixed(digits: number): string };
const amountOf = (r: { approvedAmount: Money | null; requestedAmount: Money }): string => (r.approvedAmount ?? r.requestedAmount).toFixed(2);

/** The middle value, to one decimal; null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

/**
 * An approver's money at a glance: where requests stand, what waits on them,
 * what each project has spent and still has out, and what they decided.
 * Everything is in the caller's project scope.
 */
export class OverviewService {
  constructor(private readonly prisma: PrismaClient) {}

  async overview(actor: Actor, scope: AuthzScope, now = new Date()): Promise<FinanceOverview> {
    if (!actor.permissions.includes(VIEW_ALL)) throw new ForbiddenException(`The overview needs the ${VIEW_ALL} permission`);
    const inProjects = scopeWhere(scope, { project: 'projectId', site: null }) as Prisma.FinanceRequestWhereInput;
    const mine = new Set<string>(awaitingStatuses(actor.permissions));
    const months = recentMonths(now, OVERVIEW_MONTHS);
    const thisMonth = months[months.length - 1]!;

    const [pending, closed, open, decided] = await Promise.all([
      this.prisma.financeRequest.findMany({
        where: { AND: [inProjects, { status: { in: [...PENDING_STATUSES] } }] },
        include: { category: { select: { name: true } } },
        orderBy: { updatedAt: 'asc' },
      }),
      loadClosed(this.prisma, inProjects),
      loadOpenAdvances(this.prisma, scope, now),
      this.prisma.approvalAction.findMany({
        where: {
          actorId: actor.id, step: { not: 'REQUESTER' }, action: { in: ['APPROVED', 'RETURNED', 'REJECTED'] },
          at: { gte: new Date(now.getTime() - DECISION_WINDOW_DAYS * DAY_MS) }, request: inProjects,
        },
        select: { requestId: true, revision: true, action: true, amount: true, at: true, request: { select: { requestedAmount: true } } },
      }),
    ]);

    // The caller's own requests are left out of their own steps, as they are from the queue.
    const visible = pending.filter((r) => !(mine.has(r.status) && r.requesterId === actor.id));
    const steps = PENDING_STATUSES.map((status) => {
      const here = visible.filter((r) => r.status === status);
      return { status, count: here.length, amount: sumMoney(here.map(amountOf)), oldestSince: here[0]?.updatedAt.toISOString() ?? null, mine: mine.has(status) };
    });

    const queueRows = visible.filter((r) => mine.has(r.status)).slice(0, QUEUE_SIZE);
    const flags = await requestFlags(this.prisma, queueRows, scope, now);
    const queue = queueRows.map((r) => ({
      id: r.id, number: r.number, kind: r.kind as RequestKind, status: r.status as PendingStatus,
      projectId: r.projectId, projectCode: r.projectCode, projectName: r.projectName,
      requesterId: r.requesterId, purpose: r.purpose, category: r.category.name,
      amount: amountOf(r), waitingSince: r.updatedAt.toISOString(), flags: flags.get(r.id) ?? [],
    }));

    const projects = new Map<string, ProjectMoney>();
    for (const p of [...closed, ...open]) {
      if (!projects.has(p.projectId)) {
        projects.set(p.projectId, { projectId: p.projectId, code: p.projectCode, name: p.projectName, spentToDate: '0.00', spentByMonth: [], cashHeld: '0.00', overdueSettlements: { count: 0, amount: '0.00' } });
      }
    }
    for (const entry of projects.values()) {
      const own = closed.filter((c) => c.projectId === entry.projectId);
      entry.spentToDate = sumMoney(own.flatMap((c) => (c.spent === null ? [] : [c.spent])));
      entry.spentByMonth = spendByMonth(own, months);
      const held = open.filter((a) => a.projectId === entry.projectId);
      entry.cashHeld = sumMoney(held.map((a) => a.outstanding));
      const late = held.filter((a) => a.overdue);
      entry.overdueSettlements = { count: late.length, amount: sumMoney(late.map((a) => a.outstanding)) };
    }

    const closedThisMonth = closed.filter((c) => c.month === thisMonth);
    const byCategory = new Map<string, { name: string; amounts: string[] }>();
    for (const c of closedThisMonth) {
      if (c.spent === null) continue;
      const entry = byCategory.get(c.categoryId) ?? { name: c.category, amounts: [] };
      entry.amounts.push(c.spent);
      byCategory.set(c.categoryId, entry);
    }

    const holders = new Map<string, { outstanding: string[]; open: number; overdue: number }>();
    for (const a of open) {
      if (a.requesterId === actor.id) continue;
      const h = holders.get(a.requesterId) ?? { outstanding: [], open: 0, overdue: 0 };
      h.outstanding.push(a.outstanding);
      h.open += 1;
      if (a.overdue) h.overdue += 1;
      holders.set(a.requesterId, h);
    }

    return {
      months,
      pipeline: { steps, paidThisMonth: { count: closedThisMonth.length, amount: sumMoney(closedThisMonth.map((c) => c.paidOut)) } },
      queue,
      projects: [...projects.values()].sort((a, b) => compareMoney(b.spentToDate, a.spentToDate) || a.code.localeCompare(b.code)),
      categories: [...byCategory.entries()]
        .map(([categoryId, { name, amounts }]) => ({ categoryId, name, amount: sumMoney(amounts) }))
        .sort((a, b) => compareMoney(b.amount, a.amount)),
      cashHolders: [...holders.entries()]
        .map(([requesterId, h]) => ({ requesterId, outstanding: sumMoney(h.outstanding), open: h.open, overdue: h.overdue }))
        .sort((a, b) => compareMoney(b.outstanding, a.outstanding))
        .slice(0, TOP_HOLDERS),
      decisions: await this.decisions(decided),
    };
  }

  /**
   * The caller's decisions. A request reached their step at the action that
   * moved it there in the same revision: the requester's submission or the
   * previous step's approval, whichever came last before the decision.
   */
  private async decisions(decided: { requestId: string; revision: number; action: string; amount: Money | null; at: Date; request: { requestedAmount: Money } }[]): Promise<FinanceOverview['decisions']> {
    const approved = decided.filter((d) => d.action === 'APPROVED');
    const trimmed = approved.flatMap((d) => {
      if (d.amount === null) return [];
      const asked = d.request.requestedAmount.toFixed(2);
      const given = d.amount.toFixed(2);
      return compareMoney(given, asked) < 0 ? [subMoney(asked, given)] : [];
    });
    const arrivals = decided.length === 0 ? [] : await this.prisma.approvalAction.findMany({
      where: { requestId: { in: [...new Set(decided.map((d) => d.requestId))] }, action: { in: ['SUBMITTED', 'APPROVED'] } },
      select: { requestId: true, revision: true, at: true },
    });
    const hours = decided.flatMap((d) => {
      const before = arrivals.filter((a) => a.requestId === d.requestId && a.revision === d.revision && a.at.getTime() < d.at.getTime());
      if (before.length === 0) return [];
      return [(d.at.getTime() - Math.max(...before.map((a) => a.at.getTime()))) / 3_600_000];
    });
    return {
      approved: { count: approved.length, amount: sumMoney(approved.map((d) => (d.amount ?? d.request.requestedAmount).toFixed(2))) },
      trimmed: { count: trimmed.length, saved: sumMoney(trimmed) },
      returned: decided.filter((d) => d.action === 'RETURNED').length,
      rejected: decided.filter((d) => d.action === 'REJECTED').length,
      medianHoursToDecide: median(hours),
    };
  }
}
```

Run: `pnpm --filter finance exec vitest run src/queries/overview.service.integration.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 4: Route, with the wiring table first**

In `apps/finance/src/http/controllers.spec.ts`:
- add `import { OverviewController } from './overview.controller.js';`;
- add to `ROUTES`: `{ controller: OverviewController, handler: 'overview', verb: 'GET', path: 'finance/overview', permission: 'finance_request.view_all' },`
- change `CONTROLLERS` to `[RequestController, CategoryController, ReportController, OverviewController]`.

Run: `pnpm --filter finance exec vitest run src/http/controllers.spec.ts`
Expected: FAIL, `Failed to resolve import "./overview.controller.js"`.

Create `apps/finance/src/http/overview.controller.ts`:

```ts
import { Controller, Get, Req } from '@nestjs/common';
import { RequirePermission, type AuthzUser } from '@ipms/authz';
import { ProjectDirectoryClient, required } from '../directory/project-directory.client.js';
import { OverviewService } from '../queries/overview.service.js';

type Authed = { user: AuthzUser; headers: Record<string, string | undefined> };

/** The approver's money at a glance, reached through the gateway's `/api/v1/finance` prefix. */
@Controller('finance')
export class OverviewController {
  constructor(private readonly overviews: OverviewService, private readonly projects: ProjectDirectoryClient) {}

  @Get('overview') @RequirePermission('finance_request.view_all')
  async overview(@Req() req: Authed) {
    const scope = required(await this.projects.scope(req.headers['authorization'] ?? ''), 'Scope');
    return this.overviews.overview(req.user, scope);
  }
}
```

In `apps/finance/src/app.module.ts`:
- add imports `import { OverviewController } from './http/overview.controller.js';` and `import { OverviewService } from './queries/overview.service.js';`;
- add `OverviewController` to `controllers` after `ReportController`;
- add `service(OverviewService),` after `service(ReportService),`.

- [ ] **Step 5: Run the finance suite and typecheck**

Run: `pnpm --filter finance exec vitest run src/http src/queries && pnpm --filter finance typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/finance/src
git commit -m "feat(finance): approver overview with pipeline, queue, spend, cash out and decisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: finance — decision context on request detail

**Files:**
- Create: `apps/finance/src/queries/context.ts`
- Create: `apps/finance/src/queries/context.integration.spec.ts`
- Modify: `apps/finance/src/queries/query.service.ts` (`get`)

**Interfaces:**
- Consumes: `loadOpenAdvances` (Task 4), `requestFlags`, `standingOf`, `FlaggedRow` (Task 4), `categoryNorms`, `normKey` (Task 4), `loadClosed`, `spendByMonth` (Task 5), `recentMonths`, `DecisionContext` (Task 1), `stepOf`, `STEP_PERMISSION`.
- Produces: `decisionContext(prisma, row, actor, scope, now): Promise<DecisionContext | null>`; `GET /finance/requests/:id` gains `context` only for the approver at the request's current step.

- [ ] **Step 1: Write the failing integration test**

Create `apps/finance/src/queries/context.integration.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { RequestService } from '../requests/request.service.js';
import { QueryService } from './query.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService;
let approvals: ApprovalService;
let payments: PaymentService;
let queries: QueryService;
let categoryId: string;

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma); payments = new PaymentService(prisma); queries = new QueryService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const raise = async (amount = '1000') => {
  const r = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Travel', amount }, ACTORS.engineer, scopes.project, PROJECT);
  return requests.submit(r.id, ACTORS.engineer);
};
const reimburse = async (amount: string, n: number) => {
  const r = await requests.create({
    kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel',
    invoices: [{ vendor: 'Fuel stop', invoiceNumber: `F-${n}`, invoiceDate: new Date('2026-10-01'), amount }],
  }, ACTORS.engineer, scopes.project, PROJECT);
  return requests.submit(r.id, ACTORS.engineer);
};
const close = async (id: string) => {
  await approvals.approve(id, {}, ACTORS.pm, scopes.project);
  await approvals.approve(id, {}, ACTORS.director, scopes.project);
  await payments.pay(id, { mode: 'CASH', reference: `V-${id.slice(-6)}`, paidOn: new Date() }, ACTORS.finance, scopes.global);
};

describe('decision context', () => {
  it('goes only to the approver at the request’s step', async () => {
    const r = await raise();
    expect(await queries.get(r.id, ACTORS.engineer, scopes.project)).not.toHaveProperty('context');
    expect(await queries.get(r.id, ACTORS.director, scopes.project)).not.toHaveProperty('context');
    const forPm = await queries.get(r.id, ACTORS.pm, scopes.project);
    expect(forPm.context).toEqual({
      requester: { openAdvances: 0, outstanding: '0.00', overdue: 0, oldestOverdueDays: null },
      category: null,
      project: { thisMonth: '0.00', average3: '0.00' },
      flags: [],
    });
  });

  it('tells the approver what the requester already holds, leaving out the advance being settled', async () => {
    const held = await raise('1000'); await close(held.id);
    const settled = await raise('400'); await close(settled.id);
    const s = await requests.create({
      kind: 'SETTLEMENT', advanceId: settled.id, categoryId, purpose: 'Bills',
      invoices: [{ vendor: 'Hotel', invoiceNumber: 'H-7', invoiceDate: new Date('2026-10-01'), amount: '350' }],
    }, ACTORS.engineer, scopes.project);
    await requests.submit(s.id, ACTORS.engineer);
    const detail = await queries.get(s.id, ACTORS.pm, scopes.project);
    expect(detail.context?.requester).toEqual({ openAdvances: 1, outstanding: '1000.00', overdue: 0, oldestOverdueDays: null });
  });

  it('gives the norm for the kind and category once five have closed, and the project’s spend this month', async () => {
    for (let n = 1; n <= 5; n += 1) { const r = await reimburse(String(n * 100), n); await close(r.id); }
    const pending = await reimburse('250', 99);
    const { context } = await queries.get(pending.id, ACTORS.pm, scopes.project);
    expect(context?.category).toEqual({ median: '300.00', p25: '200.00', p75: '400.00', samples: 5 });
    expect(context?.project).toEqual({ thisMonth: '1500.00', average3: '0.00' });
  });
});
```

Run: `pnpm --filter finance exec vitest run src/queries/context.integration.spec.ts`
Expected: FAIL, `forPm.context` is undefined.

- [ ] **Step 2: Write `decisionContext`**

Create `apps/finance/src/queries/context.ts`:

```ts
import type { AuthzScope } from '@ipms/authz';
import { recentMonths, type DecisionContext } from '@ipms/contracts';
import type { PrismaClient } from '@prisma-clients/finance';
import type { Actor } from '../common.js';
import { fromMinor, sumMoney, toMinor } from '../money.js';
import { STEP_PERMISSION, stepOf } from '../workflow.js';
import { loadOpenAdvances } from './advances.js';
import { requestFlags, standingOf, type FlaggedRow } from './flags.js';
import { categoryNorms, normKey } from './norms.js';
import { loadClosed, spendByMonth } from './spend.js';

/**
 * What an approver should weigh before deciding: what the requester already
 * holds, what requests like this usually come to, and how the project's
 * spend is running. Only for the approver at the request's current step;
 * null for anyone else, the requester included.
 */
export async function decisionContext(
  prisma: PrismaClient, row: FlaggedRow & { projectId: string }, actor: Actor, scope: AuthzScope, now: Date,
): Promise<DecisionContext | null> {
  const step = stepOf(row.status);
  if (step === null || row.requesterId === actor.id || !actor.permissions.includes(STEP_PERMISSION[step])) return null;

  const months = recentMonths(now, 4);
  const since = new Date(`${months[0]!}-01T00:00:00+05:45`);
  const [open, norms, closed, flags] = await Promise.all([
    loadOpenAdvances(prisma, scope, now, [row.requesterId]),
    categoryNorms(prisma, scope, [{ kind: row.kind, categoryId: row.categoryId }], now),
    loadClosed(prisma, { projectId: row.projectId }, since),
    requestFlags(prisma, [row], scope, now),
  ]);
  const spend = spendByMonth(closed, months);
  return {
    requester: standingOf(row, open),
    category: norms.get(normKey(row.kind, row.categoryId)) ?? null,
    project: { thisMonth: spend[3] ?? '0.00', average3: fromMinor(toMinor(sumMoney(spend.slice(0, 3))) / 3n) },
    flags: flags.get(row.id) ?? [],
  };
}
```

- [ ] **Step 3: Return it from `get`**

In `apps/finance/src/queries/query.service.ts`, add the import:

```ts
import { decisionContext } from './context.js';
```

and replace the `get` method with:

```ts
  async get(id: string, actor: Actor, scope: AuthzScope, now = new Date()) {
    const row = await this.prisma.financeRequest.findUnique({
      where: { id },
      include: { invoices: true, actions: { orderBy: { at: 'asc' } }, payments: true, category: { select: { code: true, name: true } } },
    });
    if (!row || !this.mayRead(row, actor, scope)) throw notFound('Request');
    const bills = row.invoices.map((b) => ({ vendor: b.vendor, invoiceNumber: b.invoiceNumber, invoiceDate: b.invoiceDate, amount: b.amount.toFixed(2) }));
    const [duplicates, context] = await Promise.all([findDuplicates(this.prisma, id, bills), decisionContext(this.prisma, row, actor, scope, now)]);
    const detail = { ...serializeDetail(row), category: row.category, duplicates, ...(context ? { context } : {}) };
    if (row.kind !== 'ADVANCE' || row.status !== 'PAID') return detail;
    // The due day is a fact about the advance (paid day plus the window); whether it is overdue is for the reader's clock.
    return { ...detail, balance: await loadBalance(this.prisma, id), settlementDueOn: advanceSettlementDue(row, row.payments) };
  }
```

- [ ] **Step 4: Run the finance suite and typecheck**

Run: `pnpm --filter finance test && pnpm --filter finance typecheck`
Expected: PASS (all finance specs, including the existing query, approval and payment specs); typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/finance/src/queries
git commit -m "feat(finance): before-you-decide context on a request, for the approver at its step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: web — the Director's health rules (pure)

**Files:**
- Modify: `apps/web/app/projects/[id]/summary.ts` (extract `completionOf`)
- Create: `apps/web/app/overview/director-model.ts`
- Create: `apps/web/app/overview/director-model.spec.ts`

**Interfaces:**
- Consumes: `PortfolioProject`, `WorkOrderProjectSummary`, `ProjectMoney` types (Task 1).
- Produces (all exported from `director-model.ts`): `Severity`, `Signal`, `ProjectHealth`, `kathmanduToday(now)`, `nprShort(amount)`, `scheduleSignal(input, now)`, `qualitySignal(summary)`, `moneySignal(money)`, `buildPortfolio(projects, workOrders, money, now)`, `headline(waiting, health)`, `waitingFor(since, now)`, `decideTimeText(hours)`, and the threshold constants. From `summary.ts`: `completionOf({ sitesComplete, sites, completed, live }): number`.

- [ ] **Step 1: Write the failing spec**

Create `apps/web/app/overview/director-model.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PortfolioProject, ProjectMoney, WorkOrderProjectSummary } from '@ipms/contracts';
import type { ProjectDetail } from '../lib/project-api';
import { summarizeProject, type Work } from '../projects/[id]/summary';
import {
  buildPortfolio, decideTimeText, headline, moneySignal, nprShort, qualitySignal, scheduleSignal, waitingFor, type ProjectHealth,
} from './director-model';

const NOW = new Date('2026-10-10T06:00:00Z');
const YEAR = { status: 'ACTIVE', startDate: '2026-01-01T00:00:00.000Z', targetDate: '2026-12-31T00:00:00.000Z', nextMilestone: null };

describe('nprShort', () => {
  it('reads money the way a Director scans it', () => {
    expect(nprShort('45000.00')).toBe('NPR 45,000');
    expect(nprShort('240000.00')).toBe('NPR 2.4 lakh');
    expect(nprShort('300000.00')).toBe('NPR 3 lakh');
    expect(nprShort(12_500_000)).toBe('NPR 1.3 crore');
  });
});

describe('scheduleSignal', () => {
  const run = (over: Partial<Parameters<typeof scheduleSignal>[0]>) =>
    scheduleSignal({ ...YEAR, completion: 50, remaining: 10, recent: 20, ...over }, NOW);

  it('leaves a project on hold unjudged', () => {
    expect(run({ status: 'ON_HOLD' }).signal).toEqual({ label: 'On hold', severity: 'neutral', reason: 'On hold' });
  });

  it('calls a finished project complete', () => {
    expect(run({ completion: 100, remaining: 0 }).signal).toMatchObject({ label: 'Complete', severity: 'green' });
  });

  it('asks for dates when there are none', () => {
    expect(run({ targetDate: null }).signal).toEqual({ label: 'Not scheduled', severity: 'neutral', reason: 'No target date set' });
  });

  it('says a project past its target is slipping', () => {
    expect(run({ targetDate: '2026-09-30T00:00:00.000Z', completion: 78 }).signal).toEqual({ label: 'Slipping', severity: 'red', reason: 'Target was 30 Sep; 78% done' });
  });

  it('does not forecast a project in its first four weeks', () => {
    expect(run({ startDate: '2026-09-30T00:00:00.000Z', completion: 5 }).signal).toEqual({ label: 'On track', severity: 'green', reason: 'Too early to forecast; 5% done, 11% of time used' });
    expect(run({ startDate: '2026-11-01T00:00:00.000Z', completion: 0 }).signal).toEqual({ label: 'On track', severity: 'green', reason: 'Starts 1 Nov' });
  });

  it('says a project with nothing done in four weeks is stalled', () => {
    expect(run({ recent: 0 }).signal).toMatchObject({ label: 'Stalled', severity: 'red', reason: 'Nothing completed in 4 weeks' });
  });

  it('says it is slipping when the pace finishes it more than two weeks late', () => {
    const { signal, expected, behind } = run({ completion: 42, remaining: 58, recent: 4 });
    expect(expected).toBe(77);
    expect(behind).toBe(35);
    expect(signal).toEqual({ label: 'Slipping', severity: 'red', reason: '42% done, 77% of time used. At current pace finishes 20 Nov, 46 weeks after target' });
  });

  it('says it is at risk when the pace finishes it a little late', () => {
    expect(run({ targetDate: '2026-11-30T00:00:00.000Z', completion: 80, remaining: 26, recent: 14 }).signal)
      .toEqual({ label: 'At risk', severity: 'amber', reason: 'At current pace finishes 1 Dec, 1 day after target' });
  });

  it('says it is at risk when it is well behind where time says it should be', () => {
    expect(run({ completion: 50, remaining: 10, recent: 20 }).signal).toEqual({ label: 'At risk', severity: 'amber', reason: '50% done, 77% of time used' });
  });

  it('says it is on track otherwise, and names the next milestone', () => {
    const nextMilestone = { name: 'Power-on', targetDate: '2026-10-20T00:00:00.000Z', percent: 35 };
    expect(run({ completion: 80, remaining: 10, recent: 20, nextMilestone }).signal)
      .toEqual({ label: 'On track', severity: 'green', reason: 'On pace to finish by 24 Oct. Next: Power-on, due 20 Oct, 35% of sites' });
  });
});

describe('qualitySignal', () => {
  const summary = (over: Partial<WorkOrderProjectSummary>): WorkOrderProjectSummary => ({
    projectId: 'p-1', byStatus: {}, overdue: 0, approved90: 10, firstTime90: 9, reviewing: { count: 0, oldestSubmittedAt: null }, completedByWeek: [], ...over,
  });

  it('says so when there are no work orders', () => {
    expect(qualitySignal(undefined)).toEqual({ label: 'No work orders', severity: 'neutral', reason: 'No work orders yet' });
  });

  it('does not judge on fewer than five approvals', () => {
    expect(qualitySignal(summary({ approved90: 4, firstTime90: 1 }))).toMatchObject({ label: 'Not enough reviews', severity: 'neutral', reason: '4 approvals in 90 days' });
  });

  it('is a concern below 70% first time, and names the rework and the overdue', () => {
    expect(qualitySignal(summary({ approved90: 25, firstTime90: 17, byStatus: { RECTIFYING: 4 }, overdue: 2 })))
      .toEqual({ label: 'Concern', severity: 'red', reason: '68% approved first time; 4 in rework, 2 overdue' });
  });

  it('is one to watch below 85%, and good above', () => {
    expect(qualitySignal(summary({ approved90: 10, firstTime90: 8 }))).toMatchObject({ label: 'Watch', severity: 'amber' });
    expect(qualitySignal(summary({ approved90: 10, firstTime90: 9 }))).toMatchObject({ label: 'Good', severity: 'green', reason: '90% approved first time' });
  });
});

describe('moneySignal', () => {
  const money = (spentByMonth: string[], over: Partial<ProjectMoney> = {}): ProjectMoney => ({
    projectId: 'p-1', code: 'KOS', name: 'Koshi', spentToDate: '0.00', spentByMonth, cashHeld: '0.00', overdueSettlements: { count: 0, amount: '0.00' }, ...over,
  });

  it('watches a month well above the usual, and cash gone past its day', () => {
    expect(moneySignal(money(['0', '0', '100000', '100000', '100000', '320000'], { cashHeld: '45000.00', overdueSettlements: { count: 1, amount: '45000.00' } })))
      .toEqual({ label: 'Watch', severity: 'amber', reason: 'NPR 3.2 lakh this month, 3.2× usual; NPR 45,000 with engineers, 1 settlement overdue' });
  });

  it('ignores a jump smaller than NPR 50,000', () => {
    expect(moneySignal(money(['0', '0', '10000', '10000', '10000', '30000']))).toEqual({ label: 'Good', severity: 'green', reason: 'NPR 30,000 this month' });
  });

  it('says so when nothing has been spent', () => {
    expect(moneySignal(undefined)).toMatchObject({ label: 'No spend', severity: 'neutral' });
  });
});

describe('buildPortfolio', () => {
  const project = (over: Partial<PortfolioProject> = {}): PortfolioProject => ({
    id: 'p-1', code: 'KOS', name: 'Koshi', ...YEAR, status: 'ACTIVE',
    sites: { total: 4, byStatus: {} }, tasks: { live: 6, completed: 3, overdue: 0, byStatus: {} },
    sitesComplete: null, nextMilestone: null, completedByWeek: [0, 0, 0, 0, 5, 5, 5, 5], ...over,
  });
  const wo = (over: Partial<WorkOrderProjectSummary> = {}): WorkOrderProjectSummary => ({
    projectId: 'p-1', byStatus: { COMPLETED: 1, ONGOING: 1, CANCELLED: 2 }, overdue: 0, approved90: 0, firstTime90: 0,
    reviewing: { count: 0, oldestSubmittedAt: null }, completedByWeek: [], ...over,
  });

  it('adds work orders to tasks when no milestone declares requirements, as the project page does', () => {
    expect(buildPortfolio([project()], [wo()], null, NOW)[0]!.completion).toBe(50);
    expect(buildPortfolio([project({ sitesComplete: 3 })], [wo()], null, NOW)[0]!.completion).toBe(75);
  });

  it('agrees with summarizeProject on the same work', () => {
    const detail = { id: 'p-1', sites: [{ id: 's-1', siteCode: 'S1', status: 'PLANNED', region: null }, { id: 's-2', siteCode: 'S2', status: 'PLANNED', region: null }], milestones: [], taskTypes: [] } as unknown as ProjectDetail;
    const work = (id: string, status: Work['status'], order: boolean): Work => ({
      id, siteId: 's-1', title: id, status, assigneeId: null, plannedCompletionAt: null, taskTypeId: order ? null : 'tt-1', workOrderType: order ? 'QUALITY_SELF_CHECK' : null,
    });
    const page = summarizeProject(detail, [work('t1', 'COMPLETED', false), work('t2', 'ONGOING', false), work('w1', 'COMPLETED', true), work('w2', 'CANCELLED', true)], NOW);
    const portfolio = buildPortfolio([project({ tasks: { live: 2, completed: 1, overdue: 0, byStatus: {} } })], [wo({ byStatus: { COMPLETED: 1, CANCELLED: 1 } })], null, NOW);
    expect(portfolio[0]!.completion).toBe(page.completion);
  });

  it('marks completion partial and quality unknown when qc did not answer', () => {
    const [health] = buildPortfolio([project()], null, null, NOW);
    expect(health).toMatchObject({ partial: true, quality: null, money: null });
  });

  it('takes the worst signal as the standing, and puts the worst first', () => {
    const late = project({ id: 'p-2', code: 'LATE', targetDate: '2026-09-30T00:00:00.000Z' });
    const fine = project({ id: 'p-3', code: 'FINE', tasks: { live: 6, completed: 6, overdue: 0, byStatus: {} } });
    const result = buildPortfolio([fine, late], [], [], NOW);
    expect(result.map((h) => h.code)).toEqual(['LATE', 'FINE']);
    expect(result[0]!.standing).toBe('red');
  });
});

describe('headline', () => {
  const health = (severity: ProjectHealth['schedule']['severity']) => ({ schedule: { label: '', severity, reason: '' } }) as ProjectHealth;

  it('leads with what waits, then the projects slipping', () => {
    expect(headline({ count: 3, amount: '240000.00' }, [health('red'), health('red'), health('green')])).toBe('3 requests worth NPR 2.4 lakh wait on you · 2 of 3 projects slipping.');
  });

  it('falls back to at risk, then to every project on track', () => {
    expect(headline({ count: 1, amount: '5000.00' }, [health('amber')])).toBe('1 request worth NPR 5,000 waits on you · 1 of 1 project at risk.');
    expect(headline({ count: 0, amount: '0.00' }, [health('green')])).toBe('Nothing waits on you · every project is on track.');
  });

  it('leaves out what it cannot know', () => {
    expect(headline(null, [health('green')])).toBe('every project is on track.');
    expect(headline(null, [])).toBe('');
  });
});

describe('waitingFor and decideTimeText', () => {
  it('counts whole Kathmandu days', () => {
    expect(waitingFor('2026-10-10T01:00:00Z', NOW)).toBe('today');
    expect(waitingFor('2026-10-05T06:00:00Z', NOW)).toBe('5 days');
    expect(waitingFor(null, NOW)).toBe('—');
  });

  it('says how long decisions take in hours or days', () => {
    expect(decideTimeText(0.4)).toBe('under an hour');
    expect(decideTimeText(4)).toBe('4 h');
    expect(decideTimeText(60)).toBe('3 days');
  });
});
```

Run: `pnpm --filter web exec vitest run app/overview/director-model.spec.ts`
Expected: FAIL, `Failed to resolve import "./director-model"`.

- [ ] **Step 2: Extract the shared completion rule**

In `apps/web/app/projects/[id]/summary.ts`, add directly after the `const percent = ...` line:

```ts
/**
 * A project's completion, as its page and the Director's portfolio both show
 * it: sites that met every milestone requirement when some milestone declares
 * requirements, otherwise completed work over live work.
 */
export function completionOf(units: { sitesComplete: number | null; sites: number; completed: number; live: number }): number {
  return units.sitesComplete === null ? percent(units.completed, units.live) : percent(units.sitesComplete, units.sites);
}
```

and in `summarizeProject`'s returned object replace

```ts
    completion: sitesComplete === null ? percent(completed.length, live.length) : percent(sitesComplete, project.sites.length),
```

with

```ts
    completion: completionOf({ sitesComplete, sites: project.sites.length, completed: completed.length, live: live.length }),
```

- [ ] **Step 3: Write `director-model.ts`**

Create `apps/web/app/overview/director-model.ts`:

```ts
import type { PortfolioProject, ProjectMoney, WorkOrderProjectSummary } from '@ipms/contracts';
import { completionOf } from '../projects/[id]/summary';

/** Every threshold the Director's home judges by. Pure module: given `now`, never reads the clock. */
export const PACE_WEEKS = 4;
export const EARLY_DAYS = 28;
export const LATE_GRACE_DAYS = 14;
export const BEHIND_POINTS = 15;
export const FIRST_TIME_CONCERN = 70;
export const FIRST_TIME_WATCH = 85;
export const MIN_APPROVALS = 5;
export const SPIKE_RATIO = 1.5;
export const SPIKE_MIN = 50_000;

export type Severity = 'red' | 'amber' | 'green' | 'neutral';
export interface Signal { label: string; severity: Severity; reason: string }

export interface ProjectHealth {
  id: string; code: string; name: string;
  completion: number;
  /** Where the project should be by now, 0–100; null without a start and target date. */
  expected: number | null;
  behind: number;
  /** Completion leaves out work orders because qc did not answer. */
  partial: boolean;
  schedule: Signal;
  /** Null when qc did not answer. */
  quality: Signal | null;
  /** Null when finance did not answer. */
  money: Signal | null;
  standing: Severity;
}

const DAY_MS = 86_400_000;
const OFFSET_MS = 345 * 60_000;
const RANK: Record<Severity, number> = { red: 3, amber: 2, green: 1, neutral: 0 };

/** Today in Kathmandu as UTC midnight, so whole-day arithmetic is exact. Mirrors kathmanduDay in @ipms/contracts. */
export function kathmanduToday(now: Date): Date {
  const shifted = new Date(now.getTime() + OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}
const dayOf = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const daysBetween = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / DAY_MS);
const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);
const dayText = (date: Date): string => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const lateText = (days: number): string => (days >= 14 ? plural(Math.round(days / 7), 'week') : plural(days, 'day'));
const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

/** "NPR 2.4 lakh", "NPR 1.3 crore", "NPR 45,000": money as a Director scans it. */
export function nprShort(amount: string | number): string {
  const value = Number(amount);
  const short = (n: number, unit: string) => `NPR ${n.toFixed(1).replace(/\.0$/, '')} ${unit}`;
  if (value >= 10_000_000) return short(value / 10_000_000, 'crore');
  if (value >= 100_000) return short(value / 100_000, 'lakh');
  return `NPR ${Math.round(value).toLocaleString('en-IN')}`;
}

export interface ScheduleInput {
  status: string;
  startDate: string | null;
  targetDate: string | null;
  completion: number;
  remaining: number;
  /** Units completed in the last 28 days. */
  recent: number;
  nextMilestone: PortfolioProject['nextMilestone'];
}

/** The schedule signal: the spec's rules in order, first match wins. */
export function scheduleSignal(input: ScheduleInput, now: Date): { signal: Signal; expected: number | null; behind: number } {
  const today = kathmanduToday(now);
  const start = input.startDate ? dayOf(input.startDate) : null;
  const target = input.targetDate ? dayOf(input.targetDate) : null;
  let expected: number | null = null;
  if (start && target) {
    const span = daysBetween(start, target);
    const share = span <= 0 ? (today >= start ? 1 : 0) : daysBetween(start, today) / span;
    expected = Math.round(Math.min(1, Math.max(0, share)) * 100);
  }
  const behind = expected === null ? 0 : expected - input.completion;
  const progress = `${input.completion}% done, ${expected ?? 0}% of time used`;
  const milestone = input.nextMilestone;
  const next = milestone?.targetDate ? `. Next: ${milestone.name}, due ${dayText(dayOf(milestone.targetDate))}, ${milestone.percent}% of sites` : '';
  const result = (label: string, severity: Severity, reason: string) => ({ signal: { label, severity, reason }, expected, behind });

  if (input.status === 'ON_HOLD') return result('On hold', 'neutral', 'On hold');
  if (input.completion >= 100) return result('Complete', 'green', 'All work complete');
  if (!start || !target) return result('Not scheduled', 'neutral', !target ? 'No target date set' : 'No start date set');
  if (today > target) return result('Slipping', 'red', `Target was ${dayText(target)}; ${input.completion}% done`);
  if (daysBetween(start, today) < EARLY_DAYS) {
    if (today < start) return result('On track', 'green', `Starts ${dayText(start)}`);
    const atRisk = behind > BEHIND_POINTS;
    return result(atRisk ? 'At risk' : 'On track', atRisk ? 'amber' : 'green', `Too early to forecast; ${progress}`);
  }
  if (input.recent === 0) return result('Stalled', 'red', `Nothing completed in 4 weeks${next}`);
  // Whole-number arithmetic: remaining units at the 28-day pace, in days.
  const forecast = addDays(today, Math.ceil((input.remaining * PACE_WEEKS * 7) / input.recent));
  const late = daysBetween(target, forecast);
  if (late > LATE_GRACE_DAYS) return result('Slipping', 'red', `${progress}. At current pace finishes ${dayText(forecast)}, ${lateText(late)} after target${next}`);
  if (late > 0) return result('At risk', 'amber', `At current pace finishes ${dayText(forecast)}, ${lateText(late)} after target${next}`);
  if (behind > BEHIND_POINTS) return result('At risk', 'amber', `${progress}${next}`);
  return result('On track', 'green', `On pace to finish by ${dayText(forecast)}${next}`);
}

/** Quality from the project's work orders: first-time approval over 90 days. */
export function qualitySignal(summary: WorkOrderProjectSummary | undefined): Signal {
  if (!summary) return { label: 'No work orders', severity: 'neutral', reason: 'No work orders yet' };
  const rework = summary.byStatus['RECTIFYING'] ?? 0;
  const extras = [rework > 0 ? `${rework} in rework` : '', summary.overdue > 0 ? `${summary.overdue} overdue` : ''].filter(Boolean).join(', ');
  const tail = extras ? `; ${extras}` : '';
  if (summary.approved90 < MIN_APPROVALS) return { label: 'Not enough reviews', severity: 'neutral', reason: `${plural(summary.approved90, 'approval')} in 90 days${tail}` };
  const rate = Math.round((summary.firstTime90 / summary.approved90) * 100);
  const reason = `${rate}% approved first time${tail}`;
  if (rate < FIRST_TIME_CONCERN) return { label: 'Concern', severity: 'red', reason };
  if (rate < FIRST_TIME_WATCH) return { label: 'Watch', severity: 'amber', reason };
  return { label: 'Good', severity: 'green', reason };
}

/** Money: a month well above the 3 before it, and cash past its settle-by day. */
export function moneySignal(money: ProjectMoney | undefined): Signal {
  if (!money) return { label: 'No spend', severity: 'neutral', reason: 'No spend recorded yet' };
  const months = money.spentByMonth.map(Number);
  const thisMonth = months[months.length - 1] ?? 0;
  const usual = sum(months.slice(-4, -1)) / 3;
  const spike = thisMonth > SPIKE_RATIO * usual && thisMonth - usual >= SPIKE_MIN;
  const late = money.overdueSettlements.count;
  const cash = Number(money.cashHeld);
  const parts = [`${nprShort(thisMonth)} this month${spike ? (usual > 0 ? `, ${(thisMonth / usual).toFixed(1)}× usual` : ', none in the 3 months before') : ''}`];
  if (cash > 0) parts.push(`${nprShort(cash)} with engineers${late > 0 ? `, ${plural(late, 'settlement')} overdue` : ''}`);
  const watch = spike || late > 0;
  return { label: watch ? 'Watch' : 'Good', severity: watch ? 'amber' : 'green', reason: parts.join('; ') };
}

/**
 * One row per project, worst standing first. Completion uses the project
 * page's rule, adding work orders to tasks when no milestone declares
 * requirements. `workOrders` or `money` is null when that service did not answer.
 */
export function buildPortfolio(
  projects: readonly PortfolioProject[],
  workOrders: readonly WorkOrderProjectSummary[] | null,
  money: readonly ProjectMoney[] | null,
  now: Date,
): ProjectHealth[] {
  const recentOf = (weeks: readonly number[]) => sum(weeks.slice(-PACE_WEEKS));
  return projects.map((project) => {
    const wo = workOrders?.find((w) => w.projectId === project.id);
    const byMilestones = project.sitesComplete !== null;
    const woLive = wo ? sum(Object.entries(wo.byStatus).flatMap(([status, n]) => (status === 'CANCELLED' ? [] : [n]))) : 0;
    const completed = project.tasks.completed + (byMilestones ? 0 : wo?.byStatus['COMPLETED'] ?? 0);
    const live = project.tasks.live + (byMilestones ? 0 : woLive);
    const completion = completionOf({ sitesComplete: project.sitesComplete, sites: project.sites.total, completed, live });
    const remaining = byMilestones ? project.sites.total - (project.sitesComplete ?? 0) : live - completed;
    const recent = recentOf(project.completedByWeek) + (byMilestones || !wo ? 0 : recentOf(wo.completedByWeek));
    const { signal: schedule, expected, behind } = scheduleSignal({
      status: project.status, startDate: project.startDate, targetDate: project.targetDate, completion, remaining, recent, nextMilestone: project.nextMilestone,
    }, now);
    const quality = workOrders === null ? null : qualitySignal(wo);
    const spend = money === null ? null : moneySignal(money.find((m) => m.projectId === project.id));
    const standing = [schedule, quality, spend].reduce<Severity>((worst, s) => (s && RANK[s.severity] > RANK[worst] ? s.severity : worst), 'neutral');
    return { id: project.id, code: project.code, name: project.name, completion, expected, behind, partial: workOrders === null && !byMilestones, schedule, quality, money: spend, standing };
  }).sort((a, b) => RANK[b.standing] - RANK[a.standing] || b.behind - a.behind || a.code.localeCompare(b.code));
}

/** The header's one sentence: what waits on the viewer, then how the projects are doing. */
export function headline(waiting: { count: number; amount: string } | null, health: readonly ProjectHealth[]): string {
  const parts: string[] = [];
  if (waiting) {
    parts.push(waiting.count === 0 ? 'Nothing waits on you' : `${plural(waiting.count, 'request')} worth ${nprShort(waiting.amount)} ${waiting.count === 1 ? 'waits' : 'wait'} on you`);
  }
  const slipping = health.filter((h) => h.schedule.severity === 'red').length;
  const atRisk = health.filter((h) => h.schedule.severity === 'amber').length;
  if (slipping > 0) parts.push(`${slipping} of ${plural(health.length, 'project')} slipping`);
  else if (atRisk > 0) parts.push(`${atRisk} of ${plural(health.length, 'project')} at risk`);
  else if (health.length > 0) parts.push('every project is on track');
  return parts.length === 0 ? '' : `${parts.join(' · ')}.`;
}

/** "today", "1 day", "5 days": how long something has waited, in Kathmandu days. */
export function waitingFor(since: string | null, now: Date): string {
  if (!since) return '—';
  const days = daysBetween(kathmanduToday(new Date(since)), kathmanduToday(now));
  return days <= 0 ? 'today' : plural(days, 'day');
}

/** "under an hour", "4 h", "3 days". */
export function decideTimeText(hours: number): string {
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${Math.round(hours)} h`;
  return plural(Math.round(hours / 24), 'day');
}
```

- [ ] **Step 4: Run the specs**

Run: `pnpm --filter web exec vitest run app/overview/director-model.spec.ts app/projects`
Expected: PASS (the new spec and the existing project summary spec).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/overview/director-model.ts apps/web/app/overview/director-model.spec.ts "apps/web/app/projects/[id]/summary.ts"
git commit -m "feat(web): health rules for the Project Director's portfolio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: web — flags on the finance queue and a Decided by me tab

**Files:**
- Modify: `apps/web/app/lib/finance-api.ts`
- Modify: `apps/web/app/finance/model.ts`
- Modify: `apps/web/app/finance/model.spec.ts`
- Modify: `apps/web/app/finance/search.ts`
- Modify: `apps/web/app/finance/search.spec.ts`
- Modify: `apps/web/app/finance/page.tsx`
- Modify: `apps/web/app/finance/requests-table.tsx`
- Modify: `apps/web/app/finance/requests-table.spec.tsx`
- Modify: `apps/web/app/finance/finance.css`

**Interfaces:**
- Consumes: `RequestFlag`, `DecisionContext`, `FinanceOverview` types (Task 1); service behaviour from Tasks 4–6.
- Produces: `RequestView` includes `'handled'`; `FinanceRequest.flags?: RequestFlag[]`; `FinanceRequestDetail.context?: DecisionContext`; `getFinanceOverview(): Promise<ApiResult<FinanceOverview>>`; `flagText(flag: RequestFlag): string` and `decisionLine(request, viewerId): string | null` in `finance/model.ts`; `resolveSearch(search, { mayAct, seeAll, mayRaise })`; `RawSearch.decided?: string`; CSS classes `finance-flags`, `finance-decided`, `finance-context`.

- [ ] **Step 1: Write the failing specs**

Append to `apps/web/app/finance/model.spec.ts` (and add `decisionLine, flagText` to its import from `./model`):

```ts
describe('flagText', () => {
  it('phrases each flag', () => {
    expect(flagText({ code: 'DUPLICATE_BILL', tone: 'red', matches: [{ requestId: 'r-2', number: 'REI-2026-0031' }] })).toBe('Possible duplicate bill: also on REI-2026-0031');
    expect(flagText({ code: 'REQUESTER_HOLDS_CASH', tone: 'amber', outstanding: '45000.00', advances: 2, overdue: 0, oldestOverdueDays: null })).toBe('Already holds NPR 45,000.00 from 2 advances');
    expect(flagText({ code: 'REQUESTER_HOLDS_CASH', tone: 'red', outstanding: '45000.00', advances: 2, overdue: 1, oldestOverdueDays: 9 })).toBe('Already holds NPR 45,000.00 from 2 advances, one 9 days past settle-by');
    expect(flagText({ code: 'REQUESTER_HOLDS_CASH', tone: 'red', outstanding: '9000.00', advances: 3, overdue: 2, oldestOverdueDays: 12 })).toBe('Already holds NPR 9,000.00 from 3 advances, 2 past settle-by (oldest 12 days)');
    expect(flagText({ code: 'UNUSUAL_AMOUNT', tone: 'amber', ratio: 3, median: '1000.00', category: 'Fuel' })).toBe('About 3× the usual for Fuel');
    expect(flagText({ code: 'WAITING_LONG', tone: 'amber', days: 5 })).toBe('Waiting 5 days');
  });
});

describe('decisionLine', () => {
  const action = (over: Record<string, unknown>) => ({ id: 'a', requestId: 'r-1', revision: 1, step: 'DIRECTOR', action: 'APPROVED', actorId: 'u-dir', amount: null, comment: null, at: '2026-10-10T06:00:00Z', ...over }) as never;

  it('confirms what the viewer just decided', () => {
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [action({ amount: '40000.00' })] }, 'u-dir')).toBe('ADV-2026-0012 approved for NPR 40,000.00.');
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [action({ step: 'PM', actorId: 'u-pm' })] }, 'u-pm')).toBe('ADV-2026-0012 approved.');
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [action({ action: 'RETURNED' })] }, 'u-dir')).toBe('ADV-2026-0012 returned to the requester.');
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [action({ action: 'REJECTED' })] }, 'u-dir')).toBe('ADV-2026-0012 rejected.');
  });

  it('says nothing when the last step was not the viewer’s', () => {
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [action({ actorId: 'someone-else' })] }, 'u-dir')).toBeNull();
    expect(decisionLine({ number: 'ADV-2026-0012', actions: [] }, 'u-dir')).toBeNull();
  });
});
```

In `apps/web/app/finance/search.spec.ts`, replace the three capability constants and the first test with:

```ts
const ENG = { mayAct: false, seeAll: false, mayRaise: true };
const PM = { mayAct: true, seeAll: false, mayRaise: true };
const FIN = { mayAct: true, seeAll: true, mayRaise: false };
const PM_ALL = { mayAct: true, seeAll: true, mayRaise: true };

describe('resolveSearch', () => {
  it('only offers the tabs the viewer may use', () => {
    expect(resolveSearch({}, ENG).tabs).toEqual(['mine']);
    expect(resolveSearch({}, PM).tabs).toEqual(['awaiting', 'mine']);
    expect(resolveSearch({}, FIN).tabs).toEqual(['awaiting', 'handled', 'all']);
    expect(resolveSearch({}, PM_ALL).tabs).toEqual(['awaiting', 'handled', 'mine', 'all']);
  });

  it('opens Decided by me for an approver who sees every request', () => {
    expect(resolveSearch({ view: 'handled' }, FIN).view).toBe('handled');
    expect(resolveSearch({ view: 'handled' }, PM).view).toBe('awaiting');
  });
```

(Leave the other existing tests in place; `ENG`, `PM` and `FIN` keep their names.)

In `apps/web/app/finance/requests-table.spec.tsx`, replace the `'says so when nothing is waiting'` test with:

```tsx
  it('says the queue is clear when nothing is waiting, and plainly empty elsewhere', () => {
    expect(html([])).toContain('All caught up. Nothing is waiting for you.');
    expect(renderToStaticMarkup(<RequestsTable page={page([])} names={names} view="mine" />)).toContain('Nothing here yet.');
  });

  it('shows the flags a waiting request carries', () => {
    const out = html([row({ flags: [{ code: 'WAITING_LONG', tone: 'amber', days: 5 }] })]);
    expect(out).toContain('finance-flags');
    expect(out).toContain('Waiting 5 days');
  });
```

Run: `pnpm --filter web exec vitest run app/finance`
Expected: FAIL (`flagText`/`decisionLine` not exported; new tab order; empty text; flags).

- [ ] **Step 2: Types and the overview client**

In `apps/web/app/lib/finance-api.ts`:
- change the contracts import to `import type { DecisionContext, FinanceOverview, RequestFlag, RequestKind, RequestStatus } from '@ipms/contracts';` and the re-export to `export type { DecisionContext, FinanceOverview, RequestFlag, RequestKind, RequestStatus };`
- add to `FinanceRequest`, after `category?: { code: string; name: string };`:

```ts
  /** Warnings, on rows of the awaiting view only. */
  flags?: RequestFlag[];
```

- add to `FinanceRequestDetail`, after `settlementDueOn?: string | null;`:

```ts
  /** "Before you decide": present only for the approver at the request's current step. */
  context?: DecisionContext;
```

- change `export type RequestView = 'mine' | 'awaiting' | 'all';` to:

```ts
export type RequestView = 'mine' | 'awaiting' | 'all' | 'handled';
```

- add after `getAdvance`:

```ts
/** The approver's money at a glance: pipeline, queue, spend, cash out and their decisions. */
export const getFinanceOverview = (): Promise<ApiResult<FinanceOverview>> => authFetch(`${BASE}/overview`);
```

- [ ] **Step 3: `flagText` and `decisionLine`**

In `apps/web/app/finance/model.ts`, change the first import to:

```ts
import type { FinanceRequest, FinanceRequestDetail, FinanceStep, RequestFlag } from '../lib/finance-api';
```

and append:

```ts
/** One warning as a sentence. */
export function flagText(flag: RequestFlag): string {
  switch (flag.code) {
    case 'DUPLICATE_BILL':
      return `Possible duplicate bill: also on ${flag.matches.map((m) => m.number).join(', ')}`;
    case 'REQUESTER_HOLDS_CASH': {
      const held = `Already holds ${formatMoney(flag.outstanding)} from ${flag.advances} advance${flag.advances === 1 ? '' : 's'}`;
      if (flag.overdue === 0) return held;
      if (flag.overdue === 1) return `${held}, one ${flag.oldestOverdueDays} days past settle-by`;
      return `${held}, ${flag.overdue} past settle-by (oldest ${flag.oldestOverdueDays} days)`;
    }
    case 'UNUSUAL_AMOUNT':
      return `About ${flag.ratio}× the usual for ${flag.category}`;
    case 'WAITING_LONG':
      return `Waiting ${flag.days} days`;
  }
}

/**
 * "ADV-2026-0012 approved for NPR 40,000.00." — what the viewer just decided,
 * read from the request's own history; null when its last step is not theirs.
 */
export function decisionLine(request: Pick<FinanceRequestDetail, 'number' | 'actions'>, viewerId: string): string | null {
  const last = request.actions[request.actions.length - 1];
  if (!last || last.actorId !== viewerId) return null;
  if (last.action === 'APPROVED') return `${request.number} approved${last.amount ? ` for ${formatMoney(last.amount)}` : ''}.`;
  if (last.action === 'RETURNED') return `${request.number} returned to the requester.`;
  if (last.action === 'REJECTED') return `${request.number} rejected.`;
  return null;
}
```

- [ ] **Step 4: Tabs**

Replace `apps/web/app/finance/search.ts` body below the constants with:

```ts
export interface RawSearch { view?: string; status?: string; kind?: string; page?: string; decided?: string }
export interface Resolved { view: RequestView; status?: RequestStatus; kind?: RequestKind; page: number; tabs: RequestView[] }

/**
 * The workspace's query string, checked: only tabs the viewer may use, only
 * known filters, a whole page number. Approvers who see every request get
 * Decided by me; only people who raise requests get My requests.
 */
export function resolveSearch(search: RawSearch, caps: { mayAct: boolean; seeAll: boolean; mayRaise: boolean }): Resolved {
  const tabs: RequestView[] = [];
  if (caps.mayAct) tabs.push('awaiting');
  if (caps.mayAct && caps.seeAll) tabs.push('handled');
  if (caps.mayRaise || !caps.mayAct) tabs.push('mine');
  if (caps.seeAll) tabs.push('all');
  const view = tabs.find((tab) => tab === search.view) ?? (caps.mayAct ? 'awaiting' : 'mine');
  const status = STATUSES.find((s) => s === search.status);
  const kind = KINDS.find((k) => k === search.kind);
  return {
    view, tabs,
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    page: Math.max(1, Math.floor(Number(search.page)) || 1),
  };
}
```

In `apps/web/app/finance/page.tsx`:
- change `LABEL` to `const LABEL: Record<RequestView, string> = { awaiting: 'Waiting for me', handled: 'Decided by me', mine: 'My requests', all: 'All requests' };`
- change the `resolveSearch` call to `resolveSearch(search, { mayAct, seeAll, mayRaise })`.

- [ ] **Step 5: Flags in the table, and styles**

In `apps/web/app/finance/requests-table.tsx`:
- change the model import to `import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, flagText, formatMoney, personName } from './model';`
- replace the empty-state line with:

```tsx
  if (page.items.length === 0) return <p className="finance-empty">{view === 'awaiting' ? 'All caught up. Nothing is waiting for you.' : 'Nothing here yet.'}</p>;
```

- replace the first `<td>` of each row with:

```tsx
                <td>
                  <a href={`/finance/requests/${request.id}`}><strong>{request.number}</strong></a><span className="subtle">{KIND_LABEL[request.kind]}</span>
                  {request.flags && request.flags.length > 0 ? (
                    <ul className="finance-flags" aria-label="Warnings">
                      {request.flags.map((flag) => <li key={flag.code} className={flag.tone}>{flagText(flag)}</li>)}
                    </ul>
                  ) : null}
                </td>
```

Append to `apps/web/app/finance/finance.css`:

```css
.finance-flags { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 3px; font-size: 12px; font-weight: 600; }
.finance-flags li.red { color: var(--red); }
.finance-flags li.amber { color: var(--amber); }
.finance-decided { margin: 0 0 14px; padding: 10px 14px; border-radius: 8px; background: color-mix(in srgb, var(--green) 12%, transparent); color: var(--ink); font-size: 14px; font-weight: 600; }
.finance-context { border-left: 4px solid var(--blue); }
.finance-context .finance-flags { margin: 0 0 12px; }
```

- [ ] **Step 6: Run the web finance specs and typecheck**

Run: `pnpm --filter web exec vitest run app/finance && pnpm --filter web typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/lib/finance-api.ts apps/web/app/finance
git commit -m "feat(web): flags on the finance queue and a Decided by me tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: web — "Before you decide" and the decision confirmation

**Files:**
- Create: `apps/web/app/finance/requests/[id]/context-panel.tsx`
- Create: `apps/web/app/finance/requests/[id]/context-panel.spec.tsx`
- Create: `apps/web/app/finance/decided.tsx`
- Create: `apps/web/app/finance/decided.spec.tsx`
- Modify: `apps/web/app/finance/requests/[id]/page.tsx`

**Interfaces:**
- Consumes: `DecisionContext` (Task 1), `flagText`, `decisionLine`, `formatMoney` (Task 8), `getRequest`.
- Produces: `ContextPanel({ context, category, project })`; `DecidedNotice({ id, viewerId }): Promise<JSX | null>` (async server component, renders `p.finance-decided`).

- [ ] **Step 1: Write the failing specs**

Create `apps/web/app/finance/requests/[id]/context-panel.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DecisionContext } from '@ipms/contracts';
import { ContextPanel } from './context-panel';

const context = (over: Partial<DecisionContext> = {}): DecisionContext => ({
  requester: { openAdvances: 0, outstanding: '0.00', overdue: 0, oldestOverdueDays: null },
  category: null,
  project: { thisMonth: '120000.00', average3: '80000.00' },
  flags: [],
  ...over,
});
const html = (c: DecisionContext) => renderToStaticMarkup(<ContextPanel context={c} category="Fuel" project="Koshi Rollout" />);

describe('ContextPanel', () => {
  it('says what the requester holds, what is usual and how the project is spending', () => {
    const out = html(context({
      requester: { openAdvances: 2, outstanding: '45000.00', overdue: 1, oldestOverdueDays: 9 },
      category: { median: '3000.00', p25: '2000.00', p75: '4500.00', samples: 12 },
    }));
    expect(out).toContain('Before you decide');
    expect(out).toContain('Holds NPR 45,000.00 from 2 open advances, 1 overdue (oldest 9 days).');
    expect(out).toContain('NPR 2,000.00 to NPR 4,500.00, median NPR 3,000.00 (12 requests in 180 days).');
    expect(out).toContain('NPR 1,20,000.00 spent; NPR 80,000.00 a month on average over the 3 months before.');
  });

  it('says plainly when there is nothing to compare, and lists flags first', () => {
    const out = html(context({ flags: [{ code: 'WAITING_LONG', tone: 'amber', days: 4 }] }));
    expect(out).toContain('Holds no unsettled advances.');
    expect(out).toContain('Too few closed requests like this to compare.');
    expect(out.indexOf('Waiting 4 days')).toBeLessThan(out.indexOf('Requester'));
  });
});
```

Create `apps/web/app/finance/decided.spec.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const getRequest = vi.fn();
vi.mock('../lib/finance-api', () => ({ getRequest }));
const { DecidedNotice } = await import('./decided');

const ID = '0192f7a0-0000-7000-8000-000000000001';
const detail = { number: 'ADV-2026-0012', actions: [{ id: 'a', requestId: ID, revision: 1, step: 'DIRECTOR', action: 'APPROVED', actorId: 'u-dir', amount: '40000.00', comment: null, at: '2026-10-10T06:00:00Z' }] };

beforeEach(() => { getRequest.mockReset().mockResolvedValue({ state: 'ready', data: detail }); });

describe('DecidedNotice', () => {
  it('confirms the decision from a fresh read of the request', async () => {
    const out = renderToStaticMarkup(await DecidedNotice({ id: ID, viewerId: 'u-dir' }));
    expect(getRequest).toHaveBeenCalledWith(ID);
    expect(out).toContain('ADV-2026-0012 approved for NPR 40,000.00.');
    expect(out).toContain('role="status"');
  });

  it('renders nothing for no id, an id that is not a uuid, or a request that cannot be read', async () => {
    expect(await DecidedNotice({ id: undefined, viewerId: 'u-dir' })).toBeNull();
    expect(await DecidedNotice({ id: '../overview', viewerId: 'u-dir' })).toBeNull();
    expect(getRequest).not.toHaveBeenCalled();
    getRequest.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    expect(await DecidedNotice({ id: ID, viewerId: 'u-dir' })).toBeNull();
  });
});
```

Run: `pnpm --filter web exec vitest run app/finance/decided.spec.tsx "app/finance/requests/[id]/context-panel.spec.tsx"`
Expected: FAIL, modules not found.

- [ ] **Step 2: Write the two components**

Create `apps/web/app/finance/requests/[id]/context-panel.tsx`:

```tsx
import type { DecisionContext } from '@ipms/contracts';
import { flagText, formatMoney } from '../../model';

/** "Before you decide": what the approver at this step should weigh. Shown only when the service sends it. */
export function ContextPanel({ context, category, project }: { context: DecisionContext; category: string; project: string }) {
  const { requester, category: norm } = context;
  const holds = requester.openAdvances === 0
    ? 'Holds no unsettled advances.'
    : `Holds ${formatMoney(requester.outstanding)} from ${requester.openAdvances} open advance${requester.openAdvances === 1 ? '' : 's'}${requester.overdue > 0 ? `, ${requester.overdue} overdue (oldest ${requester.oldestOverdueDays} days)` : ''}.`;
  return (
    <section className="panel finance-facts finance-context" aria-labelledby="before-you-decide">
      <h2 id="before-you-decide">Before you decide</h2>
      {context.flags.length > 0 ? (
        <ul className="finance-flags" aria-label="Warnings">
          {context.flags.map((flag) => <li key={flag.code} className={flag.tone}>{flagText(flag)}</li>)}
        </ul>
      ) : null}
      <dl>
        <dt>Requester</dt>
        <dd>{holds}</dd>
        <dt>Usual for {category}</dt>
        <dd>{norm ? `${formatMoney(norm.p25)} to ${formatMoney(norm.p75)}, median ${formatMoney(norm.median)} (${norm.samples} requests in 180 days).` : 'Too few closed requests like this to compare.'}</dd>
        <dt>{project} this month</dt>
        <dd>{`${formatMoney(context.project.thisMonth)} spent; ${formatMoney(context.project.average3)} a month on average over the 3 months before.`}</dd>
      </dl>
    </section>
  );
}
```

Create `apps/web/app/finance/decided.tsx`:

```tsx
import { getRequest } from '../lib/finance-api';
import { decisionLine } from './model';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One line confirming what the viewer just decided. The URL carries only the
 * request's id; the words come from the normal, scope-checked read of it, so
 * nothing typed into the URL is ever shown.
 */
export async function DecidedNotice({ id, viewerId }: { id: string | undefined; viewerId: string }) {
  if (!id || !UUID.test(id)) return null;
  const result = await getRequest(id);
  const line = result.state === 'ready' ? decisionLine(result.data, viewerId) : null;
  return line ? <p className="finance-decided" role="status">{line}</p> : null;
}
```

- [ ] **Step 3: Use them on the request page**

In `apps/web/app/finance/requests/[id]/page.tsx`:
- add imports:

```tsx
import { DecidedNotice } from '../../decided';
import { ContextPanel } from './context-panel';
```

- change the signature and first line to:

```tsx
export default async function FinanceRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ decided?: string }> }) {
  const [{ id }, { decided }] = await Promise.all([params, searchParams]);
```

- directly after `<div className="dashboard">`, insert:

```tsx
          <DecidedNotice id={decided} viewerId={viewer.data.id} />
```

- directly before `<ActionPanels request={request} actions={actions} />`, insert:

```tsx
          {request.context ? <ContextPanel context={request.context} category={request.category?.name ?? 'this category'} project={request.projectName} /> : null}
```

- [ ] **Step 4: Run the specs and typecheck**

Run: `pnpm --filter web exec vitest run app/finance && pnpm --filter web typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/finance
git commit -m "feat(web): before-you-decide panel and a confirmation line after a decision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: web — the Director home

**Files:**
- Modify: `apps/web/app/overview/model.ts` (`HomeView`, `homeFor`)
- Modify: `apps/web/app/overview/model.spec.ts`
- Modify: `apps/web/app/lib/project-api.ts`
- Modify: `apps/web/app/lib/work-order-api.ts`
- Create: `apps/web/app/overview/director-panels.tsx`
- Create: `apps/web/app/overview/director.css`
- Create: `apps/web/app/overview/director-overview.tsx`
- Create: `apps/web/app/overview/director-overview.spec.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/shell.tsx`
- Modify: `apps/web/app/shell.spec.tsx`

**Interfaces:**
- Consumes: `buildPortfolio`, `headline`, `nprShort`, `waitingFor`, `decideTimeText`, `ProjectHealth`, `Severity` (Task 7); `getFinanceOverview`, `flagText`, `KIND_LABEL`, `formatMoney`, `personName` (Task 8); `DecidedNotice` (Task 9).
- Produces: `homeFor` returns `'director'` for `PROJECT_DIRECTOR` (after `SUPER_ADMIN` and `PROJECT_MANAGER`); `getPortfolio()`, `getWorkOrderSummary()`; `DirectorOverview({ decided })`; panels `WaitingPanel`, `PortfolioPanel`, `MoneyPanel`, `DecisionsPanel`.

- [ ] **Step 1: `homeFor`, test first**

In `apps/web/app/overview/model.spec.ts`, replace the test `'sends Finance and Project Directors to the finance workspace'` with:

```ts
  it('sends Finance to the finance workspace and Project Directors to their own home', () => {
    expect(homeFor(['FINANCE'])).toBe('finance');
    expect(homeFor(['PROJECT_DIRECTOR'])).toBe('director');
    expect(homeFor(['FINANCE', 'PROJECT_DIRECTOR'])).toBe('director');
    expect(homeFor(['QC_MANAGER', 'PROJECT_DIRECTOR'])).toBe('director');
  });
```

Run: `pnpm --filter web exec vitest run app/overview/model.spec.ts`
Expected: FAIL, `expected 'finance' to be 'director'`.

In `apps/web/app/overview/model.ts`, replace `HomeView` and `homeFor` with:

```ts
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
```

Run: `pnpm --filter web exec vitest run app/overview/model.spec.ts`
Expected: PASS.

- [ ] **Step 2: The two read clients**

In `apps/web/app/lib/project-api.ts`, add `PortfolioProject` to the `import type { ... } from '@ipms/contracts'` list and add after `getProjectDashboard`:

```ts
/** The Director's portfolio: every ACTIVE or ON_HOLD project in scope, with the counts its health is judged by. */
export async function getPortfolio(): Promise<ApiResult<PortfolioProject[]>> {
  return authFetch<PortfolioProject[]>('/api/v1/dashboard/portfolio');
}
```

In `apps/web/app/lib/work-order-api.ts`, add `WorkOrderProjectSummary` to the `import type { ... } from '@ipms/contracts'` list and add after `listProjectWorkOrders`:

```ts
/** Per-project work order counts for the Director's portfolio. */
export async function getWorkOrderSummary(): Promise<ApiResult<WorkOrderProjectSummary[]>> {
  return authFetch<WorkOrderProjectSummary[]>('/api/v1/work-orders/summary');
}
```

- [ ] **Step 3: Write the failing spec for the home**

Create `apps/web/app/overview/director-overview.spec.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const getPortfolio = vi.fn();
const getWorkOrderSummary = vi.fn();
const getFinanceOverview = vi.fn();
const getCurrentUser = vi.fn();
const getMyProfile = vi.fn();
const listUserDirectory = vi.fn();
vi.mock('../lib/project-api', () => ({ getPortfolio }));
vi.mock('../lib/work-order-api', () => ({ getWorkOrderSummary }));
vi.mock('../lib/finance-api', () => ({ getFinanceOverview }));
vi.mock('../lib/iam-api', () => ({ getCurrentUser }));
vi.mock('../lib/user-api', () => ({ getMyProfile, listUserDirectory }));
vi.mock('../shell', () => ({ Sidebar: () => null, TopActions: () => null, StatePage: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('../finance/decided', () => ({ DecidedNotice: () => null }));

const { DirectorOverview } = await import('./director-overview');

const ready = (data: unknown) => ({ state: 'ready', data });
const down = { state: 'unavailable', status: 503, message: 'down' };
const PROJECT = {
  id: 'p-1', code: 'KOS', name: 'Koshi Rollout', status: 'ACTIVE', startDate: '2026-01-01T00:00:00.000Z', targetDate: '2027-12-31T00:00:00.000Z',
  sites: { total: 4, byStatus: {} }, tasks: { live: 10, completed: 5, overdue: 0, byStatus: {} }, sitesComplete: null, nextMilestone: null, completedByWeek: [0, 0, 0, 0, 1, 1, 1, 1],
};
const OVERVIEW = {
  months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
  pipeline: {
    steps: [
      { status: 'PENDING_PM', count: 2, amount: '3000.00', oldestSince: '2026-10-08T00:00:00Z', mine: false },
      { status: 'PENDING_DIRECTOR', count: 1, amount: '240000.00', oldestSince: '2026-10-05T00:00:00Z', mine: true },
      { status: 'PENDING_FINANCE', count: 0, amount: '0.00', oldestSince: null, mine: false },
    ],
    paidThisMonth: { count: 0, amount: '0.00' },
  },
  queue: [{
    id: 'r-1', number: 'ADV-2026-0012', kind: 'ADVANCE', status: 'PENDING_DIRECTOR', projectId: 'p-1', projectCode: 'KOS', projectName: 'Koshi Rollout',
    requesterId: 'u-eng', purpose: 'Site travel', category: 'Travel', amount: '240000.00', waitingSince: '2026-10-05T00:00:00Z',
    flags: [{ code: 'WAITING_LONG', tone: 'amber', days: 5 }],
  }],
  projects: [], categories: [], cashHolders: [],
  decisions: { approved: { count: 0, amount: '0.00' }, trimmed: { count: 0, saved: '0.00' }, returned: 0, rejected: 0, medianHoursToDecide: null },
};

beforeEach(() => {
  getPortfolio.mockReset().mockResolvedValue(ready([PROJECT]));
  getWorkOrderSummary.mockReset().mockResolvedValue(ready([]));
  getFinanceOverview.mockReset().mockResolvedValue(ready(OVERVIEW));
  getCurrentUser.mockReset().mockResolvedValue(ready({ id: 'u-dir', roles: ['PROJECT_DIRECTOR'], permissions: [], tokenVersion: 0, isActive: true }));
  getMyProfile.mockReset().mockResolvedValue(ready({ fullName: 'Hari Sharma' }));
  listUserDirectory.mockReset().mockResolvedValue(ready([{ id: 'u-eng', fullName: 'Sita Rai' }]));
});

const render = async () => renderToStaticMarkup(await DirectorOverview({}));

describe('DirectorOverview', () => {
  it('leads with what waits on the Director and lists it with its flags', async () => {
    const out = await render();
    expect(out).toContain('1 request worth NPR 2.4 lakh waits on you');
    expect(out).toContain('With you');
    expect(out).toContain('ADV-2026-0012');
    expect(out).toContain('Waiting 5 days');
    expect(out).toContain('Sita Rai');
    expect(out).toContain('Koshi Rollout');
  });

  it('still shows the queue when projects are down', async () => {
    getPortfolio.mockResolvedValue(down);
    const out = await render();
    expect(out).toContain('Projects are unavailable');
    expect(out).toContain('ADV-2026-0012');
  });

  it('shows quality as unknown when qc is down', async () => {
    getWorkOrderSummary.mockResolvedValue(down);
    const out = await render();
    expect(out).toContain('Work orders unavailable');
    expect(out).toContain('Koshi Rollout');
  });

  it('says plainly when finance is down, and still shows the portfolio', async () => {
    getFinanceOverview.mockResolvedValue(down);
    const out = await render();
    expect(out).toContain('Finance did not answer');
    expect(out).toContain('Koshi Rollout');
  });

  it('asks a signed-out viewer to sign in', async () => {
    getCurrentUser.mockResolvedValue({ state: 'unauthenticated' });
    expect(await render()).toContain('Sign in to see your projects');
  });
});
```

Run: `pnpm --filter web exec vitest run app/overview/director-overview.spec.tsx`
Expected: FAIL, `Failed to resolve import "./director-overview"`.

- [ ] **Step 4: The panels**

Create `apps/web/app/overview/director-panels.tsx`:

```tsx
import type { FinanceOverview, PipelineStep } from '@ipms/contracts';
import { KIND_LABEL, flagText, formatMoney, personName } from '../finance/model';
import { decideTimeText, nprShort, waitingFor, type ProjectHealth, type Signal } from './director-model';

const STEP_NAME: Record<PipelineStep['status'], string> = { PENDING_PM: 'With PM', PENDING_DIRECTOR: 'With Director', PENDING_FINANCE: 'With Finance' };
const monthName = (key: string): string => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

function Badge({ signal }: { signal: Signal | null }) {
  return signal ? <span className={`dr-badge ${signal.severity}`}>{signal.label}</span> : <span className="dr-badge neutral">—</span>;
}

function Progress({ health }: { health: ProjectHealth }) {
  return (
    <span className="dr-progress" role="img" aria-label={`${health.completion}% complete${health.expected === null ? '' : `, ${health.expected}% expected by now`}`}>
      <i className={health.schedule.severity} style={{ width: `${health.completion}%` }} />
      {health.expected === null ? null : <b style={{ left: `${health.expected}%` }} />}
    </span>
  );
}

/** Where requests stand, and what waits on the viewer with its flags. */
export function WaitingPanel({ finance, names, now }: { finance: FinanceOverview | null; names: ReadonlyMap<string, string>; now: Date }) {
  if (!finance) {
    return (
      <section className="ov-card ov-panel" id="waiting">
        <header className="ov-panel-head"><div><h2>Waiting on you</h2></div></header>
        <p className="ov-note">Finance did not answer, so what waits on you cannot be shown here. <a className="ov-link" href="/finance?view=awaiting">Open the finance queue</a></p>
      </section>
    );
  }
  return (
    <section className="ov-card ov-panel" id="waiting">
      <header className="ov-panel-head">
        <div><h2>Waiting on you</h2><p>Longest waiting first</p></div>
        <a className="ov-link" href="/finance?view=awaiting">Open queue <span aria-hidden="true">→</span></a>
      </header>
      <ol className="dr-pipeline" aria-label="Where requests are">
        {finance.pipeline.steps.map((step) => (
          <li key={step.status} className={step.mine ? 'mine' : undefined}>
            <a href={`/finance?view=all&status=${step.status}`}>
              <span>{step.mine ? 'With you' : STEP_NAME[step.status]}</span>
              <b>{step.count}</b>
              <em>{nprShort(step.amount)}{step.count > 0 ? ` · oldest ${waitingFor(step.oldestSince, now)}` : ''}</em>
            </a>
          </li>
        ))}
        <li>
          <a href="/finance?view=all&status=PAID">
            <span>Paid this month</span>
            <b>{finance.pipeline.paidThisMonth.count}</b>
            <em>{nprShort(finance.pipeline.paidThisMonth.amount)}</em>
          </a>
        </li>
      </ol>
      {finance.queue.length === 0 ? (
        <div className="ov-empty"><strong>All caught up</strong><p>Requests reach you once the project manager approves them.</p></div>
      ) : (
        <ul className="mg-queue">
          {finance.queue.map((item) => {
            const age = waitingFor(item.waitingSince, now);
            return (
              <li key={item.id}>
                <span className="mg-icon" aria-hidden="true">₨</span>
                <div className="mg-main">
                  <p><a href={`/finance/requests/${item.id}`}>{item.purpose}</a><code>{item.number}</code></p>
                  <span>{KIND_LABEL[item.kind]} · {item.category} · {item.projectCode} {item.projectName}</span>
                  <span>{personName(item.requesterId, names)}</span>
                  {item.flags.length > 0 ? (
                    <ul className="finance-flags" aria-label="Warnings">
                      {item.flags.map((flag) => <li key={flag.code} className={flag.tone}>{flagText(flag)}</li>)}
                    </ul>
                  ) : null}
                </div>
                <div className="mg-end">
                  <b>{formatMoney(item.amount)}</b>
                  <span className="ov-sub">{age === 'today' ? 'Arrived today' : `Waiting ${age}`}</span>
                  <a className="mg-review" href={`/finance/requests/${item.id}`}>Review</a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Every project in scope, worst first, with the reason behind each signal. */
export function PortfolioPanel({ health, failure, workOrdersMissing }: { health: readonly ProjectHealth[]; failure: string | null; workOrdersMissing: boolean }) {
  return (
    <section className="ov-card ov-panel" id="portfolio">
      <header className="ov-panel-head">
        <div><h2>Portfolio</h2><p>Worst first. The tick on each bar is where the project should be by now.</p></div>
        <a className="ov-link" href="/projects">All projects <span aria-hidden="true">→</span></a>
      </header>
      {failure ? <p className="ov-note">Projects are unavailable: {failure}</p>
        : health.length === 0 ? <div className="ov-empty"><strong>No active projects in your scope</strong></div>
          : (
            <>
              {workOrdersMissing ? <p className="ov-note">Work orders unavailable: quality is not shown, and projects without milestone requirements count planned tasks only.</p> : null}
              <div className="ov-scroll">
                <table className="ov-table dr-portfolio">
                  <thead><tr><th>Project</th><th>Progress</th><th>Schedule</th><th>Quality</th><th>Money</th></tr></thead>
                  <tbody>
                    {health.map((h) => (
                      <tr key={h.id}>
                        <td><a className="ov-project" href={`/projects/${h.id}`}>{h.name}</a><span className="ov-sub">{h.code}</span></td>
                        <td><b>{h.completion}%</b>{h.partial ? <span className="ov-sub">partial</span> : null}<Progress health={h} /></td>
                        <td><Badge signal={h.schedule} /><span className="ov-sub">{h.schedule.reason}</span></td>
                        <td><Badge signal={h.quality} />{h.quality ? <span className="ov-sub">{h.quality.reason}</span> : null}</td>
                        <td><Badge signal={h.money} />{h.money ? <span className="ov-sub">{h.money.reason}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
    </section>
  );
}

/** Spend over six months, this month by category, and cash still with engineers. */
export function MoneyPanel({ finance, names }: { finance: FinanceOverview | null; names: ReadonlyMap<string, string> }) {
  if (!finance) {
    return (
      <section className="ov-card ov-panel" id="money">
        <header className="ov-panel-head"><div><h2>Money</h2></div></header>
        <p className="ov-note">Finance did not answer, so spend and cash out cannot be shown.</p>
      </section>
    );
  }
  const totals = finance.months.map((month, i) => ({ month, amount: finance.projects.reduce((t, p) => t + Number(p.spentByMonth[i] ?? 0), 0) }));
  const peak = Math.max(1, ...totals.map((t) => t.amount));
  const cash = finance.projects.reduce((t, p) => t + Number(p.cashHeld), 0);
  const overdue = finance.projects.reduce((t, p) => t + Number(p.overdueSettlements.amount), 0);
  return (
    <section className="ov-card ov-panel" id="money">
      <header className="ov-panel-head">
        <div><h2>Money</h2><p>Spent is reimbursed plus settled, by the month Finance closed it (the spend report filters by the day a request was raised). Cash still out on advances is shown apart.</p></div>
        <a className="ov-link" href="/finance/reports">Spend report <span aria-hidden="true">→</span></a>
      </header>
      <ol className="dr-bars" aria-label="Spend by month">
        {totals.map((t) => (
          <li key={t.month}><i style={{ height: `${Math.round((t.amount / peak) * 100)}%` }} /><b>{nprShort(t.amount)}</b><span>{monthName(t.month)}</span></li>
        ))}
      </ol>
      <h3 className="dr-sub">This month by category</h3>
      {finance.categories.length === 0 ? <p className="ov-sub">Nothing spent this month yet.</p> : (
        <ul className="dr-list">{finance.categories.map((c) => <li key={c.categoryId}><span>{c.name}</span><b>{nprShort(c.amount)}</b></li>)}</ul>
      )}
      <h3 className="dr-sub">Cash with engineers: {nprShort(cash)}{overdue > 0 ? <em className="red"> · {nprShort(overdue)} overdue</em> : null}</h3>
      {finance.cashHolders.length === 0 ? <p className="ov-sub">No advances are out.</p> : (
        <ul className="dr-list">
          {finance.cashHolders.map((h) => (
            <li key={h.requesterId}>
              <span>{personName(h.requesterId, names)}<em> · {h.open} open{h.overdue > 0 ? `, ${h.overdue} overdue` : ''}</em></span>
              <b>{nprShort(h.outstanding)}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The viewer's own decisions over 30 days. */
export function DecisionsPanel({ finance }: { finance: FinanceOverview | null }) {
  if (!finance) return null;
  const d = finance.decisions;
  return (
    <section className="ov-card ov-panel" id="decisions">
      <header className="ov-panel-head">
        <div><h2>Your decisions</h2><p>Last 30 days</p></div>
        <a className="ov-link" href="/finance?view=handled">Decided by me <span aria-hidden="true">→</span></a>
      </header>
      <dl className="dr-stats">
        <div><dt>Approved</dt><dd><b>{d.approved.count}</b><span>{nprShort(d.approved.amount)}</span></dd></div>
        <div><dt>Trimmed</dt><dd><b>{d.trimmed.count}</b><span>{nprShort(d.trimmed.saved)} saved</span></dd></div>
        <div><dt>Returned</dt><dd><b>{d.returned}</b></dd></div>
        <div><dt>Rejected</dt><dd><b>{d.rejected}</b></dd></div>
        <div><dt>Median time to decide</dt><dd><b>{d.medianHoursToDecide === null ? '—' : decideTimeText(d.medianHoursToDecide)}</b></dd></div>
      </dl>
    </section>
  );
}
```

Create `apps/web/app/overview/director.css`:

```css
/* The Project Director's home. Builds on overview.css; everything here is prefixed dr-. */
.dr-pipeline { list-style: none; margin: 0 0 18px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.dr-pipeline a { display: grid; gap: 4px; padding: 12px 14px; border: 1px solid var(--ov-line); border-radius: 10px; color: var(--ov-ink); }
.dr-pipeline a:hover { background: #f8fafc; }
.dr-pipeline a:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.dr-pipeline li.mine a { border-color: #bcd2ff; background: #eaf1ff; }
.dr-pipeline span { font-size: 12px; font-weight: 600; color: var(--ov-text); }
.dr-pipeline b { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.dr-pipeline em { font-style: normal; font-size: 12px; color: var(--ov-text); }

.dr-badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 650; background: #eef2f7; color: #475569; }
.dr-badge.red { background: #fee2e2; color: #991b1b; }
.dr-badge.amber { background: #fef3c7; color: #92400e; }
.dr-badge.green { background: #d1fae5; color: #065f46; }

.dr-portfolio td { min-width: 150px; }
.dr-portfolio td:first-child { min-width: 180px; }
.dr-progress { position: relative; display: block; height: 8px; margin-top: 8px; max-width: 180px; border-radius: 99px; background: #eef2f7; }
.dr-progress i { display: block; height: 100%; border-radius: inherit; background: var(--ov-slate); }
.dr-progress b { position: absolute; top: -3px; width: 2px; height: 14px; margin-left: -1px; background: var(--ov-ink); }

.dr-bars { list-style: none; margin: 0 0 20px; padding: 0; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; height: 150px; }
.dr-bars li { display: grid; grid-template-rows: 1fr auto auto; gap: 4px; height: 100%; text-align: center; }
.dr-bars i { align-self: end; display: block; min-height: 2px; border-radius: 4px 4px 0 0; background: var(--ov-blue); }
.dr-bars b { font-size: 11px; font-weight: 650; color: var(--ov-ink); }
.dr-bars span { font-size: 11px; color: var(--ov-text); }

.dr-sub { margin: 18px 0 8px; font-size: 13px; font-weight: 650; color: var(--ov-ink); }
.dr-sub em { font-style: normal; }
.dr-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.dr-list li { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--ov-ink); }
.dr-list em { font-style: normal; color: var(--ov-text); }
.dr-list b { font-variant-numeric: tabular-nums; }

.dr-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 14px; margin: 0; }
.dr-stats dt { font-size: 12px; color: var(--ov-text); }
.dr-stats dd { margin: 6px 0 0; display: grid; gap: 2px; }
.dr-stats b { font-size: 22px; font-weight: 700; color: var(--ov-ink); font-variant-numeric: tabular-nums; }
.dr-stats span { font-size: 12px; color: var(--ov-text); }

@media (max-width: 900px) { .dr-pipeline { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

- [ ] **Step 5: The home itself**

Create `apps/web/app/overview/director-overview.tsx`:

```tsx
import './overview.css';
import './director.css';
import '../finance/finance.css';
import { DecidedNotice } from '../finance/decided';
import { getFinanceOverview } from '../lib/finance-api';
import { getCurrentUser } from '../lib/iam-api';
import { getPortfolio } from '../lib/project-api';
import { getMyProfile, listUserDirectory } from '../lib/user-api';
import { getWorkOrderSummary } from '../lib/work-order-api';
import { Sidebar, TopActions } from '../shell';
import { buildPortfolio, headline } from './director-model';
import { DecisionsPanel, MoneyPanel, PortfolioPanel, WaitingPanel } from './director-panels';
import { dayLabel, firstName, greeting } from './model';
import { SignInPage } from './parts';

/**
 * The Project Director's home: what waits on them, which projects are in
 * trouble and why, where the money goes, and what they decided. Each panel
 * renders from its own service, so one that does not answer blanks only
 * its panel.
 */
export async function DirectorOverview({ decided }: { decided?: string | undefined }) {
  const [portfolio, workOrders, finance, viewer, profile, directory] = await Promise.all([
    getPortfolio(), getWorkOrderSummary(), getFinanceOverview(), getCurrentUser(), getMyProfile(), listUserDirectory(),
  ]);
  if (viewer.state === 'unauthenticated' || portfolio.state === 'unauthenticated' || finance.state === 'unauthenticated') return <SignInPage what="your projects" />;

  const now = new Date();
  const money = finance.state === 'ready' ? finance.data : null;
  const health = portfolio.state === 'ready'
    ? buildPortfolio(portfolio.data, workOrders.state === 'ready' ? workOrders.data : null, money?.projects ?? null, now)
    : [];
  const mine = money?.pipeline.steps.find((s) => s.mine);
  const summary = headline(money ? { count: mine?.count ?? 0, amount: mine?.amount ?? '0.00' } : null, health);
  const names = new Map(directory.state === 'ready' ? directory.data.map((p) => [p.id, p.fullName]) : []);
  const name = firstName(profile?.state === 'ready' ? profile.data.fullName : undefined);

  return (
    <main className="app-shell">
      <Sidebar active="overview" />
      <section className="content" id="top">
        <header className="topbar">
          <div className="crumbs"><span>Workspace</span><b>/</b><strong>Overview</strong></div>
          <TopActions />
        </header>
        <div className="dashboard ov">
          {viewer.state === 'ready' ? <DecidedNotice id={decided} viewerId={viewer.data.id} /> : null}
          <section className="ov-head">
            <div>
              <p className="ov-date">{dayLabel(now)}</p>
              <h1>{greeting(now)}{name ? `, ${name}` : ''}</h1>
              {summary ? <p>{summary}</p> : null}
            </div>
            <div className="ov-head-actions">
              <a className="secondary-button" href="/finance/reports">Spend report</a>
              <a className="primary-button" href="/finance?view=awaiting">Open queue</a>
            </div>
          </section>
          <WaitingPanel finance={money} names={names} now={now} />
          <PortfolioPanel
            health={health}
            failure={portfolio.state === 'ready' ? null : portfolio.state === 'unavailable' || portfolio.state === 'forbidden' ? portfolio.message : 'Sign in again to continue.'}
            workOrdersMissing={workOrders.state !== 'ready'}
          />
          <div className="ov-pair">
            <MoneyPanel finance={money} names={names} />
            <DecisionsPanel finance={money} />
          </div>
        </div>
      </section>
    </main>
  );
}
```

Run: `pnpm --filter web exec vitest run app/overview/director-overview.spec.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Route `/` and the sidebar, sidebar test first**

In `apps/web/app/shell.spec.tsx`, replace the test `'leaves Finance and Project Directors with the Finance group only'` with:

```tsx
  it('leaves Finance with the Finance group only', async () => {
    getCurrentUser.mockResolvedValue(as(['FINANCE'], ['finance_request.view', 'finance_request.view_all', 'finance_category.manage', 'project.view', 'task.view']));
    const links = hrefs(await Sidebar({ active: 'finance' }));
    expect(links).toEqual(expect.arrayContaining(['/finance', '/finance/categories', '/finance/reports']));
    expect(links).not.toContain('/projects');
    expect(JSON.stringify(await Sidebar({ active: 'finance' }))).not.toContain('Overview');
    expect(links.some((href) => href.startsWith('/quality'))).toBe(false);
    expect(links).not.toContain('/#audit-log');
  });

  it('gives Project Directors their overview, the projects and the finance group, and nothing of quality', async () => {
    getCurrentUser.mockResolvedValue(as(['PROJECT_DIRECTOR'], ['project.view', 'site.view', 'milestone.view', 'task.view', 'task.view_all', 'finance_request.view', 'finance_request.view_all', 'finance_approval.director']));
    const links = hrefs(await Sidebar({ active: 'overview' }));
    expect(links).toEqual(expect.arrayContaining(['/projects', '/finance', '/finance/reports']));
    expect(JSON.stringify(await Sidebar({ active: 'overview' }))).toContain('Overview');
    expect(links).not.toContain('/finance/categories');
    expect(links.some((href) => href.startsWith('/quality'))).toBe(false);
    expect(links).not.toContain('/#audit-log');
    expect(listWorkOrders).not.toHaveBeenCalled();
  });
```

Run: `pnpm --filter web exec vitest run app/shell.spec.tsx`
Expected: FAIL on the Director test (Records/quality links appear, no `/finance` group placement).

In `apps/web/app/shell.tsx`, in `Sidebar`:
- replace the comment and line `// Finance and Directors live in the finance workspace, so their menu is only that and the docs.` / `const financeHome = home === 'finance' && mayViewFinance;` with:

```tsx
  // Finance lives in the finance workspace, so its menu is only that and the docs.
  const financeHome = home === 'finance' && mayViewFinance;
  // A Director oversees projects and approves money: their overview, the projects, and finance.
  const director = home === 'director';
```

- replace `{manager || staff ? (` (the line directly after the Projects `NavItem`) with `{director ? financeGroup : manager || staff ? (`
- replace `{!(manager || staff) ? financeGroup : null}` with `{!(manager || staff || director) ? financeGroup : null}`

In `apps/web/app/page.tsx`:
- add `import { DirectorOverview } from './overview/director-overview';`
- change the doc comment's first line to `One address, six homes, chosen by role: managers land on their decision` and its third line to `queue, QC on the review desk, Project Directors on their portfolio, Finance on the finance`
- change the signature to `export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ log?: string; decided?: string }> }) {`
- add `case 'director': return <DirectorOverview decided={(await searchParams).decided} />;` directly after the `case 'manager'` line.

- [ ] **Step 7: Run the web suite, typecheck and lint**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS; typecheck and lint exit 0.

- [ ] **Step 8: Look at it in the browser**

Start the stack (`docker compose -f docker/docker-compose.yml up -d`) and the web (`pnpm --filter web dev`), sign in as `director@ipms.local` with the demo password from `docker/env/iam.env`, and check `/`: the header sentence, the pipeline strip, the queue, the portfolio table with bars and ticks, the money panel and the decisions panel. Resize to phone width and confirm the panels stack without horizontal page scroll (the portfolio table scrolls inside its card). Fix anything that renders wrongly before committing.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): the Project Director's home — waiting, portfolio, money and decisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: web — approve, then the next request

**Files:**
- Modify: `apps/web/app/finance/actions.ts`
- Modify: `apps/web/app/finance/actions.spec.ts`
- Modify: `apps/web/app/finance/page.tsx`

**Interfaces:**
- Consumes: `listRequests` with `view: 'awaiting'` (oldest first since Task 4); `homeFor` returning `'director'` (Task 10); `DecidedNotice` (Task 9); `RawSearch.decided` (Task 8).
- Produces: `approveAction`, `returnAction`, `rejectAction` redirect on success to `/finance/requests/<next>?decided=<id>`, or to `/?decided=<id>` for a Director / `/finance?view=awaiting&decided=<id>` for everyone else when the queue is empty; they revalidate `/` as well.

- [ ] **Step 1: Write the failing tests**

In `apps/web/app/finance/actions.spec.ts`:
- add `listRequests: vi.fn(),` to the `api` object;
- add before `const actions = await import('./actions');`:

```ts
const getCurrentUser = vi.fn();
vi.mock('../lib/iam-api', () => ({ getCurrentUser }));
const asRole = (role: string) => ({ state: 'ready' as const, data: { id: 'u-1', roles: [role], permissions: [], tokenVersion: 0, isActive: true } });
```

- at the end of `beforeEach`, add:

```ts
  api.listRequests.mockResolvedValue(ready({ items: [], total: 0, page: 1, limit: 2 }));
  getCurrentUser.mockReset().mockResolvedValue(asRole('PROJECT_MANAGER'));
```

- replace the test `'approves, with an amount only when one was typed'` with:

```ts
  it('approves, with an amount only when one was typed', async () => {
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1', amount: '40,000', comment: 'Cut travel days' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.approveRequest).toHaveBeenCalledWith('r-1', { amount: '40000.00', comment: 'Cut travel days' });
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1', amount: '', comment: '' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.approveRequest).toHaveBeenLastCalledWith('r-1', {});
    expect(await actions.approveAction(EMPTY, form({ id: 'r-1', amount: '1.234' }))).toEqual({ error: 'Enter an amount in NPR with at most two decimals.' });
  });
```

- replace the test `'requires a reason to return or reject'` with:

```ts
  it('requires a reason to return or reject', async () => {
    expect(await actions.returnAction(EMPTY, form({ id: 'r-1', comment: '  ' }))).toEqual({ error: 'Say why.' });
    expect(await actions.rejectAction(EMPTY, form({ id: 'r-1', comment: '' }))).toEqual({ error: 'Say why.' });
    expect(api.returnRequest).not.toHaveBeenCalled();
    await expect(actions.returnAction(EMPTY, form({ id: 'r-1', comment: 'Add the quotation' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.returnRequest).toHaveBeenCalledWith('r-1', 'Add the quotation');
    await expect(actions.rejectAction(EMPTY, form({ id: 'r-1', comment: 'Not in budget' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(api.rejectRequest).toHaveBeenCalledWith('r-1', 'Not in budget');
  });
```

- add a new `describe` block:

```ts
describe('after a decision', () => {
  it('opens the next request waiting on the caller, naming the one just decided', async () => {
    api.listRequests.mockResolvedValue(ready({ items: [{ id: 'r-1' }, { id: 'r-2' }], total: 2, page: 1, limit: 2 }));
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-2?decided=r-1');
    expect(api.listRequests).toHaveBeenCalledWith({ view: 'awaiting', limit: 2 });
    expect(revalidatePath).toHaveBeenCalledWith('/');
  });

  it.each([
    ['return', (f: FormData) => actions.returnAction(EMPTY, f)],
    ['reject', (f: FormData) => actions.rejectAction(EMPTY, f)],
  ])('does the same after a %s', async (_name, run) => {
    api.listRequests.mockResolvedValue(ready({ items: [{ id: 'r-3' }], total: 1, page: 1, limit: 2 }));
    await expect(run(form({ id: 'r-1', comment: 'why' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-3?decided=r-1');
  });

  it('sends a project manager back to the finance queue when nothing is left', async () => {
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1' }))).rejects.toThrow('NEXT_REDIRECT:/finance?view=awaiting&decided=r-1');
  });

  it('sends a Project Director home when nothing is left', async () => {
    getCurrentUser.mockResolvedValue(asRole('PROJECT_DIRECTOR'));
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1' }))).rejects.toThrow('NEXT_REDIRECT:/?decided=r-1');
  });

  it('stays on the request and shows the reason when the decision fails', async () => {
    api.approveRequest.mockResolvedValue({ state: 'forbidden', message: 'You already approved an earlier step of this request' });
    expect(await actions.approveAction(EMPTY, form({ id: 'r-1' }))).toEqual({ error: 'You already approved an earlier step of this request' });
    expect(api.listRequests).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter web exec vitest run app/finance/actions.spec.ts`
Expected: FAIL (approve/return/reject return `{}` instead of redirecting).

- [ ] **Step 2: Redirect after a decision**

In `apps/web/app/finance/actions.ts`:
- add `listRequests,` to the import from `'../lib/finance-api'`;
- add imports:

```ts
import { getCurrentUser } from '../lib/iam-api';
import { homeFor } from '../overview/model';
```

- add after the `pages` helper:

```ts
/** A decision also changes the Director's home, which shows their queue. */
const decisionPages = (id: string): string[] => [...pages(id), '/'];

/**
 * After a decision, the next request waiting on the caller (the awaiting view
 * is oldest first) or, when none is left, their home: the Director's
 * dashboard, or the finance queue for everyone else. Only the decided
 * request's id travels in the URL; the page reads the rest.
 */
async function nextAfterDecision(decidedId: string): Promise<never> {
  const [queue, viewer] = await Promise.all([listRequests({ view: 'awaiting', limit: 2 }), getCurrentUser()]);
  const next = queue.state === 'ready' ? queue.data.items.find((r) => r.id !== decidedId) : undefined;
  if (next) redirect(`/finance/requests/${next.id}?decided=${decidedId}`);
  const director = viewer.state === 'ready' && homeFor(viewer.data.roles) === 'director';
  redirect(director ? `/?decided=${decidedId}` : `/finance?view=awaiting&decided=${decidedId}`);
}
```

- replace the last line of `approveAction` with:

```ts
  const state = await settle(await approveRequest(id, { ...(amount === undefined ? {} : { amount }), ...(comment ? { comment } : {}) }), decisionPages(id));
  return state.error ? state : nextAfterDecision(id);
```

- replace the last line of `returnAction` with:

```ts
  const state = await settle(await returnRequest(id, comment), decisionPages(id));
  return state.error ? state : nextAfterDecision(id);
```

- replace the last line of `rejectAction` with:

```ts
  const state = await settle(await rejectRequest(id, comment), decisionPages(id));
  return state.error ? state : nextAfterDecision(id);
```

- [ ] **Step 3: Confirm on the finance page too**

In `apps/web/app/finance/page.tsx`:
- add `import { DecidedNotice } from './decided';`
- directly after `<div className="dashboard">`, insert:

```tsx
          <DecidedNotice id={search.decided} viewerId={user.id} />
```

- [ ] **Step 4: Run the web suite and typecheck**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/finance
git commit -m "feat(web): after approving, returning or rejecting, open the next request waiting

For every approver. A Director with an empty queue lands on their home.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: end to end through the gateway

**Files:**
- Create: `e2e/director-finance.e2e.spec.ts`

**Interfaces:**
- Consumes: the running Compose stack with the demo accounts (`admin`, `manager`, `director`); every endpoint from Tasks 2–6.

- [ ] **Step 1: Write the spec**

Create `e2e/director-finance.e2e.spec.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

async function login(user: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { email: `${user}@ipms.local`, password: DEMO_PASSWORD } });
  expect(res.status, `${user} login`).toBe(201);
  return res.body.accessToken;
}

/** Scope grants replicate through iam's outbox and NATS, so poll for the outcome. */
async function eventually<T>(read: () => Promise<T>, until: (v: T) => boolean, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (until(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function userId(admin: string, email: string): Promise<string> {
  const page = await api<{ items: { id: string; email: string }[] }>(`/api/v1/users?search=${email.split('@')[0]}`, { token: admin });
  return page.body.items.find((u) => u.email === email)!.id;
}

interface Request { id: string; status: string; approvedAmount: string | null }
interface Overview { queue: { id: string }[]; pipeline: { steps: { status: string; mine: boolean }[] }; decisions: { trimmed: { count: number } } }

let manager: string;
let director: string;
let projectId: string;
let categoryId: string;

beforeAll(async () => {
  await waitForReady();
  const admin = await login('admin');
  const projects = (await api<{ id: string }[]>('/api/v1/projects', { token: admin })).body;
  expect(projects.length, 'the stack needs at least one project').toBeGreaterThan(0);
  projectId = projects[0]!.id;
  // Granting is idempotent; the grants are left in place, as they would be for real users.
  for (const email of ['manager@ipms.local', 'director@ipms.local']) {
    const res = await api(`/api/v1/users/${await userId(admin, email)}/projects`, { method: 'POST', token: admin, body: { level: 'PROJECT', projectId } });
    expect([200, 201, 204]).toContain(res.status);
  }
  [manager, director] = await Promise.all([login('manager'), login('director')]);
  for (const token of [manager, director]) {
    await eventually(() => api<{ id: string }[]>('/api/v1/projects', { token }), (r) => r.body.some((p) => p.id === projectId));
  }
  categoryId = (await api<{ id: string; disabledAt: string | null }[]>('/api/v1/finance/categories', { token: manager })).body.find((c) => !c.disabledAt)!.id;
}, 120_000);

describe('Project Director finance', () => {
  it('sees a request waiting, trims and approves it, and finds it among their decisions', async () => {
    const created = await api<Request>('/api/v1/finance/requests', {
      method: 'POST', token: manager, body: { kind: 'ADVANCE', projectId, categoryId, purpose: `E2E director ${Date.now()}`, amount: '5000' },
    });
    expect(created.status).toBe(201);
    const submitted = await api<Request>(`/api/v1/finance/requests/${created.body.id}/submit`, { method: 'POST', token: manager });
    // A project manager's own request skips the PM step and goes to the Director.
    expect(submitted.body.status).toBe('PENDING_DIRECTOR');

    const before = await api<Overview>('/api/v1/finance/overview', { token: director });
    expect(before.status).toBe(200);
    expect(before.body.pipeline.steps.find((s) => s.mine)?.status).toBe('PENDING_DIRECTOR');
    const awaiting = await api<{ items: Request[] }>('/api/v1/finance/requests?view=awaiting&limit=100', { token: director });
    expect(awaiting.body.items.map((r) => r.id)).toContain(created.body.id);

    const approved = await api<Request>(`/api/v1/finance/requests/${created.body.id}/approve`, { method: 'POST', token: director, body: { amount: '4000' } });
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ status: 'PENDING_FINANCE', approvedAmount: '4000.00' });

    const handled = await api<{ items: Request[] }>('/api/v1/finance/requests?view=handled&limit=100', { token: director });
    expect(handled.body.items.map((r) => r.id)).toContain(created.body.id);
    const after = await api<Overview>('/api/v1/finance/overview', { token: director });
    expect(after.body.decisions.trimmed.count).toBe(before.body.decisions.trimmed.count + 1);
  });

  it('serves the portfolio and the work order summary to the Director', async () => {
    const portfolio = await api<{ id: string }[]>('/api/v1/dashboard/portfolio', { token: director });
    expect(portfolio.status).toBe(200);
    expect(Array.isArray(portfolio.body)).toBe(true);
    const summary = await api<unknown[]>('/api/v1/work-orders/summary', { token: director });
    expect(summary.status).toBe(200);
    expect(Array.isArray(summary.body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it against the stack**

Rebuild and start the stack so it serves this branch:

```bash
docker compose -f docker/docker-compose.yml up -d --build project qc finance gateway web
```

Run: `pnpm --filter e2e e2e director-finance`
Expected: PASS, 2 tests.

- [ ] **Step 3: Run every suite once more**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add e2e/director-finance.e2e.spec.ts
git commit -m "test(e2e): a Project Director approves a trimmed request and sees it among their decisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| 3 Director home, `homeFor` `director` | 10 |
| 3.1 Header sentence | 7 (`headline`), 10 |
| 3.2 Waiting on you, pipeline strip | 5 (data), 10 (`WaitingPanel`) |
| 3.3 Portfolio, completion, schedule, quality, money, standing | 2, 3, 5 (data), 7 (rules), 10 (`PortfolioPanel`) |
| 3.4 Money panel | 5, 10 (`MoneyPanel`) |
| 3.5 Your decisions | 5, 10 (`DecisionsPanel`) |
| 3.6 Thresholds as named constants | 4, 5, 7 |
| 4.1 Flags | 4 (service), 8 (phrasing, list) |
| 4.2 Before you decide | 6 (service), 9 (panel) |
| 4.3 Decided by me | 8 |
| 4.4 Awaiting oldest first | 4 |
| 4.5 Approve, then next, `decided` line | 9 (`DecidedNotice`), 11 |
| 4.6 Director sidebar | 10 |
| 5.1 / 5.2 / 5.3 Endpoints | 2 / 3 / 5 |
| 6 Web composition | 7–11 |
| 7 Errors (per-panel failure, `decided` unreadable) | 9, 10 |
| 8 Security (scope, `context` gating, flags in scope, id-only URL) | 4, 5, 6, 9 |
| 9 Testing | every task, 12 (e2e) |
| 10 Rollout (no migrations; services before web) | 12 step 2 |
