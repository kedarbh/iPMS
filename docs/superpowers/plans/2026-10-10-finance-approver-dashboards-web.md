# Finance Approver Dashboards (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give approvers (PM, Director, Finance) the Overview / Queue / History finance pages from the "Approver Dashboards Web" design, with inline Approve / Pay / Return dialogs.

**Architecture:** Mostly a web change. The finance service gains a `waiting` summary on `GET /finance/overview`, a `stage` filter and a `q` text search on `GET /finance/requests`. `/finance` renders Overview for approvers, `/finance/queue` and `/finance/history` are new routes, and a client `DecisionDialog` calls the existing server actions with a `from=queue` flag so they stay on the page.

**Tech Stack:** Next.js (app router, server actions), React 19, Vitest (`renderToStaticMarkup` specs), NestJS + Prisma finance service, zod contracts in `libs/contracts`.

**Spec:** `docs/superpowers/specs/2026-10-10-finance-approver-dashboards-web-design.md` (see its "Revisions" section, which this plan follows).

## Global Constraints

- Approver = holds any of `finance_approval.pm`, `finance_approval.director`, `finance_payment.record`, **and** `finance_request.view_all` (the overview endpoint refuses callers without it). Everyone else keeps today's `/finance` list.
- Money is a two-decimal string on the wire; format with `formatMoney` (`NPR 1,50,000.00`).
- The service is the authority for every decision; the web only hides buttons it knows the viewer cannot use.
- No new permissions, roles, migrations or services. No change to mobile or to the Director home's layout.
- Overview queue stays capped at `QUEUE_SIZE = 5`; the Queue page reads the full list via `listRequests({ view: 'awaiting' })`.
- Colours come from existing tokens `--ink --muted --line --blue --green --amber --red`; the app has no dark theme.
- Web specs run with `cd apps/web && npx vitest run <path>`; finance integration specs with `cd apps/finance && npx vitest run <path>` (they start a test Postgres via `startTestDb`, so Docker must be running).
- Commit after each task. Commit messages follow the repo's style (`feat(finance): …`).

## File Structure

| File | Responsibility |
|---|---|
| `libs/contracts/src/finance/overview.ts` | `FinanceOverview.waiting` type |
| `libs/contracts/src/finance/finance.ts` | `stage` and `q` on `ListRequestsQuerySchema` |
| `apps/finance/src/queries/overview.service.ts` | compute `waiting` |
| `apps/finance/src/queries/query.service.ts` | apply `stage` and `q` |
| `apps/web/app/lib/finance-api.ts` | pass `stage` / `q` through `listRequests` |
| `apps/web/app/finance/model.ts` | pure helpers: roles, queue actions, age, overdue, money sum, initials |
| `apps/web/app/finance/search.ts` | history query resolver, legacy `/finance?view=` redirect target |
| `apps/web/app/finance/requests-table.tsx` | list table, now with a `pageHref` prop |
| `apps/web/app/finance/overview-body.tsx` | presentational Overview (cards, banner, lists) |
| `apps/web/app/finance/queue-table.tsx` | client Queue table with action buttons |
| `apps/web/app/finance/decision-dialog.tsx` | client Approve / Return / Pay dialog |
| `apps/web/app/finance/page.tsx` | Overview for approvers, legacy redirect, engineer list |
| `apps/web/app/finance/queue/page.tsx` | Queue page |
| `apps/web/app/finance/history/page.tsx` | History page (old list, new chrome) |
| `apps/web/app/finance/actions.ts` | `from=queue` path, revalidate new routes |
| `apps/web/app/shell.tsx` | sidebar sub-nav and Queue badge |
| `apps/web/app/finance/finance.css` | new classes |

---

### Task 1: Finance service — `waiting`, `stage`, `q`

**Files:**
- Modify: `libs/contracts/src/finance/overview.ts`
- Modify: `libs/contracts/src/finance/finance.ts:117-123`
- Modify: `apps/finance/src/queries/overview.service.ts:68-79,111-120`
- Modify: `apps/finance/src/queries/query.service.ts:30-40`
- Test: `apps/finance/src/queries/overview.service.integration.spec.ts`, `apps/finance/src/queries/query.service.integration.spec.ts`

**Interfaces:**
- Produces: `FinanceOverview['waiting']` = `{ total: number; amount: string; oldestSince: string | null; byKind: Record<RequestKind, { count: number; amount: string }> }`
- Produces: `ListRequestsQuery` gains `stage?: 'approval' | 'closed'` and `q?: string`.

- [ ] **Step 1: Write the failing overview test**

Append inside `describe('OverviewService', …)` in `overview.service.integration.spec.ts`:

```ts
  it('totals everything waiting at the caller’s step, beyond the five the queue shows, by kind', async () => {
    for (let i = 0; i < 6; i += 1) await raise(ACTORS.pm, '100');
    await raise(ACTORS.pm, '50.50');
    await raise(ACTORS.engineer, '999'); // at the PM step, not the Director's
    const { waiting, queue } = await overviews.overview(ACTORS.director, scopes.project);
    expect(queue).toHaveLength(5);
    expect(waiting).toEqual({
      total: 7, amount: '650.50', oldestSince: expect.any(String),
      byKind: {
        ADVANCE: { count: 7, amount: '650.50' },
        SETTLEMENT: { count: 0, amount: '0.00' },
        REIMBURSEMENT: { count: 0, amount: '0.00' },
      },
    });
  });

  it('reports nothing waiting as zero with no oldest date', async () => {
    const { waiting } = await overviews.overview(ACTORS.director, scopes.project);
    expect(waiting).toMatchObject({ total: 0, amount: '0.00', oldestSince: null });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/finance && npx vitest run src/queries/overview.service.integration.spec.ts -t "totals everything waiting"`
Expected: FAIL (`waiting` is undefined).

- [ ] **Step 3: Add the contract type**

In `libs/contracts/src/finance/overview.ts`, add before `FinanceOverview` and inside it:

```ts
export interface WaitingSummary {
  total: number;
  amount: string;
  oldestSince: string | null;
  byKind: Record<RequestKind, { count: number; amount: string }>;
}
```

and in `FinanceOverview` add after `pipeline`:

```ts
  /** Everything waiting at the caller's step, uncapped (the queue below shows the first few). */
  waiting: WaitingSummary;
```

- [ ] **Step 4: Compute it in the service**

In `overview.service.ts` replace the `queueRows` line

```ts
    const queueRows = visible.filter((r) => mine.has(r.status)).slice(0, QUEUE_SIZE);
```

with

```ts
    const waitingRows = visible.filter((r) => mine.has(r.status));
    const ofKind = (kind: RequestKind) => {
      const rows = waitingRows.filter((r) => r.kind === kind);
      return { count: rows.length, amount: sumMoney(rows.map(amountOf)) };
    };
    const waiting = {
      total: waitingRows.length, amount: sumMoney(waitingRows.map(amountOf)), oldestSince: waitingRows[0]?.updatedAt.toISOString() ?? null,
      byKind: { ADVANCE: ofKind('ADVANCE'), SETTLEMENT: ofKind('SETTLEMENT'), REIMBURSEMENT: ofKind('REIMBURSEMENT') },
    };
    const queueRows = waitingRows.slice(0, QUEUE_SIZE);
```

and in the returned object add `waiting,` after the `pipeline: …` line.

- [ ] **Step 5: Run the overview tests**

Run: `cd apps/finance && npx vitest run src/queries/overview.service.integration.spec.ts`
Expected: PASS (all, including the two new ones).

- [ ] **Step 6: Write the failing list tests**

Append inside `describe('list', …)` in `query.service.integration.spec.ts`:

```ts
  it('filters by stage: approval is every pending step, closed is paid and settled', async () => {
    const pending = await make();
    const done = await make();
    await approvals.approve(done.id, {}, ACTORS.pm, scopes.project);
    await approvals.approve(done.id, {}, ACTORS.director, scopes.project);
    await payments.pay(done.id, { mode: 'CASH', reference: 'V-1', paidOn: new Date('2026-10-09') }, ACTORS.finance, scopes.global);
    const approval = await queries.list(ACTORS.pm, scopes.project, { view: 'all', stage: 'approval', page: 1, limit: 20 });
    expect(approval.items.map((i) => i.id)).toEqual([pending.id]);
    const closed = await queries.list(ACTORS.pm, scopes.project, { view: 'all', stage: 'closed', page: 1, limit: 20 });
    expect(closed.items.map((i) => i.id)).toEqual([done.id]);
  });

  it('searches number, purpose and project, ignoring case', async () => {
    const one = await make();
    const find = (q: string) => queries.list(ACTORS.pm, scopes.project, { view: 'all', q, page: 1, limit: 20 }).then((p) => p.items.map((i) => i.id));
    expect(await find(one.number.toLowerCase())).toEqual([one.id]);
    expect(await find('TRAV')).toEqual([one.id]);
    expect(await find(PROJECT.code.toLowerCase())).toEqual([one.id]);
    expect(await find('no such thing')).toEqual([]);
  });
```

(`PROJECT.code` exists in fixtures as the project code used for `projectCode`; if the fixture names it differently, use the field `requests.create` copies into `projectCode`.)

- [ ] **Step 7: Run to verify they fail**

Run: `cd apps/finance && npx vitest run src/queries/query.service.integration.spec.ts -t "stage|searches"`
Expected: FAIL (type error on `stage` / `q`, or unfiltered results).

- [ ] **Step 8: Extend the schema and the service**

In `libs/contracts/src/finance/finance.ts`, inside `ListRequestsQuerySchema` after `projectId`:

