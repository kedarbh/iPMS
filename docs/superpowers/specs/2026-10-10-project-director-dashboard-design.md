# Project Director Dashboard Design

Date: 2026-10-10
Status: Draft for review

## 1. Why

The Project Director is the decision maker across the projects they oversee. Today the web gives them no home: `homeFor` sends them to `/finance?view=awaiting` and their sidebar is the finance group alone, so they cannot see how any project is doing. Their one action, the second approval step on finance requests, works, but they decide each request with no context beyond the request itself.

This design gives the Director a web home that answers, in order: what needs me, which projects are in trouble and why, and where the money is going. It also completes their finance pipeline with decision context on every request and a faster way through the queue.

## 2. Scope

In scope:
- A Director home on `/` (web) with four panels: Waiting on you, Portfolio, Money, Your decisions.
- A health signal per project (schedule, quality, money), each with a plain-language reason.
- Three summary endpoints, one in each service that owns the data: project, qc, finance.
- Finance pipeline: flags on waiting requests, a "Before you decide" panel on the request page, a "Decided by me" tab, the awaiting list ordered oldest-waiting first, and approve-then-next for every approver.
- The Director's own sidebar.

Out of scope:
- Mobile changes. Mobile already has the approver finance dashboard; it can adopt the new endpoints later.
- Project budgets, purchase orders and committed spend. These arrive together in the next phase.
- Inline or batch approval from the dashboard. Every decision is made on the request page.
- Any change to what the Director may do in project delivery. Their access there stays read-only.
- New permissions, roles, notifications, migrations or services.

## 3. The Director home

`homeFor` gains a `director` value for anyone holding `PROJECT_DIRECTOR` without a more senior role (`SUPER_ADMIN` and `PROJECT_MANAGER` still win, as today). `FINANCE` keeps its current workspace. `/` renders `DirectorOverview` for `director`.

### 3.1 Header

The greeting and date line, as the other homes have, and one sentence built from the data, for example: "3 requests worth NPR 2.4 lakh wait on you · 2 of 9 projects slipping." When nothing waits and nothing slips: "Nothing waits on you, and every project is on track."

### 3.2 Waiting on you

- A pipeline strip: **With PM → With you → With Finance → Paid this month**. Each pending step shows its count, NPR total and the age of its oldest request. The viewer's own step is highlighted. Each step links to `/finance?view=all&status=<status>`. Paid this month shows the count closed by Finance this month and the NPR paid out.
- Below it, the 5 requests that have waited longest at the viewer's step, each with its number, kind, project, requester, amount, age and flags (section 4.1). Each links to its request page. An "Open queue" link goes to `/finance?view=awaiting`.

### 3.3 Portfolio

One row per project in scope with status ACTIVE or ON_HOLD, sorted worst standing first, then by how far behind schedule. Each row shows the project code and name, a progress bar with an expected-progress tick, the three signals with their reasons, and links to `/projects/<id>`, the existing read-only project overview.

#### Completion

Completion uses the same rule as `summarizeProject` on the project page, so the two always agree:
- When at least one milestone declares requirements, completion is `sitesComplete / sites`. A site is complete when it has a completed task of every task type that any milestone requires. Units are sites.
- Otherwise completion is completed work over live work, where work is planned tasks (project) plus work orders (qc), and live means not cancelled. Units are tasks and work orders, and pace adds both services' weekly completions together.

#### Schedule signal

Definitions, with all days in Asia/Kathmandu:
- `expected` = the share of the project's window that has passed: `clamp((today − startDate) / (targetDate − startDate), 0, 1) × 100`.
- `behind` = `expected − completion`, in points.
- `pace` = units completed in the last 28 days ÷ 28, per day.
- `remaining` = units not yet complete.
- `forecast` = `today + remaining / pace`.

The rules are applied in this order, and the first that matches wins:

| Order | Condition | Signal | Example reason |
|---|---|---|---|
| 1 | Project status is ON_HOLD | On hold (neutral) | "On hold" |
| 2 | Completion is 100% | Complete (good) | "All sites complete" |
| 3 | No start date or no target date | Not scheduled (neutral) | "No target date set" |
| 4 | Target date has passed | Slipping | "Target was 12 Sep; 78% done" |
| 5 | Started less than 28 days ago, or not started yet | At risk if `behind > 15`, otherwise On track | "Too early to forecast; 12% done, 20% of time used", or "Starts 1 Nov" |
| 6 | No units completed in the last 28 days | Slipping (Stalled) | "Nothing completed in 4 weeks" |
| 7 | `forecast > targetDate + 14 days` | Slipping | "42% done, 70% of time used. At current pace finishes 12 Feb, 5 weeks after target" |
| 8 | `forecast > targetDate`, or `behind > 15` | At risk | "At current pace finishes 3 days after target" |
| 9 | Otherwise | On track | "On pace to finish by 20 Jan" |

