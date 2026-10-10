# Finance Approver Dashboards (Web) Design

Date: 2026-10-10
Status: Draft for review
Source design: Claude Design project "Approver Dashboards Web" (Overview, Queue, History pages).

## 1. Why

`/finance` is one table with tabs. Approvers (Project Manager, Project Director, Finance) land on a list and must open each request to act. The approved design gives them a home that shows what waits on them and where cash sits, a queue they can act on directly, and a searchable history.

## 2. Scope

In scope:
- Three pages under `/finance`: Overview, Queue, History, with a sidebar sub-nav (Queue carries a count badge).
- Role framing (PM, Director, Finance) taken from the viewer's permissions.
- Inline Approve / Pay and Return from Queue rows, in centred dialogs.
- One finance-service change: counts for the whole queue (section 4.2).
- Styling from the design, in `finance.css`, using the app's existing tokens.

Out of scope:
- The prototype's "Viewing as" switch. The real role comes from the login.
- "Remind engineers". No backend exists for it; the banner links to the cash panel instead.
- The notification bell and its count.
- Mobile, new permissions, roles, migrations, services.
- Any change to the Director home on `/` (it keeps its own layout and its finance panels).

## 3. Routes and navigation

| Route | Page | Who |
|---|---|---|
| `/finance` | Overview | holders of any of `finance_approval.pm`, `finance_approval.director`, `finance_payment.record` |
| `/finance/queue` | Queue | same |
| `/finance/history` | History | anyone with `finance_request.view` |