```ts
  /** approval: any pending step. closed: paid or settled. Combines with `status` as AND. */
  stage: z.enum(['approval', 'closed']).optional(),
  /** Text in the request number, purpose, project code or project name. */
  q: z.string().trim().min(1).max(100).optional(),
```

In `query.service.ts` add above `export class QueryService`:

```ts
const STAGE_STATUSES = { approval: ['PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE'], closed: ['PAID', 'SETTLED'] } as const;
```

and replace the `filters`/`full` definitions with:

```ts
    const filters: Prisma.FinanceRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
    };
    const extra: Prisma.FinanceRequestWhereInput[] = [];
    if (query.stage) extra.push({ status: { in: [...STAGE_STATUSES[query.stage]] } });
    if (query.q) {
      const has = { contains: query.q, mode: 'insensitive' as const };
      extra.push({ OR: [{ number: has }, { purpose: has }, { projectCode: has }, { projectName: has }] });
    }
    const full: Prisma.FinanceRequestWhereInput = { AND: [where, filters, ...extra] };
```

- [ ] **Step 9: Run both finance specs and the contracts typecheck**

Run: `cd apps/finance && npx vitest run src/queries && cd ../.. && npx tsc --noEmit -p libs/contracts`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add libs/contracts/src/finance apps/finance/src/queries
git commit -m "feat(finance): overview totals what is waiting; list filters by stage and text"
```

---

### Task 2: Web model helpers

**Files:**
- Modify: `apps/web/app/lib/finance-api.ts` (types + `listRequests`)
- Modify: `apps/web/app/finance/model.ts` (append)
- Test: `apps/web/app/finance/model.spec.ts` (append)

**Interfaces:**
- Produces (all exported from `model.ts`):
  - `addMoney(...amounts: readonly string[]): string`
  - `type ApproverRole = 'DIRECTOR' | 'PM' | 'FINANCE'`; `approverRole(permissions: readonly string[]): ApproverRole | null`; `ROLE_LABEL: Record<ApproverRole, string>`; `waitingTitle(role: ApproverRole): string`
  - `type QueueAction = 'approve' | 'pay' | 'return'`; `queueActions(status: RequestStatus, permissions: readonly string[]): QueueAction[]`
  - `waitingDays(since: string, now: Date): number`; `waitLabel(days: number): string`; `waitTone(days: number): 'amber' | 'slate'`
  - `overdueSummary(projects, holders, names): { count: number; amount: string; people: string[] } | null`
  - `initials(name: string): string`; `KIND_PLURAL: Record<RequestKind, string>`
- Produces (finance-api): `RequestFilter` gains `stage?: 'approval' | 'closed'` and `q?: string`; both are sent as query params.

- [ ] **Step 1: Write the failing tests**

Add to the import at the top of `model.spec.ts`: `addMoney, approverRole, initials, overdueSummary, queueActions, waitLabel, waitTone, waitingDays, waitingTitle`. Append:

```ts
describe('addMoney', () => {
  it('adds two-decimal strings exactly', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(addMoney('1000.00', '250.50', '99.99')).toBe('1350.49');
    expect(addMoney()).toBe('0.00');
  });
});

describe('approverRole', () => {
  it('picks the most senior approval the viewer holds', () => {
    expect(approverRole(DIR.permissions)).toBe('DIRECTOR');
    expect(approverRole(PM.permissions)).toBe('PM');
    expect(approverRole(FIN.permissions)).toBe('FINANCE');
    expect(approverRole(ENG.permissions)).toBeNull();
    expect(approverRole([...DIR.permissions, ...FIN.permissions])).toBe('DIRECTOR');
  });
  it('words the dark card for what the role does', () => {
    expect(waitingTitle('PM')).toBe('Waiting for your approval');
    expect(waitingTitle('FINANCE')).toBe('Waiting for payment');
  });
});

describe('queueActions', () => {
  it('offers approve and return at the viewer’s own step only', () => {
    expect(queueActions('PENDING_PM', PM.permissions)).toEqual(['approve', 'return']);
    expect(queueActions('PENDING_DIRECTOR', PM.permissions)).toEqual([]);
    expect(queueActions('PENDING_DIRECTOR', DIR.permissions)).toEqual(['approve', 'return']);
  });
  it('offers pay in place of approve for finance', () => {
    expect(queueActions('PENDING_FINANCE', FIN.permissions)).toEqual(['pay', 'return']);
    expect(queueActions('PENDING_FINANCE', DIR.permissions)).toEqual([]);
    expect(queueActions('PAID', FIN.permissions)).toEqual([]);
  });
});

describe('waiting age', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  it('counts whole days and never goes negative', () => {
    expect(waitingDays('2026-10-10T08:00:00Z', now)).toBe(0);
    expect(waitingDays('2026-10-07T11:00:00Z', now)).toBe(3);
    expect(waitingDays('2026-10-11T00:00:00Z', now)).toBe(0);
  });
  it('labels and tones the age', () => {
    expect(waitLabel(0)).toBe('Today');
    expect(waitLabel(1)).toBe('1 day');
    expect(waitLabel(4)).toBe('4 days');
    expect(waitTone(2)).toBe('slate');
    expect(waitTone(3)).toBe('amber');
  });
});

describe('overdueSummary', () => {
  const project = (count: number, amount: string) => ({ projectId: 'p', code: 'C', name: 'N', spentToDate: '0.00', spentByMonth: [], cashHeld: '0.00', overdueSettlements: { count, amount } });
  const names = new Map([['u-1', 'Anil Gurung'], ['u-2', 'Bikash Tamang']]);
  it('is null when nothing is overdue', () => {
    expect(overdueSummary([project(0, '0.00')], [], names)).toBeNull();
  });
  it('totals the projects and names the people holding overdue cash', () => {
    const holders = [
      { requesterId: 'u-1', outstanding: '23500.00', open: 2, overdue: 1 },
      { requesterId: 'u-2', outstanding: '45000.00', open: 1, overdue: 1 },
      { requesterId: 'u-3', outstanding: '1000.00', open: 1, overdue: 0 },
    ];
    expect(overdueSummary([project(1, '20000.00'), project(1, '25000.00')], holders, names)).toEqual({ count: 2, amount: '45000.00', people: ['Anil Gurung', 'Bikash Tamang'] });
  });
});