When the project has a next open milestone with a target date, the reason adds it: "Next: Power-on, due 20 Oct, 35% of sites."

#### Quality signal

From qc's work orders for the project:
- `firstTime` = work orders approved in the last 90 days that were never rejected ÷ work orders approved in the last 90 days.
- Fewer than 5 approvals in 90 days: Not enough reviews (neutral).
- `firstTime < 70%`: Concern. `firstTime < 85%`: Watch. Otherwise Good.
- The reason always states the rate and adds open rework and overdue work orders when there are any: "68% approved first time; 4 in rework, 2 overdue."

#### Money signal

From finance, for the project:
- Spent to date, spent this month, and the average monthly spend of the 3 previous months.
- Cash held: the outstanding balance of the project's open advances.
- Overdue settlements: open advances past their settle-by day with no settlement under review (the rule mobile uses).
- Watch when this month is more than 1.5× the 3-month average and at least NPR 50,000 above it, or when any settlement is overdue. Otherwise Good.
- This month is month to date, so early in a month a spike is rarely flagged. That is deliberate: the signal errs towards quiet.
- Example reason: "NPR 3.2 lakh this month, 2.1× usual; NPR 45,000 with engineers, 1 settlement overdue."

#### Standing

Each signal has a severity: Slipping and Concern are red; At risk and Watch are amber; On track, Complete and Good are green; On hold, Not scheduled and Not enough reviews are neutral. A project's standing is its worst signal. Ties are sorted by `behind`, largest first.

### 3.4 Money

- Spend across the portfolio for each of the last 6 months, current month included, as bars.
- This month's spend by category.
- Cash with engineers: the total, the overdue amount, and the 5 people holding the most, each with their count of open and overdue advances.
- Projects with spend that are no longer ACTIVE or ON_HOLD appear here only, never in the portfolio.
- A note says the month is the day Finance closed the request, which differs from the spend report's creation-date filter.

### 3.5 Your decisions

Over the last 30 days, counting only the viewer's own approval-step actions:
- Approved: count and NPR approved.
- Trimmed: approvals where the approved amount was below the requested amount, with the NPR saved (requested − approved).
- Returned and rejected: counts.
- Median time to decide: from when the request reached the viewer's step to the viewer's action.

### 3.6 Thresholds

Every number in this section (28 days, 14 days, 15 points, 70%, 85%, 5 approvals, 1.5×, NPR 50,000, 90 days, 30 days, 6 months) is a named constant in `apps/web/app/overview/director-model.ts`. The finance flag thresholds (section 4.1) are named constants in the finance service.

## 4. Finance pipeline

### 4.1 Flags on waiting requests

One finance function, `requestFlags(rows, scope)`, computes flags for requests in a `PENDING_*` state. It feeds the overview queue and the rows of `GET /finance/requests?view=awaiting`, which gain a `flags` array next to the facts they already carry. Rows in any other view or status carry no flags.

| Flag | Rule | Example |
|---|---|---|
| `DUPLICATE_BILL` | The existing duplicate check (`findDuplicates`) finds a match for a settlement's or reimbursement's bills | "Possible duplicate: Himal Traders #4471 on SET-2026-0031" |
| `REQUESTER_HOLDS_CASH` | The requester has open advances in the viewer's scope with an outstanding balance. For a settlement, the advance it settles is left out. Red when any is overdue (past its settle-by day with no settlement under review, as in section 3.3), amber otherwise | "Already holds NPR 45,000 from 2 advances, one 9 days past settle-by" |
| `UNUSUAL_AMOUNT` | The amount is more than 2× the median of requests of the same kind and category closed by Finance in the last 180 days, with at least 5 such requests | "About 3× the usual for Fuel" |
| `WAITING_LONG` | More than 3 days since the request reached its current step | "Waiting 5 days" |

A request reaches its current step at its `updatedAt`. A pending request is changed only by a transition, so this is the time it entered its status. Mobile already measures age this way.

### 4.2 Before you decide

`GET /finance/requests/:id` gains a `context` block when, and only when, the caller holds the permission for the request's current step, the request is at that step, and the caller is not the requester. Otherwise the key is absent from the response.

`context` carries:
- `requester`: open advances in the caller's scope (excluding the one a settlement settles), total outstanding, count overdue, and the oldest overdue in days.
- `category`: the median, 25th and 75th percentile of requests of the same kind and category closed in the last 180 days, and the sample size. `null` when fewer than 5.
- `project`: spend this month and the 3-month average, by the definitions in section 5.3.
- `flags`: the same flags as the list row.