- Engineers (no approval permission) keep today's `/finance`: their own requests and "+ New request". `/finance` renders Overview for approvers and the existing view for everyone else; `/finance/queue` redirects non-approvers to `/finance`.
- The existing table and its `view` / `status` / `kind` / `page` params move to `/finance/history`. `financeHref` points there, so existing links (`/finance?view=awaiting`, the Director home's "Open queue") are updated: `view=awaiting` links go to `/finance/queue`, other `view` links go to `/finance/history`. A request to `/finance?view=...` from an old bookmark redirects to the matching new route.
- Sidebar Finance group: Overview, Queue (badge = waiting count, hidden at 0), History, then the existing Categories and Reports.

## 4. Data

### 4.1 Existing

`getFinanceOverview()` (`GET /finance/overview`) supplies pipeline steps (count, amount, oldest), `queue` (top 5 with flags), `projects` (cash held, overdue settlements), `cashHolders`, and `decisions`. `listRequests({view:'awaiting'})` supplies the full queue, oldest waiting first. The approve, return, reject and pay endpoints and their server actions exist.

### 4.2 Gap: queue is capped at 5

`QUEUE_SIZE = 5` limits `overview.queue`, so counts by kind cannot be derived from it. Add to `FinanceOverview` a `waiting` object, computed over the same visibility filter as the queue before the slice:

```
waiting: { total: number; amount: string; oldestSince: string | null;
           byKind: Record<RequestKind, { count: number; amount: string }> }
```

`queue` stays capped at 5 for the Overview list. The Queue page reads the full list through `listRequests`. Contract in `libs/contracts/src/finance/overview.ts`; service in `apps/finance/src/queries/overview.service.ts`.

## 5. Pages

### 5.1 Overview

- Header: eyebrow with the role (PROJECT MANAGER / PROJECT DIRECTOR / FINANCE), title "Finance", viewer name and role.
- Cards: a dark **Waiting for your approval** card (total amount, "N requests · oldest D days"), then Advances, Settlements, Reimbursements cards each with amount and "N waiting". For Finance the dark card reads "Waiting for payment" and the cards count payments due. Source: `waiting`.
- Overdue banner (red) when overdue settlements exist: "N settlements overdue", with the total and the people holding them (from `cashHolders` where `overdue > 0`). Its action links to the Cash panel on the same page.
- **Waiting for you:** the 5 queue items: avatar initials, purpose, number · kind · requester, amount, category, age pill. Each links to the request. "Open queue" links to `/finance/queue`.
- **Cash with engineers:** total open, then the holders with outstanding amount and open / overdue counts. Overdue holders show in red.
- Empty state: "Nothing waits on you."

### 5.2 Queue

- Title "Queue", subtitle "Requests waiting for your decision".
- Filter pills: All, Advances, Settlements, Reimbursements, each with its count; right side "N waiting · NPR total". The kind filter is a `kind` URL param.
- Table columns: Request (number link, kind), Purpose (avatar, purpose, requester), Project (code, name), Amount (with a sub-line: category, or "Excess NPR x" on settlements over their advance), Waiting (age pill), and actions.
- Actions: **Approve** (**Pay** at the Finance step) and **Return**, shown only when the viewer holds the permission for the request's current step.
- Row order is oldest waiting first, as the service returns it.

### 5.3 History

- Title "History", subtitle "Every request in your projects".
- Search box plus status pills: All, In approval, Open advances, Paid & settled, Returned, Rejected. These map onto the existing `RequestStatus` filter and `search.ts`; the pills that group several statuses (In approval, Paid & settled) are added to `search.ts` as named groups.
- Table: Request, Purpose, Project, Status (chip: With project manager / With project director / With finance / Paid / Settled / Returned / Rejected), Amount. Pagination as today.

## 6. Decision dialogs

A shared `DecisionDialog` (client component) opens centred over the Queue.

- **Approve:** shows number, purpose, amount; optional approved amount (prefilled with the requested amount; the existing trim rule applies) and comment. Calls `approveAction`.
- **Return:** required comment. Calls `returnAction`. Reject stays on the request page.
- **Pay:** payment mode, reference, paid-on date, note, as the request page's payment panel. Calls `payAction`.
- Flags on the row (duplicate bill, cash held, unusual amount) appear in the dialog above the fields, so an inline decision keeps the "before you decide" signal.

Staying on the page: `approveAction` and `returnAction` end in `nextAfterDecision`, which opens the next request. From the Queue, the dialog posts `from=queue`; with it the action revalidates `/finance/queue` and `/finance` and returns success instead of redirecting. The dialog closes, the row drops out, and the badge and counts update. Without `from=queue`, behaviour is unchanged.

## 7. Roles and visibility

- Approver = holds any of the three approval permissions; framing and the dark-card wording come from which one(s) the viewer holds, with Finance payment taking precedence for the label only when it is the viewer's sole permission.
- Rows and action buttons honour the service's own decision: the buttons render only for requests at a step the viewer can act on, and the service remains the authority (a rejected call shows its error in the dialog).
- Requests raised by the viewer never appear in their own queue (already enforced by the service).

## 8. Styling

Design tokens are the app's existing ones. New classes in `finance.css`: summary cards (`.fin-card`, `.fin-card-dark`), kind pills, age pills (neutral, amber at 3+ days), status chips, avatar initials, overdue banner, dialog. No new colours: red and amber come from the existing flag tones. Layouts collapse to one column below the existing tablet breakpoint.

## 9. Errors and edge cases

- Overview or list load failure: the existing `StatePage` with the message and a back link.
- Dialog server errors render inline under the fields; the dialog stays open.
- A request decided by someone else while the dialog is open: the service's conflict error shows inline; closing refreshes the list.
- Zero waiting: Queue shows "Nothing waits on you." and the badge is hidden.

## 10. Testing

Vitest specs alongside the existing `*.spec.ts(x)` files:
- `model.spec.ts`: card amounts and counts from `waiting`, overdue banner derivation, age-pill tone, role label.
- `search.spec.ts`: the grouped status pills and the `/finance` legacy-param redirect target.
- `queue-table.spec.tsx`: filter pills with counts, action buttons by permission and step, empty state.
- `decision-dialog.spec.tsx`: approve with trimmed amount, return requires a comment, pay fields, `from=queue` stays on the page.
- Finance service: a spec for `waiting` totals and `byKind`, matching the queue's visibility filter.
- `overview.spec.tsx`: the Overview renders cards, banner, list, and cash panel; engineers still get their own view.
- The Director home spec is updated for the new `/finance/queue` link.

## 11. Delivery order

1. Contract and service: `waiting` on the overview.
2. Routes, redirects, sidebar, `search.ts` groups.
3. Overview page.
4. Queue page and `DecisionDialog`, with the `from=queue` action path.
5. History restyle.
6. CSS pass and responsive check; run the web and finance test suites.

## 12. Revisions (found while planning against the code)

- **History search needs a backend filter.** `GET /finance/requests` had no text search, so it gains `q` (number, purpose, project code or name, case-insensitive). Searching by engineer name is not included: the service holds ids, not names.
- **History pills.** The service filters by one status, so it gains `stage` (`approval` = any pending step, `closed` = paid or settled). "Open advances" is dropped: a fully settled advance stays PAID and only its balance says CLOSED, so it cannot be filtered in the list. "Decided by me" stays as a pill for approvers, keeping the old tab.
- **History columns** stay as today (Request, Project, For, Requested by, Amount, Status, Current handler, Updated); only the page chrome, pills and search change.
- **Queue rows** show the category under the amount. The "Excess NPR x" sub-line is omitted: list rows carry no advance balance.
- **Overview header** shows the role and a short subtitle; the signed-in user's name is not available from `CurrentUser`.
- **Approver** requires `finance_request.view_all` as well as an approval permission, because `/finance/overview` refuses callers without it.