describe('initials', () => {
  it('takes the first letters of up to two words', () => {
    expect(initials('Bikash Tamang')).toBe('BT');
    expect(initials('sita')).toBe('S');
    expect(initials('')).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run app/finance/model.spec.ts`
Expected: FAIL (`addMoney` etc. are not exported).

- [ ] **Step 3: Implement the helpers**

At the top of `model.ts` change the first import to also bring `FinanceOverview`, `RequestKind`, `RequestStatus`:

```ts
import type { FinanceOverview, FinanceRequest, FinanceRequestDetail, FinanceStep, RequestFlag, RequestKind, RequestStatus } from '../lib/finance-api';
```

Append to `model.ts`:

```ts
export const KIND_PLURAL: Record<RequestKind, string> = { ADVANCE: 'Advances', SETTLEMENT: 'Settlements', REIMBURSEMENT: 'Reimbursements' };

/** Money strings are always two decimals, so adding their cents is exact. */
export function addMoney(...amounts: readonly string[]): string {
  const cents = amounts.reduce((sum, amount) => sum + BigInt(amount.replace('.', '')), 0n);
  const digits = cents.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export type ApproverRole = 'DIRECTOR' | 'PM' | 'FINANCE';
export const ROLE_LABEL: Record<ApproverRole, string> = { DIRECTOR: 'Project director', PM: 'Project manager', FINANCE: 'Finance' };

/** The approval the viewer is framed by, most senior first; null for someone who approves nothing. */
export function approverRole(permissions: readonly string[]): ApproverRole | null {
  if (permissions.includes('finance_approval.director')) return 'DIRECTOR';
  if (permissions.includes('finance_approval.pm')) return 'PM';
  if (permissions.includes('finance_payment.record')) return 'FINANCE';
  return null;
}

export const waitingTitle = (role: ApproverRole): string => (role === 'FINANCE' ? 'Waiting for payment' : 'Waiting for your approval');

export type QueueAction = 'approve' | 'pay' | 'return';

/** The inline buttons for a waiting request: the viewer's own step only. The service still decides. */
export function queueActions(status: RequestStatus, permissions: readonly string[]): QueueAction[] {
  const can = (permission: string): boolean => permissions.includes(permission);
  if (status === 'PENDING_PM' && can('finance_approval.pm')) return ['approve', 'return'];
  if (status === 'PENDING_DIRECTOR' && can('finance_approval.director')) return ['approve', 'return'];
  if (status === 'PENDING_FINANCE' && can('finance_payment.record')) return ['pay', 'return'];
  return [];
}

export const waitingDays = (since: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000));
export const waitLabel = (days: number): string => (days === 0 ? 'Today' : dayCount(days));
export const waitTone = (days: number): 'amber' | 'slate' => (days >= 3 ? 'amber' : 'slate');

/** The red banner: overdue settlements across the projects, and who holds them; null when there are none. */
export function overdueSummary(
  projects: FinanceOverview['projects'], holders: FinanceOverview['cashHolders'], names: ReadonlyMap<string, string>,
): { count: number; amount: string; people: string[] } | null {
  const late = projects.filter((p) => p.overdueSettlements.count > 0);
  const count = late.reduce((total, p) => total + p.overdueSettlements.count, 0);
  if (count === 0) return null;
  return {
    count,
    amount: addMoney(...late.map((p) => p.overdueSettlements.amount)),
    people: holders.filter((h) => h.overdue > 0).map((h) => personName(h.requesterId, names)),
  };
}

export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join('');
```

- [ ] **Step 4: Pass `stage` and `q` through the API client**

In `finance-api.ts` add to `RequestFilter`:

```ts
  stage?: 'approval' | 'closed' | undefined; q?: string | undefined;
```

and in `listRequests`'s `query:` object add `stage: filter.stage, q: filter.q,`. Also re-export the waiting type: change the `export type { … }` line to include `WaitingSummary` only if you import it (not needed otherwise; skip).

- [ ] **Step 5: Run the specs and typecheck**

Run: `cd apps/web && npx vitest run app/finance/model.spec.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/finance/model.ts apps/web/app/finance/model.spec.ts apps/web/app/lib/finance-api.ts
git commit -m "feat(web): finance model helpers for the approver dashboards"
```

---

### Task 3: History query resolver and legacy redirect

**Files:**
- Modify: `apps/web/app/finance/search.ts` (append)
- Create: `apps/web/app/finance/search.spec.ts` additions (file exists: append)
- Modify: `apps/web/app/finance/requests-table.tsx`
- Modify: `apps/web/app/finance/requests-table.spec.tsx`

**Interfaces:**
- Produces:
  - `HISTORY_PILLS: readonly { key: string; label: string; stage?: 'approval' | 'closed'; status?: RequestStatus; view?: 'handled' }[]`
  - `resolveHistory(search: RawHistory, caps: { mayAct: boolean; seeAll: boolean }): ResolvedHistory`
  - `legacyTarget(search: RawSearch): string | null`
  - `historyHref(params: { filter?: string; q?: string; status?: string; kind?: string; page?: number }): string` → `/finance/history?…`
- `RequestsTable` props become `{ page; names; view; pageHref?: (page: number) => string }`; `financeHref` is removed.

- [ ] **Step 1: Write the failing tests**

Append to `search.spec.ts` (add `HISTORY_PILLS, historyHref, legacyTarget, resolveHistory` to its import from `./search`):

```ts
describe('resolveHistory', () => {
  const caps = { mayAct: true, seeAll: true };
  it('shows everything to a viewer who sees all, and only their own to the rest', () => {
    expect(resolveHistory({}, caps)).toMatchObject({ view: 'all', pill: 'all', page: 1 });
    expect(resolveHistory({}, { mayAct: false, seeAll: false })).toMatchObject({ view: 'mine' });
  });
  it('maps a pill onto the service filters', () => {
    expect(resolveHistory({ filter: 'approval' }, caps)).toMatchObject({ pill: 'approval', stage: 'approval' });
    expect(resolveHistory({ filter: 'closed' }, caps)).toMatchObject({ stage: 'closed' });
    expect(resolveHistory({ filter: 'returned' }, caps)).toMatchObject({ status: 'RETURNED' });
  });
  it('offers decided-by-me only to approvers who see all', () => {
    expect(resolveHistory({ filter: 'handled' }, caps)).toMatchObject({ view: 'handled', pill: 'handled' });
    expect(resolveHistory({ filter: 'handled' }, { mayAct: false, seeAll: true })).toMatchObject({ view: 'all', pill: 'all' });
  });
  it('keeps the old view, status and kind params and a text query', () => {
    expect(resolveHistory({ view: 'mine', status: 'PENDING_DIRECTOR', kind: 'ADVANCE', q: ' ADV-2026 ', page: '3' }, caps))
      .toMatchObject({ view: 'mine', status: 'PENDING_DIRECTOR', kind: 'ADVANCE', q: 'ADV-2026', page: 3 });
    expect(resolveHistory({ view: 'all' }, { mayAct: false, seeAll: false })).toMatchObject({ view: 'mine' });
  });
});

describe('historyHref', () => {
  it('keeps only what is set', () => {
    expect(historyHref({})).toBe('/finance/history');
    expect(historyHref({ filter: 'approval', q: 'fuel', page: 2 })).toBe('/finance/history?filter=approval&q=fuel&page=2');
    expect(historyHref({ filter: 'all' })).toBe('/finance/history');
  });
});

describe('legacyTarget', () => {
  it('sends the old awaiting view to the queue and other views to history', () => {
    expect(legacyTarget({})).toBeNull();
    expect(legacyTarget({ view: 'awaiting' })).toBe('/finance/queue');
    expect(legacyTarget({ view: 'awaiting', decided: 'r-1' })).toBe('/finance/queue?decided=r-1');
    expect(legacyTarget({ view: 'handled' })).toBe('/finance/history?view=handled');
    expect(legacyTarget({ view: 'all', status: 'PAID', page: '2' })).toBe('/finance/history?view=all&status=PAID&page=2');
  });
});
```

For the table, in `requests-table.spec.tsx` replace the `html` helper's render with `view="awaiting" pageHref={(n) => `/x?page=${n}`}` and add:

```tsx
  it('pages through the href the page supplies', () => {
    const out = html([row()], { total: 45 });
    expect(out).toContain('Page 1 of 3');
    expect(out).toContain('href="/x?page=2"');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run app/finance/search.spec.ts app/finance/requests-table.spec.tsx`
Expected: FAIL (new exports missing; table has no `pageHref`).

- [ ] **Step 3: Implement the resolver**

Append to `search.ts`:

```ts
export const HISTORY_PILLS = [
  { key: 'all', label: 'All' },
  { key: 'approval', label: 'In approval', stage: 'approval' },
  { key: 'closed', label: 'Paid & settled', stage: 'closed' },
  { key: 'returned', label: 'Returned', status: 'RETURNED' },
  { key: 'rejected', label: 'Rejected', status: 'REJECTED' },
  { key: 'handled', label: 'Decided by me', view: 'handled' },
] as const satisfies readonly { key: string; label: string; stage?: 'approval' | 'closed'; status?: RequestStatus; view?: 'handled' }[];

export interface RawHistory extends RawSearch { filter?: string; q?: string }
export interface ResolvedHistory {
  view: RequestView; pill: string; page: number; status?: RequestStatus; stage?: 'approval' | 'closed'; kind?: RequestKind; q?: string;
}

/** The history page's query string, checked. Decided-by-me is for approvers who see everything; `view=awaiting` is the Queue's, never History's. */
export function resolveHistory(search: RawHistory, caps: { mayAct: boolean; seeAll: boolean }): ResolvedHistory {
  const pill = HISTORY_PILLS.find((p) => p.key === search.filter && (p.key !== 'handled' || (caps.mayAct && caps.seeAll)));
  const legacyView = search.view === 'handled' && caps.mayAct && caps.seeAll ? 'handled'
    : search.view === 'all' && caps.seeAll ? 'all' : search.view === 'mine' ? 'mine' : undefined;
  const view: RequestView = pill && 'view' in pill ? pill.view : legacyView ?? (caps.seeAll ? 'all' : 'mine');
  const status = (pill && 'status' in pill ? pill.status : undefined) ?? STATUSES.find((s) => s === search.status);
  const kind = KINDS.find((k) => k === search.kind);
  const q = search.q?.trim();
  return {
    view, pill: pill?.key ?? 'all', page: Math.max(1, Math.floor(Number(search.page)) || 1),
    ...(status ? { status } : {}),
    ...(pill && 'stage' in pill ? { stage: pill.stage } : {}),
    ...(kind ? { kind } : {}),
    ...(q ? { q } : {}),
  };
}

export function historyHref(params: { filter?: string; q?: string; status?: string; kind?: string; page?: number }): string {
  const out = new URLSearchParams();
  if (params.filter && params.filter !== 'all') out.set('filter', params.filter);
  if (params.status) out.set('status', params.status);
  if (params.kind) out.set('kind', params.kind);
  if (params.q) out.set('q', params.q);
  if (params.page !== undefined && params.page > 1) out.set('page', String(params.page));
  const text = out.toString();
  return text ? `/finance/history?${text}` : '/finance/history';
}

/** Where an old `/finance?view=…` link now lives, or null when the URL carries no old view. */
export function legacyTarget(search: RawSearch): string | null {
  if (!search.view) return null;
  const params = new URLSearchParams();
  if (search.view === 'awaiting') {
    if (search.kind) params.set('kind', search.kind);
    if (search.decided) params.set('decided', search.decided);
    const text = params.toString();
    return text ? `/finance/queue?${text}` : '/finance/queue';
  }
  params.set('view', search.view);
  for (const key of ['status', 'kind', 'page'] as const) if (search[key]) params.set(key, search[key]!);
  return `/finance/history?${params.toString()}`;
}
```

Note: `historyHref` omits `page` of 1, so the "Previous" link from page 2 is the clean URL.

- [ ] **Step 4: Update the table**

In `requests-table.tsx`: delete `TableQuery` and `financeHref`; change the signature and pager:

```tsx
export function RequestsTable({ page, names, view, pageHref }: { page: RequestPage; names: ReadonlyMap<string, string>; view: RequestView; pageHref?: (page: number) => string }) {
```

```tsx
      {last > 1 && pageHref ? (
        <nav className="pager" aria-label="Pages">
          {page.page > 1 ? <a className="ghost-button" href={pageHref(page.page - 1)}>Previous</a> : <span />}
          <span className="subtle">Page {page.page} of {last}</span>
          {page.page < last ? <a className="ghost-button" href={pageHref(page.page + 1)}>Next</a> : <span />}
        </nav>
      ) : null}
```

(Task 5 updates `page.tsx`, which still imports `financeHref`; run only the two specs in this task.)

- [ ] **Step 5: Run the specs**

Run: `cd apps/web && npx vitest run app/finance/search.spec.ts app/finance/requests-table.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/finance/search.ts apps/web/app/finance/search.spec.ts apps/web/app/finance/requests-table.tsx apps/web/app/finance/requests-table.spec.tsx
git commit -m "feat(web): history query resolver and the legacy finance redirect"
```

---

### Task 4: Server actions stay on the Queue

**Files:**
- Modify: `apps/web/app/finance/actions.ts:17-37,114-142,144-156`
- Test: `apps/web/app/finance/actions.spec.ts`

**Interfaces:**
- Consumes: forms posting a hidden `from=queue`.
- Produces: with `from=queue`, `approveAction`, `returnAction` and `payAction` return `{ done: true }` on success and never redirect; revalidation covers `/finance/queue` and `/finance/history`. After a decision without `from=queue`, the "no next request" fallback goes to `/finance/queue?decided=<id>`.

- [ ] **Step 1: Write the failing tests**

Add to `actions.spec.ts` (inside the existing describes for approve/return/pay if present, otherwise as new `describe`s):

```ts
describe('decisions made from the queue', () => {
  it('approves and stays put', async () => {
    const state = await actions.approveAction(EMPTY, form({ id: 'r-1', from: 'queue' }));
    expect(state).toEqual({ done: true });
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/finance/queue');
    expect(revalidatePath).toHaveBeenCalledWith('/finance/history');
  });

  it('returns with a reason and stays put, and still asks for the reason', async () => {
    expect(await actions.returnAction(EMPTY, form({ id: 'r-1', from: 'queue' }))).toEqual({ error: 'Say why.' });
    expect(await actions.returnAction(EMPTY, form({ id: 'r-1', from: 'queue', comment: 'Bill missing' }))).toEqual({ done: true });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('records a payment and reports it done', async () => {
    const state = await actions.payAction(EMPTY, form({ id: 'r-1', from: 'queue', mode: 'CASH', reference: 'V-1', paidOn: '2026-10-10' }));
    expect(state).toEqual({ done: true });
  });

  it('shows the service’s refusal and does not report done', async () => {
    api.approveRequest.mockResolvedValue({ state: 'forbidden', message: 'You already approved this' });
    expect(await actions.approveAction(EMPTY, form({ id: 'r-1', from: 'queue' }))).toEqual({ error: 'You already approved this' });
  });

  it('without the flag, a decision still opens the next request', async () => {
    api.listRequests.mockResolvedValue(ready({ items: [{ id: 'r-2' }], total: 1, page: 1, limit: 2 }));
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1' }))).rejects.toThrow('NEXT_REDIRECT:/finance/requests/r-2?decided=r-1');
  });

  it('without the flag and nothing left, lands on the queue', async () => {
    await expect(actions.approveAction(EMPTY, form({ id: 'r-1' }))).rejects.toThrow('NEXT_REDIRECT:/finance/queue?decided=r-1');
  });
});
```

Also search `actions.spec.ts` for any existing expectation of `/finance?view=awaiting&decided=` and change it to `/finance/queue?decided=`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && npx vitest run app/finance/actions.spec.ts`
Expected: FAIL (the `from=queue` calls redirect or return `{}`).

- [ ] **Step 3: Implement**

In `actions.ts`:

```ts
/** Every page a change to one request shows on: the workspace, its lists and the request itself. */
const pages = (id: string): string[] => ['/finance', '/finance/queue', '/finance/history', `/finance/requests/${id}`];
```

Change the last line of `nextAfterDecision`:

```ts
  redirect(director ? `/?decided=${decidedId}` : `/finance/queue?decided=${decidedId}`);
```

Add below `MISSING_REQUEST`:

```ts
/** A decision made in the queue's dialog finishes there; the list refreshes and the dialog closes. */
const fromQueue = (form: FormData): boolean => optional(form, 'from') === 'queue';
```

In `approveAction`, `returnAction` and `rejectAction` replace `return state.error ? state : nextAfterDecision(id);` with:

```ts
  if (state.error) return state;
  return fromQueue(form) ? { done: true } : nextAfterDecision(id);
```

and in `payAction` replace the final `return settle(await payRequest(id, body), pages(id));` with:

```ts
  const state = await settle(await payRequest(id, body), pages(id));
  return !state.error && fromQueue(form) ? { done: true } : state;
```

- [ ] **Step 4: Run the spec**

Run: `cd apps/web && npx vitest run app/finance/actions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/finance/actions.ts apps/web/app/finance/actions.spec.ts
git commit -m "feat(web): finance decisions can finish in place when made from the queue"
```

---

### Task 5: Decision dialog and Queue table

**Files:**
- Modify: `apps/web/app/finance/requests/[id]/panels.tsx` (export `PaymentFields`)
- Create: `apps/web/app/finance/decision-dialog.tsx`
- Create: `apps/web/app/finance/queue-table.tsx`
- Test: `apps/web/app/finance/decision-dialog.spec.tsx`, `apps/web/app/finance/queue-table.spec.tsx`

**Interfaces:**
- Consumes: `approveAction`, `returnAction`, `payAction` (Task 4); `queueActions`, `waitingDays`, `waitLabel`, `waitTone`, `initials`, `flagText`, `formatMoney`, `KIND_LABEL` (Task 2).
- Produces:
  - `DialogRequest = { id: string; number: string; kind: RequestKind; status: RequestStatus; purpose: string; requestedAmount: string; approvedAmount: string | null; flags: string[] }`
  - `DecisionDialog({ request, kind, onClose }: { request: DialogRequest; kind: QueueAction; onClose: () => void })`
  - `QueueTable({ items, names, permissions, now }: { items: FinanceRequest[]; names: Record<string, string>; permissions: string[]; now: string })`

- [ ] **Step 1: Export `PaymentFields`**

In `panels.tsx` change `function PaymentFields(` to `export function PaymentFields(`.

- [ ] **Step 2: Write the failing dialog spec**

`apps/web/app/finance/decision-dialog.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../components/toast', () => ({
  useActionStateWithToast: (_action: unknown, initial: unknown) => [initial, () => undefined],
}));
vi.mock('./actions', () => ({ approveAction: vi.fn(), returnAction: vi.fn(), payAction: vi.fn() }));
vi.mock('react-dom', async (original) => ({ ...(await original<typeof import('react-dom')>()), useFormStatus: () => ({ pending: false }) }));

const { DecisionDialog } = await import('./decision-dialog');

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE', status: 'PENDING_DIRECTOR', purpose: 'Site travel',
  requestedAmount: '50000.00', approvedAmount: null, flags: [], ...over,
}) as never;
const html = (kind: 'approve' | 'return' | 'pay', over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<DecisionDialog request={request(over)} kind={kind} onClose={() => undefined} />);

describe('DecisionDialog', () => {
  it('names the request and posts from the queue', () => {
    const out = html('approve');
    expect(out).toContain('role="dialog"');
    expect(out).toContain('ADV-2026-0007');
    expect(out).toContain('Site travel');
    expect(out).toContain('NPR 50,000.00');
    expect(out).toContain('name="from" value="queue"');
    expect(out).toContain('name="id" value="r-1"');
  });

  it('lets only the director trim the amount', () => {
    expect(html('approve')).toContain('name="amount"');
    expect(html('approve', { status: 'PENDING_PM' })).not.toContain('name="amount"');
  });

  it('requires a reason to return', () => {
    const out = html('return');
    expect(out).toMatch(/<textarea[^>]*name="comment"[^>]*required/);
    expect(out).toContain('Return to requester');
  });

  it('asks for payment details when money moves, and not for a settlement', () => {
    expect(html('pay', { status: 'PENDING_FINANCE' })).toMatch(/<select[^>]*name="mode"[^>]*required/);
    expect(html('pay', { status: 'PENDING_FINANCE', kind: 'SETTLEMENT' })).not.toMatch(/<select[^>]*name="mode"[^>]*required/);
  });

  it('shows the row’s warnings above the fields', () => {
    expect(html('approve', { flags: ['Possible duplicate: Fuel stop on ADV-2026-0003'] })).toContain('Possible duplicate: Fuel stop on ADV-2026-0003');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/web && npx vitest run app/finance/decision-dialog.spec.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the dialog**

`apps/web/app/finance/decision-dialog.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import { FormError, SubmitButton } from '../components/forms';
import { useActionStateWithToast } from '../components/toast';
import { EMPTY } from '../lib/form-state';
import type { RequestKind, RequestStatus } from '../lib/finance-api';
import { approveAction, payAction, returnAction } from './actions';
import { KIND_LABEL, formatMoney, type QueueAction } from './model';
import { PaymentFields } from './requests/[id]/panels';

export interface DialogRequest {
  id: string; number: string; kind: RequestKind; status: RequestStatus; purpose: string;
  requestedAmount: string; approvedAmount: string | null; flags: string[];
}

const COPY: Record<QueueAction, { title: string; button: string; success: string }> = {
  approve: { title: 'Approve', button: 'Approve', success: 'Approved' },
  return: { title: 'Return to requester', button: 'Return to requester', success: 'Returned' },
  pay: { title: 'Record payment', button: 'Record payment', success: 'Payment recorded' },
};

/** A centred dialog over the queue. The action finishes with `done`, which closes it; an error stays inline. */
export function DecisionDialog({ request, kind, onClose }: { request: DialogRequest; kind: QueueAction; onClose: () => void }) {
  const action = kind === 'approve' ? approveAction : kind === 'pay' ? payAction : returnAction;
  const settlement = request.kind === 'SETTLEMENT';
  const copy = kind === 'pay' && settlement ? { title: 'Settle', button: 'Confirm settlement', success: 'Settled' } : COPY[kind];
  const [state, run] = useActionStateWithToast(action, EMPTY, copy.success);

  useEffect(() => { if (state.done) onClose(); }, [state.done, onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fin-dialog-overlay" onClick={onClose}>
      <div className="fin-dialog" role="dialog" aria-modal="true" aria-label={`${copy.title} ${request.number}`} onClick={(event) => event.stopPropagation()}>
        <header className="fin-dialog-head">
          <div>
            <p className="eyebrow">{KIND_LABEL[request.kind].toUpperCase()} · {request.number}</p>
            <h2>{copy.title}</h2>
            <p className="subtle">{request.purpose} · {formatMoney(request.approvedAmount ?? request.requestedAmount)}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {request.flags.length > 0 ? (
          <ul className="finance-flags fin-dialog-flags" aria-label="Warnings">{request.flags.map((flag) => <li key={flag} className="amber">{flag}</li>)}</ul>
        ) : null}
        <form action={run} className="panel-form">
          <input type="hidden" name="id" value={request.id} />
          <input type="hidden" name="from" value="queue" />
          {kind === 'approve' && request.status === 'PENDING_DIRECTOR' ? (
            <label className="field">Approved amount (NPR)
              <input name="amount" inputMode="decimal" placeholder={request.requestedAmount} />
              <span className="hint">Leave empty to approve {formatMoney(request.requestedAmount)}, or enter a lower amount.</span>
            </label>
          ) : null}
          {kind === 'approve' ? <label className="field">Note (optional)<input name="comment" maxLength={1000} /></label> : null}
          {kind === 'return' ? <label className="field">Why? The requester will see this.<textarea name="comment" required maxLength={1000} rows={3} /></label> : null}
          {kind === 'pay' ? (
            <>
              <p className="form-note">Approved amount: <strong>{formatMoney(request.approvedAmount ?? request.requestedAmount)}</strong>.{settlement ? ' Payment details are needed only if money is paid out.' : ''}</p>
              <PaymentFields required={!settlement} />
            </>
          ) : null}
          <FormError state={state} />
          <div className="fin-dialog-actions">
            <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
            <SubmitButton className={kind === 'return' ? 'danger-button' : 'primary-button'}>{copy.button}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the dialog spec**

Run: `cd apps/web && npx vitest run app/finance/decision-dialog.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Write the failing queue-table spec**

`apps/web/app/finance/queue-table.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('./decision-dialog', () => ({ DecisionDialog: () => null }));

const { QueueTable } = await import('./queue-table');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE', status: 'PENDING_PM', revision: 1, entryStatus: 'PENDING_PM',
  projectId: 'p-1', projectCode: 'NP004', projectName: 'Pokhara Hydro Retrofit', workOrderId: null, categoryId: 'c-1',
  requesterId: 'u-eng', advanceId: null, purpose: 'Taxi to Pokhara', requestedAmount: '2400.00', approvedAmount: null,
  appliedAmount: null, submittedAt: '2026-10-05T08:00:00Z', createdAt: '2026-10-05T07:00:00Z', updatedAt: '2026-10-07T08:00:00Z',
  category: { code: 'TRAVEL', name: 'Travel' }, ...over,
});
const PM = ['finance_approval.pm'];
const NOW = '2026-10-10T08:00:00Z';
const html = (items: unknown[], permissions = PM) =>
  renderToStaticMarkup(<QueueTable items={items as never} names={{ 'u-eng': 'Bikash Tamang' }} permissions={permissions} now={NOW} />);

describe('QueueTable', () => {
  it('shows the request, who, where, how much and how long', () => {
    const out = html([row()]);
    expect(out).toContain('href="/finance/requests/r-1"');
    expect(out).toContain('ADV-2026-0007');
    expect(out).toContain('Taxi to Pokhara');
    expect(out).toContain('Bikash Tamang');
    expect(out).toContain('BT');
    expect(out).toContain('NP004');
    expect(out).toContain('NPR 2,400.00');
    expect(out).toContain('3 days');
    expect(out).toContain('amber');
  });

  it('offers Approve and Return at the viewer’s step, and Pay at finance', () => {
    const pm = html([row()]);
    expect(pm).toContain('>Approve<');
    expect(pm).toContain('>Return<');
    const fin = html([row({ status: 'PENDING_FINANCE' })], ['finance_payment.record']);
    expect(fin).toContain('>Pay<');
    expect(fin).not.toContain('>Approve<');
  });

  it('offers no buttons for a step the viewer does not hold', () => {
    const out = html([row({ status: 'PENDING_DIRECTOR' })]);
    expect(out).not.toContain('>Approve<');
    expect(out).not.toContain('>Return<');
  });

  it('shows the warnings a row carries', () => {
    expect(html([row({ flags: [{ code: 'WAITING_LONG', tone: 'amber', days: 5 }] })])).toContain('Waiting 5 days');
  });

  it('says the queue is clear when empty', () => {
    expect(html([])).toContain('Nothing waits on you.');
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `cd apps/web && npx vitest run app/finance/queue-table.spec.tsx`
Expected: FAIL (module not found).

- [ ] **Step 8: Implement the table**

`apps/web/app/finance/queue-table.tsx`:

```tsx
'use client';
import { useCallback, useState } from 'react';
import type { FinanceRequest } from '../lib/finance-api';
import { DecisionDialog, type DialogRequest } from './decision-dialog';
import { KIND_LABEL, flagText, formatMoney, initials, queueActions, waitLabel, waitTone, waitingDays, type QueueAction } from './model';

const BUTTON: Record<QueueAction, { label: string; className: string }> = {
  approve: { label: 'Approve', className: 'primary-button' },
  pay: { label: 'Pay', className: 'primary-button' },
  return: { label: 'Return', className: 'ghost-button' },
};

/** The waiting list with a decision on each row. Names arrive as a plain object so the server page can hand them over. */
export function QueueTable({ items, names, permissions, now }: { items: FinanceRequest[]; names: Record<string, string>; permissions: string[]; now: string }) {
  const [open, setOpen] = useState<{ request: DialogRequest; kind: QueueAction } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  if (items.length === 0) return <p className="finance-empty">Nothing waits on you.</p>;
  const at = new Date(now);

  return (
    <>
      <div className="finance-table-wrap">
        <table className="finance-table fin-queue">
          <thead>
            <tr><th>Request</th><th>Purpose</th><th>Project</th><th className="finance-num">Amount</th><th>Waiting</th><th><span className="sr-only">Decide</span></th></tr>
          </thead>
          <tbody>
            {items.map((request) => {
              const who = names[request.requesterId] ?? `${request.requesterId.slice(0, 8)}…`;
              const days = waitingDays(request.updatedAt, at);
              const dialog: DialogRequest = {
                id: request.id, number: request.number, kind: request.kind, status: request.status, purpose: request.purpose,
                requestedAmount: request.requestedAmount, approvedAmount: request.approvedAmount, flags: (request.flags ?? []).map(flagText),
              };
              return (
                <tr key={request.id}>
                  <td><a href={`/finance/requests/${request.id}`}><strong>{request.number}</strong></a><span className="subtle">{KIND_LABEL[request.kind]}</span></td>
                  <td>
                    <div className="fin-who">
                      <span className="fin-avatar" aria-hidden="true">{initials(who)}</span>
                      <div>
                        <strong>{request.purpose}</strong><span className="subtle">{who}</span>
                        {request.flags && request.flags.length > 0 ? (
                          <ul className="finance-flags" aria-label="Warnings">
                            {request.flags.map((flag) => <li key={flag.code} className={flag.tone}>{flagText(flag)}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>{request.projectCode}<span className="subtle">{request.projectName}</span></td>
                  <td className="finance-num">{formatMoney(request.approvedAmount ?? request.requestedAmount)}<span className="subtle">{request.category?.name ?? ''}</span></td>
                  <td><span className={`finance-pill ${waitTone(days)}`}>{waitLabel(days)}</span></td>
                  <td className="fin-row-actions">
                    {queueActions(request.status, permissions).map((kind) => (
                      <button key={kind} type="button" className={BUTTON[kind].className} onClick={() => setOpen({ request: dialog, kind })}>{BUTTON[kind].label}</button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open ? <DecisionDialog request={open.request} kind={open.kind} onClose={close} /> : null}
    </>
  );
}
```

The spec calls for `waitTone` returning `'amber' | 'slate'`; `finance-pill slate` and `amber` already exist in `finance.css`.

- [ ] **Step 9: Run the specs and typecheck**

Run: `cd apps/web && npx vitest run app/finance/queue-table.spec.tsx app/finance/decision-dialog.spec.tsx app/finance/requests && npx tsc --noEmit`
Expected: PASS (the `requests` path re-runs `panels.spec.tsx` to confirm exporting `PaymentFields` broke nothing).

- [ ] **Step 10: Commit**

```bash
git add apps/web/app/finance
git commit -m "feat(web): queue table with inline decision dialogs"
```

---

### Task 6: Overview body

**Files:**
- Create: `apps/web/app/finance/overview-body.tsx`
- Test: `apps/web/app/finance/overview-body.spec.tsx`

**Interfaces:**
- Consumes: `FinanceOverview` (Task 1), helpers (Task 2).
- Produces: `OverviewBody({ overview, names, role, now }: { overview: FinanceOverview; names: ReadonlyMap<string, string>; role: ApproverRole; now: Date })` — a server-renderable component with no client state.

- [ ] **Step 1: Write the failing spec**

`apps/web/app/finance/overview-body.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverviewBody } from './overview-body';

const NOW = new Date('2026-10-10T08:00:00Z');
const names = new Map([['u-1', 'Anil Gurung'], ['u-2', 'Bikash Tamang']]);
const overview = (over: Record<string, unknown> = {}) => ({
  months: [], pipeline: { steps: [], paidThisMonth: { count: 0, amount: '0.00' } },
  waiting: {
    total: 4, amount: '32700.00', oldestSince: '2026-10-07T08:00:00Z',
    byKind: { ADVANCE: { count: 2, amount: '18500.00' }, SETTLEMENT: { count: 1, amount: '11800.00' }, REIMBURSEMENT: { count: 1, amount: '2400.00' } },
  },
  queue: [{
    id: 'r-1', number: 'RMB-2026-0003', kind: 'REIMBURSEMENT', status: 'PENDING_PM', projectId: 'p', projectCode: 'NP004', projectName: 'Pokhara',
    requesterId: 'u-2', purpose: 'Taxi to Pokhara', category: 'Travel', amount: '2400.00', waitingSince: '2026-10-07T08:00:00Z', flags: [],
  }],
  projects: [{ projectId: 'p', code: 'NP004', name: 'Pokhara', spentToDate: '0.00', spentByMonth: [], cashHeld: '78500.00', overdueSettlements: { count: 2, amount: '45000.00' } }],
  categories: [],
  cashHolders: [
    { requesterId: 'u-2', outstanding: '45000.00', open: 2, overdue: 1 },
    { requesterId: 'u-1', outstanding: '23500.00', open: 1, overdue: 0 },
  ],
  decisions: { approved: { count: 0, amount: '0.00' }, trimmed: { count: 0, saved: '0.00' }, returned: 0, rejected: 0, medianHoursToDecide: null },
  ...over,
}) as never;
const html = (data = overview(), role: 'PM' | 'FINANCE' | 'DIRECTOR' = 'PM') =>
  renderToStaticMarkup(<OverviewBody overview={data} names={names} role={role} now={NOW} />);

describe('OverviewBody', () => {
  it('shows what waits, in total and by kind', () => {
    const out = html();
    expect(out).toContain('Waiting for your approval');
    expect(out).toContain('NPR 32,700.00');
    expect(out).toContain('4 requests · oldest 3 days');
    expect(out).toContain('Advances');
    expect(out).toContain('NPR 18,500.00');
    expect(out).toContain('2 waiting');
    expect(out).toContain('Reimbursements');
  });

  it('words the dark card for finance', () => {
    expect(html(overview(), 'FINANCE')).toContain('Waiting for payment');
  });

  it('raises the overdue banner with the people holding the cash', () => {
    const out = html();
    expect(out).toContain('2 settlements overdue');
    expect(out).toContain('NPR 45,000.00');
    expect(out).toContain('Bikash Tamang');
    expect(out).toContain('href="#cash"');
  });

  it('has no banner when nothing is overdue', () => {
    const quiet = overview({ projects: [{ projectId: 'p', code: 'NP004', name: 'Pokhara', spentToDate: '0.00', spentByMonth: [], cashHeld: '0.00', overdueSettlements: { count: 0, amount: '0.00' } }] });
    expect(html(quiet)).not.toContain('overdue');
  });

  it('lists the waiting requests with a way into the queue', () => {
    const out = html();
    expect(out).toContain('href="/finance/requests/r-1"');
    expect(out).toContain('Taxi to Pokhara');
    expect(out).toContain('3 days');
    expect(out).toContain('href="/finance/queue"');
  });

  it('lists who holds cash, overdue ones marked', () => {
    const out = html();
    expect(out).toContain('id="cash"');
    expect(out).toContain('NPR 78,500.00 open');
    expect(out).toContain('NPR 45,000.00');
    expect(out).toContain('1 overdue');
  });

  it('says so when nothing waits', () => {
    const empty = overview({ waiting: { total: 0, amount: '0.00', oldestSince: null, byKind: { ADVANCE: { count: 0, amount: '0.00' }, SETTLEMENT: { count: 0, amount: '0.00' }, REIMBURSEMENT: { count: 0, amount: '0.00' } } }, queue: [] });
    const out = html(empty);
    expect(out).toContain('Nothing waits on you.');
    expect(out).toContain('0 requests');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run app/finance/overview-body.spec.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/web/app/finance/overview-body.tsx`:

```tsx
import type { FinanceOverview, RequestKind } from '../lib/finance-api';
import {
  KIND_LABEL, KIND_PLURAL, addMoney, dayCount, formatMoney, initials, overdueSummary, personName, waitLabel, waitTone, waitingDays, waitingTitle,
  type ApproverRole,
} from './model';

const KINDS: readonly RequestKind[] = ['ADVANCE', 'SETTLEMENT', 'REIMBURSEMENT'];
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The approver's home: what waits, what is overdue, who holds cash. Pure markup over `FinanceOverview`. */
export function OverviewBody({ overview, names, role, now }: { overview: FinanceOverview; names: ReadonlyMap<string, string>; role: ApproverRole; now: Date }) {
  const { waiting } = overview;
  const overdue = overdueSummary(overview.projects, overview.cashHolders, names);
  const oldest = waiting.oldestSince ? ` · oldest ${dayCount(waitingDays(waiting.oldestSince, now))}` : '';
  const heldTotal = addMoney(...overview.projects.map((p) => p.cashHeld));

  return (
    <>
      <div className="fin-cards">
        <div className="fin-card dark">
          <span className="fin-card-head">{waitingTitle(role)}</span>
          <strong>{formatMoney(waiting.amount)}</strong>
          <small>{plural(waiting.total, 'request')}{oldest}</small>
        </div>
        {KINDS.map((kind) => (
          <div className="fin-card" key={kind}>
            <span className="fin-card-head"><i className={`fin-kind ${kind}`} aria-hidden="true">{KIND_LABEL[kind][0]}</i>{KIND_PLURAL[kind]}</span>
            <strong>{formatMoney(waiting.byKind[kind].amount)}</strong>
            <small>{waiting.byKind[kind].count} waiting</small>
          </div>
        ))}
      </div>

      {overdue ? (
        <div className="fin-banner" role="alert">
          <div>
            <strong>{plural(overdue.count, 'settlement')} overdue</strong>
            <p>{formatMoney(overdue.amount)}{overdue.people.length > 0 ? ` with ${overdue.people.join(' and ')}` : ''}, past the settle-by day.</p>
          </div>
          <a className="fin-banner-link" href="#cash">See who</a>
        </div>
      ) : null}

      <div className="fin-two">
        <section className="panel" aria-label="Waiting for you">
          <header className="panel-header">
            <h2>Waiting for you</h2>
            <a href="/finance/queue">Open queue</a>
          </header>
          {overview.queue.length === 0 ? <p className="finance-empty">Nothing waits on you.</p> : (
            <ul className="fin-list">
              {overview.queue.map((item) => {
                const who = personName(item.requesterId, names);
                const days = waitingDays(item.waitingSince, now);
                return (
                  <li key={item.id}>
                    <span className="fin-avatar" aria-hidden="true">{initials(who)}</span>
                    <div className="fin-list-main">
                      <a href={`/finance/requests/${item.id}`}><strong>{item.purpose}</strong></a>
                      <span className="subtle">{item.number} · {KIND_LABEL[item.kind]} · {who}</span>
                    </div>
                    <div className="fin-list-side">
                      <strong>{formatMoney(item.amount)}</strong>
                      <span className={`finance-pill ${waitTone(days)}`}>{waitLabel(days)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel" id="cash" aria-label="Cash with engineers">
          <header className="panel-header">
            <h2>Cash with engineers</h2>
            <span className="subtle">{formatMoney(heldTotal)} open</span>
          </header>
          {overview.cashHolders.length === 0 ? <p className="finance-empty">No cash is out.</p> : (
            <ul className="fin-list">
              {overview.cashHolders.map((holder) => {
                const who = personName(holder.requesterId, names);
                return (
                  <li key={holder.requesterId}>
                    <span className="fin-avatar" aria-hidden="true">{initials(who)}</span>
                    <div className="fin-list-main">
                      <strong>{who}</strong>
                      <span className={holder.overdue > 0 ? 'fin-overdue' : 'subtle'}>{holder.open} open{holder.overdue > 0 ? ` · ${holder.overdue} overdue` : ''}</span>
                    </div>
                    <div className="fin-list-side"><strong>{formatMoney(holder.outstanding)}</strong></div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
```

Check the spec: `overdue` text "1 overdue" appears for Bikash, banner text "2 settlements overdue"; in the quiet case `overdue` must not appear anywhere — the quiet fixture still has holder `overdue: 1` for u-2, which renders "1 overdue". Make the quiet fixture also pass `cashHolders: []` in the spec: change `overview({ projects: [...] })` to `overview({ projects: [...], cashHolders: [] })`.

- [ ] **Step 4: Run the spec**

Run: `cd apps/web && npx vitest run app/finance/overview-body.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/finance/overview-body.tsx apps/web/app/finance/overview-body.spec.tsx
git commit -m "feat(web): approver overview body"
```

---

### Task 7: Pages, sidebar and links

**Files:**
- Modify: `apps/web/app/finance/page.tsx`
- Create: `apps/web/app/finance/queue/page.tsx`
- Create: `apps/web/app/finance/history/page.tsx`
- Modify: `apps/web/app/shell.tsx:108,158-213`
- Modify: `apps/web/app/page.tsx:24`
- Modify: `apps/web/app/overview/director-panels.tsx:27,35,40,48,182`, `apps/web/app/overview/director-overview.tsx:58`
- Test: `apps/web/app/shell.spec.tsx`, `apps/web/app/overview/director-overview.spec.tsx` (update expectations if they assert old hrefs)

**Interfaces:**
- Consumes: `approverRole`, `ROLE_LABEL`, `resolveHistory`, `historyHref`, `legacyTarget`, `OverviewBody`, `QueueTable`, `RequestsTable({ pageHref })`.
- Produces: routes `/finance`, `/finance/queue`, `/finance/history`; sidebar sections `'finance-queue'` and `'finance-history'`.

- [ ] **Step 1: Route `/finance`**

Replace `apps/web/app/finance/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';
import { getFinanceOverview, listRequests } from '../lib/finance-api';
import { getCurrentUser, hasPermission } from '../lib/iam-api';
import { listUserDirectory } from '../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../shell';
import { DecidedNotice } from './decided';
import { ROLE_LABEL, approverRole, type ApproverRole } from './model';
import { OverviewBody } from './overview-body';
import { RequestsTable } from './requests-table';
import { legacyTarget, resolveSearch, type RawSearch } from './search';

export default async function FinancePage({ searchParams }: { searchParams: Promise<RawSearch> }) {
  const search = await searchParams;
  const old = legacyTarget(search);
  if (old) redirect(old);

  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to see finance"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.view')) {
    return <StatePage title="Finance is not available"><p>Your role does not include finance requests.</p><a className="primary-button" href="/">Back to workspace</a></StatePage>;
  }
  const user = viewer.data;
  const role = hasPermission(user, 'finance_request.view_all') ? approverRole(user.permissions) : null;
  return role ? <ApproverHome role={role} /> : <MyRequests mayRaise={hasPermission(user, 'finance_request.create')} search={search} />;
}

async function ApproverHome({ role }: { role: ApproverRole }) {
  const [overview, directory] = await Promise.all([getFinanceOverview(), listUserDirectory()]);
  if (overview.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>{overview.state === 'unauthenticated' ? 'Sign in again to continue.' : overview.message}</p><a className="primary-button" href="/">Back to workspace</a></StatePage>;
  }
  const names = new Map(directory.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);
  return (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><span>Finance</span><b>/</b><strong>Overview</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">{ROLE_LABEL[role].toUpperCase()}</p><h1>Finance</h1>
              <p className="subtle">What waits on you, and where the cash is.</p>
            </div>
          </div>
          <OverviewBody overview={overview.data} names={names} role={role} now={new Date()} />
        </div>
      </section>
    </main>
  );
}

/** Someone who approves nothing: their own requests, as before. */
async function MyRequests({ mayRaise, search }: { mayRaise: boolean; search: RawSearch }) {
  const { page } = resolveSearch(search, { mayAct: false, seeAll: false, mayRaise });
  const [result, directory] = await Promise.all([listRequests({ view: 'mine', page }), listUserDirectory()]);
  if (result.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>{result.state === 'unauthenticated' ? 'Sign in again to continue.' : result.message}</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }
  const names = new Map(directory.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);
  return (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><strong>Finance</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">FINANCE</p><h1>Advances &amp; settlements</h1>
              <p className="subtle">Requests for money, their approvals, and where each one stands.</p>
            </div>
            {mayRaise ? <a className="primary-button" href="/finance/new">+ New request</a> : null}
          </div>
          <section className="panel">
            <RequestsTable page={result.data} names={names} view="mine" pageHref={(n) => `/finance?page=${n}`} />
          </section>
        </div>
      </section>
    </main>
  );
}
```

`CurrentUser` has no name, so the Overview header shows the role and a one-line subtitle instead.

- [ ] **Step 2: Queue page**

`apps/web/app/finance/queue/page.tsx`:

```tsx
import { getFinanceOverview, listRequests, type RequestKind } from '../../lib/finance-api';
import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { listUserDirectory } from '../../lib/user-api';
import { redirect } from 'next/navigation';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { DecidedNotice } from '../decided';
import { KIND_PLURAL, ROLE_LABEL, approverRole, formatMoney } from '../model';
import { QueueTable } from '../queue-table';

const KINDS: readonly RequestKind[] = ['ADVANCE', 'SETTLEMENT', 'REIMBURSEMENT'];

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ kind?: string; page?: string; decided?: string }> }) {
  const search = await searchParams;
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') return <StatePage title="Sign in to see finance"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.view')) {
    return <StatePage title="Finance is not available"><p>Your role does not include finance requests.</p><a className="primary-button" href="/">Back to workspace</a></StatePage>;
  }
  const user = viewer.data;
  const role = hasPermission(user, 'finance_request.view_all') ? approverRole(user.permissions) : null;
  if (!role) redirect('/finance');

  const kind = KINDS.find((k) => k === search.kind);
  const page = Math.max(1, Math.floor(Number(search.page)) || 1);
  const [list, overview, directory] = await Promise.all([
    listRequests({ view: 'awaiting', page, limit: 50, ...(kind ? { kind } : {}) }), getFinanceOverview(), listUserDirectory(),
  ]);
  if (list.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>{list.state === 'unauthenticated' ? 'Sign in again to continue.' : list.message}</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }
  const waiting = overview.state === 'ready' ? overview.data.waiting : null;
  const names = Object.fromEntries(directory.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);
  const pill = (key: string, label: string, count: number | null, href: string, current: boolean) => (
    <a key={key} className="fin-pill-link" href={href} aria-current={current ? 'page' : undefined}>{label}{count === null ? null : <span className="fin-count">{count}</span>}</a>
  );

  return (
    <main className="app-shell">
      <Sidebar active="finance-queue" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><strong>Queue</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <DecidedNotice id={search.decided} viewerId={user.id} />
          <div className="toolbar">
            <div>
              <p className="eyebrow">{ROLE_LABEL[role].toUpperCase()}</p><h1>Queue</h1>
              <p className="subtle">Requests waiting for your decision.</p>
            </div>
          </div>
          <section className="panel">
            <nav className="fin-pills" aria-label="Kinds">
              {pill('all', 'All', waiting?.total ?? null, '/finance/queue', !kind)}
              {KINDS.map((k) => pill(k, KIND_PLURAL[k], waiting?.byKind[k].count ?? null, `/finance/queue?kind=${k}`, kind === k))}
              {waiting ? <span className="fin-pills-total">{waiting.total} waiting · {formatMoney(waiting.amount)}</span> : null}
            </nav>
            <QueueTable items={list.data.items} names={names} permissions={[...user.permissions]} now={new Date().toISOString()} />
          </section>
        </div>
      </section>
    </main>
  );
}
```

`DecidedNotice` takes `id` and `viewerId` as on the old page. The service caps `limit` at 100, so 50 is allowed; a queue longer than 50 shows its first 50, oldest first, and the rest appear as these are decided.

- [ ] **Step 3: History page**

`apps/web/app/finance/history/page.tsx`:

```tsx
import { listRequests } from '../../lib/finance-api';
import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { listUserDirectory } from '../../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { RequestsTable } from '../requests-table';
import { HISTORY_PILLS, historyHref, resolveHistory, type RawHistory } from '../search';

export default async function HistoryPage({ searchParams }: { searchParams: Promise<RawHistory> }) {
  const search = await searchParams;
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') return <StatePage title="Sign in to see finance"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.view')) {
    return <StatePage title="Finance is not available"><p>Your role does not include finance requests.</p><a className="primary-button" href="/">Back to workspace</a></StatePage>;
  }
  const user = viewer.data;
  const seeAll = hasPermission(user, 'finance_request.view_all');
  const mayAct = ['finance_approval.pm', 'finance_approval.director', 'finance_payment.record'].some((p) => hasPermission(user, p));
  const query = resolveHistory(search, { mayAct, seeAll });

  const [result, directory] = await Promise.all([
    listRequests({ view: query.view, page: query.page, ...(query.status ? { status: query.status } : {}), ...(query.stage ? { stage: query.stage } : {}), ...(query.kind ? { kind: query.kind } : {}), ...(query.q ? { q: query.q } : {}) }),
    listUserDirectory(),
  ]);
  if (result.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>{result.state === 'unauthenticated' ? 'Sign in again to continue.' : result.message}</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }
  const names = new Map(directory.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);
  const pills = HISTORY_PILLS.filter((p) => p.key !== 'handled' || (mayAct && seeAll));

  return (
    <main className="app-shell">
      <Sidebar active="finance-history" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><strong>History</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">FINANCE</p><h1>History</h1>
              <p className="subtle">{seeAll ? 'Every request in your projects.' : 'Every request you have raised.'}</p>
            </div>
          </div>
          <section className="panel">
            <form className="fin-search" action="/finance/history" role="search">
              {query.pill !== 'all' ? <input type="hidden" name="filter" value={query.pill} /> : null}
              <input type="search" name="q" defaultValue={query.q ?? ''} placeholder="Search number, purpose, project" aria-label="Search requests" />
              <button className="ghost-button" type="submit">Search</button>
            </form>
            <nav className="fin-pills" aria-label="Status">
              {pills.map((p) => (
                <a key={p.key} className="fin-pill-link" href={historyHref({ filter: p.key, ...(query.q ? { q: query.q } : {}) })} aria-current={query.pill === p.key ? 'page' : undefined}>{p.label}</a>
              ))}
            </nav>
            <RequestsTable page={result.data} names={names} view={query.view} pageHref={(n) => historyHref({ filter: query.pill, ...(query.q ? { q: query.q } : {}), ...(query.status && !HISTORY_PILLS.some((p) => 'status' in p && p.status === query.status) ? { status: query.status } : {}), ...(query.kind ? { kind: query.kind } : {}), page: n })} />
          </section>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Sidebar**

In `shell.tsx` change the `Section` type to add `| 'finance-queue' | 'finance-history'`. Add the import `import { listRequests } from './lib/finance-api';` (match the file's existing relative import style). In `Sidebar` after `maySeeSpend`:

```ts
  const mayApprove = viewer.state === 'ready' && maySeeSpend
    && ['finance_approval.pm', 'finance_approval.director', 'finance_payment.record'].some((p) => hasPermission(viewer.data, p));
  const queue = mayApprove ? await listRequests({ view: 'awaiting', limit: 1 }) : null;
  const queued = queue?.state === 'ready' ? queue.data.total : 0;
```

Replace the first `NavItem` in `financeGroup`:

```tsx
      {mayApprove ? (
        <>
          <NavItem section="finance" active={active} href="/finance" icon={<CashIcon />}>Overview</NavItem>
          <NavItem section="finance-queue" active={active} href="/finance/queue" icon={<CashIcon />} badge={queued}>Queue</NavItem>
          <NavItem section="finance-history" active={active} href="/finance/history" icon={<CashIcon />}>History</NavItem>
        </>
      ) : (
        <NavItem section="finance" active={active} href="/finance" icon={<CashIcon />}>Requests</NavItem>
      )}
```

- [ ] **Step 5: Update the old links**

- `apps/web/app/page.tsx:24`: `case 'finance': redirect('/finance');`
- `director-panels.tsx`: `href="/finance?view=awaiting"` → `href="/finance/queue"` (lines 27, 35); `/finance?view=all&status=${step.status}` → `/finance/history?status=${step.status}`; `/finance?view=all&status=PAID` → `/finance/history?filter=closed`; `/finance?view=handled` → `/finance/history?filter=handled`.
- `director-overview.tsx:58`: `href="/finance/queue"`.

(Old URLs still work through `legacyTarget`; these edits just avoid the extra redirect.)

- [ ] **Step 6: Run the web suite and typecheck**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit`
Expected: PASS. Fix any spec that asserts an old href or the sidebar's "Requests" label for an approver (`shell.spec.tsx`, `director-overview.spec.tsx`, `director-panels` specs): update the expected hrefs to the new ones from Step 5, and for approvers expect Overview / Queue / History.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app
git commit -m "feat(web): finance overview, queue and history pages with sidebar sub-nav"
```

---

### Task 8: Styling and end-to-end check

**Files:**
- Modify: `apps/web/app/finance/finance.css` (append)

- [ ] **Step 1: Append the styles**

```css
/* Approver dashboards: overview cards, banner, lists, queue pills and the decision dialog. */
.fin-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; margin-bottom: 18px; }
.fin-card { display: grid; gap: 8px; padding: 18px; background: #fff; border: 1px solid var(--line); border-radius: 10px; }
.fin-card strong { font-size: 24px; letter-spacing: -.5px; font-variant-numeric: tabular-nums; }
.fin-card small { color: var(--muted); font-size: 12px; }
.fin-card-head { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--muted); }
.fin-card.dark { background: var(--ink); border-color: var(--ink); color: #fff; }
.fin-card.dark .fin-card-head, .fin-card.dark small { color: rgba(255, 255, 255, .72); }
.fin-kind { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; font-style: normal; font-size: 12px; font-weight: 700; background: color-mix(in srgb, var(--blue) 14%, transparent); color: var(--blue); }
.fin-kind.SETTLEMENT { background: color-mix(in srgb, var(--green) 15%, transparent); color: var(--green); }
.fin-kind.REIMBURSEMENT { background: color-mix(in srgb, var(--amber) 18%, transparent); color: var(--amber); }

.fin-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; padding: 14px 18px; border-radius: 10px; background: color-mix(in srgb, var(--red) 10%, #fff); border: 1px solid color-mix(in srgb, var(--red) 28%, transparent); }
.fin-banner strong { color: var(--red); }
.fin-banner p { margin: 4px 0 0; font-size: 13px; color: var(--ink); }
.fin-banner-link { flex: none; padding: 9px 14px; border-radius: var(--radius-btn, 4px); background: var(--red); color: #fff; font-weight: 650; }

.fin-two { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.fin-list { list-style: none; margin: 8px 0 0; padding: 0; }
.fin-list li { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
.fin-list li:first-child { border-top: 0; }
.fin-list-main { flex: 1; min-width: 0; }
.fin-list-main a:hover strong { color: var(--blue); }
.fin-list-main .subtle { display: block; margin: 3px 0 0; font-size: 12px; }
.fin-list-side { display: grid; justify-items: end; gap: 4px; flex: none; font-variant-numeric: tabular-nums; }
.fin-overdue { display: block; margin: 3px 0 0; font-size: 12px; font-weight: 600; color: var(--red); }
.fin-avatar { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--blue) 12%, #fff); color: var(--blue); font-size: 11px; font-weight: 700; }
.fin-who { display: flex; align-items: flex-start; gap: 10px; }

.fin-pills { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 4px 0 14px; }
.fin-pill-link { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; color: var(--muted); background: #fff; }
.fin-pill-link[aria-current='page'] { background: var(--ink); border-color: var(--ink); color: #fff; font-weight: 600; }
.fin-count { padding: 0 6px; border-radius: 999px; background: color-mix(in srgb, var(--muted) 16%, transparent); font-size: 11px; }
.fin-pill-link[aria-current='page'] .fin-count { background: rgba(255, 255, 255, .22); }
.fin-pills-total { margin-left: auto; font-size: 13px; color: var(--muted); }
.fin-search { display: flex; gap: 8px; margin-bottom: 12px; }
.fin-search input[type='search'] { flex: 1; max-width: 420px; height: 38px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius-input, 4px); }
.fin-row-actions { display: flex; gap: 8px; justify-content: flex-end; white-space: nowrap; }
.fin-row-actions .primary-button, .fin-row-actions .ghost-button { padding: 7px 12px; font-size: 13px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.fin-dialog-overlay { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 20px; background: rgba(15, 23, 42, .55); }
.fin-dialog { width: min(480px, 100%); max-height: 90vh; overflow-y: auto; padding: 22px; background: #fff; border-radius: 12px; box-shadow: 0 25px 50px -12px rgba(15, 23, 42, .3); }
.fin-dialog-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.fin-dialog-head h2 { margin: 0; font-size: 18px; }
.fin-dialog-flags { margin: 12px 0 0; }
.fin-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }

@media (max-width: 900px) { .fin-two { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 700px) { .fin-banner { flex-direction: column; align-items: flex-start; } .fin-pills-total { margin-left: 0; width: 100%; } }
```

- [ ] **Step 2: Run everything**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit && cd ../finance && npx vitest run && cd ../.. && npx tsc --noEmit -p libs/contracts`
Expected: all PASS, no type errors.

- [ ] **Step 3: Check it in a browser**

Start the app (use the repo's dev command from `package.json` / `.claude/launch.json`), sign in as a seeded PM, then Director, then Finance user, and confirm:

1. `/finance` shows the dark card, three kind cards, the waiting list and the cash panel; the banner shows only when something is overdue.
2. Sidebar shows Overview, Queue (badge equals the Queue's "N waiting") and History.
3. On `/finance/queue`, Approve opens the dialog; submitting closes it, the row disappears and the badge drops by one. Return without a reason shows the inline error. At the Finance step, Pay asks for the payment details.
4. `/finance?view=awaiting` and `/finance?view=handled` redirect to the queue and to History's "Decided by me".
5. An engineer (no approval permission) still sees their own list at `/finance` and is redirected from `/finance/queue`.
6. Narrow the window below 700px: cards stack, the table scrolls sideways, the dialog fits.

Report any step that cannot be checked (for example no seeded data) rather than assuming it works.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/finance/finance.css
git commit -m "feat(web): styles for the finance approver dashboards"
```

---

## Self-Review

**Spec coverage**
- §3 routes and navigation → Tasks 3 (redirect map), 7 (pages, sidebar, links). Engineer behaviour → Task 7 `MyRequests`, redirect in the Queue page.
- §4.2 `waiting` → Task 1.
- §5.1 Overview → Task 6, wired in Task 7. §5.2 Queue → Tasks 5, 7. §5.3 History → Tasks 1 (`stage`, `q`), 3, 7.
- §6 dialogs and `from=queue` → Tasks 4, 5.
- §7 roles → Task 2 (`approverRole`, `queueActions`).
- §8 styling → Task 8. §9 errors → `StatePage` branches in Task 7, inline `FormError` in Task 5. §10 tests → each task.
- Spec items changed in this plan are listed in the spec's "Revisions" section (below).

**Placeholder scan:** no TBD/TODO. The two repo facts that were open (the page `limit` cap of 100 and `CurrentUser` having no name) are resolved in Task 7.

**Type consistency:** `waiting` (Task 1) is read as `overview.waiting` in Tasks 6 and 7. `queueActions` returns `QueueAction[]`, consumed by `QueueTable` and `DecisionDialog` (`kind: QueueAction`). `DialogRequest` is built in `QueueTable` from `FinanceRequest` fields that exist. `RequestsTable`'s new `pageHref` prop is supplied in `page.tsx` and `history/page.tsx`. `resolveHistory` returns `pill`, which `history/page.tsx` reads.