The request page renders this as a "Before you decide" panel above the existing approve, amount, return and reject panel. The duplicate-bill and advance-balance panels already on the page stay as they are.

### 4.3 Decided by me

The web `RequestView` type gains `handled`, which the finance service already serves. Approvers' tabs on `/finance` become **Waiting for me · Decided by me · All requests**. Approvers who also raise requests (PMs) keep **My requests** as well.

### 4.4 Awaiting list order

The `awaiting` view orders by `updatedAt` ascending, so the request that has waited longest comes first. The other views keep their current order. Mobile sorts this list itself, so it is unaffected.

### 4.5 Approve, then next

After a successful approve, return or reject, the server action:
1. Fetches the first request of the caller's `awaiting` view.
2. If there is one, redirects to `/finance/requests/<next>?decided=<id>`.
3. If the queue is empty, redirects to `/?decided=<id>` when the caller's home is `director`, and to `/finance?view=awaiting&decided=<id>` otherwise.

The page receiving `decided` fetches that request through the normal, scope-checked read and shows one line built from it, for example "ADV-2026-0012 approved for NPR 40,000." No text from the URL is ever rendered. An empty queue shows "All caught up." This applies to every approver, PMs included. A failed action keeps today's behaviour: it stays on the request page and shows the error.

### 4.6 Director sidebar

For `director`: **Overview · Projects · Finance (Requests, Spend report)**, plus Documentation when their role may read it (the docs reader roles are unchanged, so today it is not shown). Hiding an item remains presentation only.

## 5. Service endpoints

All three sit under gateway prefixes that already exist (`/api/v1/dashboard`, `/api/v1/work-orders`, `/api/v1/finance`), so the gateway does not change. Each filters by the caller's scope with the helpers its list endpoints already use. Out of scope reads as absent. Totals come from grouped queries, with no page caps. Amounts travel as decimal strings; dates as ISO strings. Week buckets are rolling seven-day windows ending at the time of the request, oldest first, so the last four are exactly the 28 days pace uses.

### 5.1 project: `GET /dashboard/portfolio`

Permission `project.view`. Every project in scope with status ACTIVE or ON_HOLD.

```ts
interface PortfolioProject {
  id: string; code: string; name: string; status: 'ACTIVE' | 'ON_HOLD';
  startDate: string | null; targetDate: string | null;
  sites: { total: number; byStatus: Record<SiteStatus, number> };
  tasks: { live: number; completed: number; overdue: number; byStatus: Record<TaskStatus, number> };
  /** Null when no milestone declares requirements. */
  sitesComplete: number | null;
  nextMilestone: { name: string; targetDate: string | null; percent: number } | null;
  /** Last 8 rolling weeks: completed sites when sitesComplete is not null, otherwise completed tasks. */
  completedByWeek: number[];
}
```

A site's completion day is the latest `actualCompletionAt` among the completed tasks that satisfy its requirements. Counts respect site scope for site-scoped callers.

### 5.2 qc: `GET /work-orders/summary`

Permission `task.view`, with the existing work-order visibility rules.

```ts
interface WorkOrderProjectSummary {
  projectId: string;
  byStatus: Record<TaskStatus, number>;
  overdue: number;
  /** Approved in the last 90 days, and how many of those were never rejected. */
  approved90: number; firstTime90: number;
  reviewing: { count: number; oldestSubmittedAt: string | null };
  /** Last 8 rolling weeks, by actualCompletionAt. */
  completedByWeek: number[];
}
```

"Never rejected" means the work order has no `REJECTED` event.

### 5.3 finance: `GET /finance/overview`

Permission `finance_request.view_all`. Requests in the caller's project scope.

```ts
interface FinanceOverview {
  /** The six months spentByMonth covers, `YYYY-MM`, oldest first; the last is the current month in Kathmandu. */
  months: string[];
  pipeline: {
    steps: { status: 'PENDING_PM' | 'PENDING_DIRECTOR' | 'PENDING_FINANCE'; count: number; amount: string; oldestSince: string | null; mine: boolean }[];
    paidThisMonth: { count: number; amount: string };
  };
  /** The 5 requests longest at the caller's step, the caller's own excluded, with flags. */
  queue: { id: string; number: string; kind: RequestKind; status: PendingStatus; projectId: string; projectCode: string; projectName: string; requesterId: string; purpose: string; category: string; amount: string; waitingSince: string; flags: RequestFlag[] }[];
  projects: { projectId: string; code: string; name: string; spentToDate: string; spentByMonth: string[]; cashHeld: string; overdueSettlements: { count: number; amount: string } }[];
  categories: { categoryId: string; name: string; amount: string }[];
  cashHolders: { requesterId: string; outstanding: string; open: number; overdue: number }[];
  decisions: { approved: { count: number; amount: string }; trimmed: { count: number; saved: string }; returned: number; rejected: number; medianHoursToDecide: number | null };
}
```

Definitions:
- **Amount** of a pending request: `approvedAmount` when set, else `requestedAmount`.
- **Mine**: the step's status is in `awaitingStatuses(caller.permissions)`. The caller's own requests are excluded from the step counts for a `mine` step, as they are from the queue.
- **Closed**: the request has a `FINANCE`/`PAID` approval action. Its month is that action's `at` in Asia/Kathmandu, Gregorian months. `spentByMonth` covers the last 6 months, oldest first.
- **Spent**: as the spend report counts expense, a paid reimbursement's amount and a settled settlement's amount. Paid advances are cash held, not spend.
- **Paid this month**: requests closed this month, and the sum of their `PAID` action amounts.
- **Cash held**: the outstanding balance (`advanceBalance`) of PAID advances, attributed to the advance's project.
- **Overdue settlement**: an open advance past `settlementDueOn` with an outstanding balance and no settlement in a `PENDING_*` state.
- **Decisions**: the caller's `APPROVED`, `RETURNED` and `REJECTED` actions at a non-requester step in the last 30 days. A request reached the caller's step at the action that moved it there in the same revision: the requester's submission, or the previous step's approval.

## 6. Web composition

- `apps/web/app/lib/` clients gain `getPortfolio`, `getWorkOrderSummary` and `getFinanceOverview`, with response types declared in the clients, as the existing clients do.
- `apps/web/app/overview/director-overview.tsx` (server component) loads the three summaries, the current user and their profile in parallel.
- `apps/web/app/overview/director-model.ts` (pure, given `now`) joins the three by `projectId` and applies section 3's rules. It shares the completion rule with `summarizeProject` rather than restating it.
- `apps/web/app/finance/` gains the "Before you decide" panel, the `handled` tab, the `decided` confirmation line and the approve-then-next redirect.
- `homeFor`, `page.tsx` and the `Sidebar` gain the `director` home.

## 7. Errors

Each panel renders from its own source, so one failing service never blanks the page:
- **finance unavailable:** Waiting on you shows a clear error with a link to `/finance`, since approval is the Director's only action. Money and Your decisions show an unavailable note.
- **qc unavailable:** Quality shows "—" and the portfolio notes "Work orders unavailable". For projects without milestone requirements, completion falls back to tasks only and is labelled partial.
- **project unavailable:** the portfolio shows the existing connection message. The finance panels still render.
- **Signed out:** the existing sign-in page. **Missing permission:** the panel is hidden, not an error.
- **The `decided` request cannot be read** (out of scope, deleted, service down): the confirmation line is left out and the page renders normally.

## 8. Security

- No new permissions or roles. Every number is scope-filtered in the service that owns it.
- `context` is present only for the approver at the request's current step, never for the requester or anyone else.
- Flags and context count only requests inside the caller's scope, so they reveal nothing the caller could not already open.
- `decided` carries an id only. The confirmation is built from a scope-checked read, never from the URL.
- The home and sidebar changes are presentation. The gateway and services enforce access.

## 9. Testing

- **`director-model.spec.ts`:** every schedule rule and its order; quality and money thresholds, including the minimum samples; worst signal wins and the tie sort; completion agrees with `summarizeProject` on the same inputs; the header sentence.
- **project integration spec:** portfolio scope (project and site scoped callers); milestone and fallback modes; site completion day; week buckets; ON_HOLD included, DRAFT, COMPLETED and CANCELLED excluded.
- **qc integration spec:** first-time approval; overdue; review wait; scope.
- **finance integration specs:** pipeline counts, amounts and `mine`; own requests excluded; closing month in Asia/Kathmandu across a month boundary; spent, cash held and overdue settlements; decisions, trimmed amounts and median time; each flag, including the 5-sample minimum and the settled advance left out of `REQUESTER_HOLDS_CASH`; `context` absent for the requester, a non-approver, and an approver at a different step; awaiting order.
- **web component specs:** the Director home with each service failing in turn; the `handled` tab; approve-then-next for a Director and a PM; the empty-queue redirect for each home; the `decided` line, and its absence when the read fails.
- **e2e:** the Director signs in and lands on `/`; a PM-approved request appears in Waiting on you; the Director approves it with a trimmed amount, lands on the next request or on home when the queue is empty, and finds it under Decided by me.

## 10. Rollout

No migrations, seed changes or new services. Deploy project, qc and finance before web: the web expects the new endpoints, and until they exist its panels show their unavailable states.

## 11. Next phase

Purchase orders bring budgets and committed spend. The Money signal and the per-project money figures are where they plug in: spend against budget, and committed against delivered.
