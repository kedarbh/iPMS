# Optional Finance for Field Engineers

Date: 2026-10-10
Status: Draft for review

## 1. Why

Some field engineers work for a vendor. Their advances and settlements are handled by their own company, not through Axiom's finance service. Today every Field Engineer holds the finance permissions and sees the Finance menu, so vendor engineers see a feature they must not use, and could raise requests that Axiom Finance would then have to refuse.

Finance becomes optional for Field Engineers only. Every other role is unchanged.

## 2. Scope

In scope:
- A per-user switch on Field Engineers: finance on (the default) or off.
- With the switch off, the user holds no `finance_*` permission, so the web Finance menu, the finance API and the mobile Finance tab all close with no change to the finance service's own checks.
- Turning the switch off is refused while the engineer has money in flight.

Out of scope: recording which vendor an engineer belongs to, a separate vendor role, any change to approvers, Finance, reports or notifications, and a bulk way to switch many engineers at once.

## 3. Decisions

- **Marking:** a `financeEnabled` boolean on the IAM `user`, default `true`. Existing users are unchanged. A separate role was rejected because code that checks for `FIELD_ENGINEER` (project access expiry, the engineer overview, the PM's role assignment) would have to learn the new role. An employer field was rejected as more than the need.
- **Open money:** turning finance off is blocked until the engineer has no pending request and no advance with a balance outstanding. No advance is ever left without anyone able to settle it.
- **How it takes effect:** by removing permissions in IAM, not by hiding screens. A vendor engineer's request is refused by the API (403), not just invisible.

## 4. IAM

### Data and rules

- `user.financeEnabled Boolean @default(true)`, added by a migration. `UserResponse` and the user list/get responses carry it.
- `CreateUserSchema` and `UpdateUserSchema` accept an optional `financeEnabled`. `false` is accepted only for a user whose role is `FIELD_ENGINEER` (the role being created, or the role the user already holds); otherwise the request is rejected with a 400.
- `setRoles` resets `financeEnabled` to `true` when the user's new role is not `FIELD_ENGINEER`, so a promoted engineer never keeps a stale switch.
- Who may change it follows the existing user rules: `update` already goes through `loadManageable`, so an administrator, or a Project Manager over their own Field Engineers, can. Nobody gains a new power.
- A change to the switch bumps `tokenVersion` through the existing `revokeTokens`, because it changes authority and the permissions claim is resolved at token issuance. A profile edit that leaves the switch alone still revokes nothing. The audit entry `user.updated` records the previous and new value.

### Removing the permissions

`libs/authz` gains one pure function, `financeOptOutOverrides()`, returning a global DENY override for every permission whose module starts with `finance_`, taken from the `PERMISSIONS` catalog. A future finance permission is covered without anyone remembering to list it.

IAM appends these overrides whenever a user's `financeEnabled` is `false`, in the two places it builds overrides: `AuthService.claimsFor` (the token) and `EffectiveService.toOverrides` (effective-permissions read, `simulate`, and `holders`). A DENY outranks a role grant and an ALLOW override alike, so an ALLOW override granted to the engineer by hand cannot bring finance back. The effective-permissions read reports these permissions as denied, with the reason "Finance is handled by this engineer's own company". Nothing is written to `user_permission_override`, so the existing override list and its screens never show these synthetic rows.

### Blocking while money is open

Before the update transaction, and only when `financeEnabled` changes from `true` to `false`, IAM asks the finance service, forwarding the editor's own bearer token (the pattern `project` uses to ask `qc` before a delete; see `WorkOrderUsageClient`). The call fails closed: if finance cannot answer, the change is refused with a 503 and "The finance service could not confirm this engineer has no open requests. Try again shortly." Turning finance back on needs no check.

New config: `FINANCE_SERVICE_URL` for the IAM service, in `docker/env/iam.env` and the compose files.

## 5. Finance service

New internal endpoint, like `apps/qc/src/work-orders/work-order-usage.controller.ts` (the gateway already refuses every `/internal/` path):

`GET /internal/requesters/:userId/open-items`, requiring `user.update` on the forwarded token. It returns:

```
{ pending: [{ number, kind, status, requestedAmount }],
  outstandingAdvances: [{ number, outstanding }] }
```

- `pending` is every request with `requesterId = :userId` in a `PENDING_*` status.
- `outstandingAdvances` is every paid advance of that requester whose derived balance is above zero, using the same `advanceBalance` derivation as `GET /finance/advances/:id`.
- Drafts and returned requests do not count: no money has moved on them. They stay dormant, and reappear if finance is switched back on.
- A user with nothing open gets two empty lists.

IAM refuses the change when either list is non-empty, naming up to five items: "Finance cannot be turned off yet: ADV-2026-0012 has NPR 4,500 outstanding; REI-2026-0031 is waiting for approval." The web form shows this message.

History is kept. A vendor engineer's earlier requests stay visible to approvers, Finance and the project-spend report; they simply cannot raise new ones.

## 6. Web (`apps/web`)

- **User form** (create and edit, `apps/web/app/users/forms.tsx`): a checkbox shown only while the Field Engineer role is selected, labelled "Advances and expenses through Axiom", checked by default, with the hint "Turn off for vendor engineers whose own company pays their advances and settles their expenses." The server's refusal is shown beside it.
- **Access summary** next to the role picker (`role-access.ts`) leaves out the finance permissions when the box is unticked.
- **Users list** shows a "Finance off" tag on these engineers.
- **Engineer overview** (`overview/engineer-overview.tsx`) hides the "Finance requests" button for a user without `finance_request.view`.
- The Finance menu in `shell.tsx` needs no change: it already shows only for `finance_request.view`.

## 7. Mobile (`apps/mobile`)

The Finance tab and its page are built only when the signed-in user has `finance_request.view`. Today `main.dart` always includes `FinanceScreen` and the nav bar has a fixed Finance entry, so the screen shows "Ask an administrator if you need to raise advances", which is wrong for vendor staff. The nav bar and the page list come from one list, so they cannot get out of step. Because the switch revokes the engineer's tokens, the next refresh returns the new permission set and the tab disappears without a reinstall.

## 8. Edge cases

- **A request submitted while an admin switches finance off.** The check and the update are not one transaction across services. The window is a few milliseconds, the token revocation shuts the engineer out immediately after, and any request that slipped in is an ordinary pending request that approvers can reject. Accepted.
- **Finance turned back on.** Permissions return on the next token refresh. Dormant drafts reappear.
- **An engineer promoted to Project Manager.** The switch resets to `true`.
- **Notifications.** Unchanged; a vendor engineer never appears as a requester, so none are sent.

## 9. Testing

- `libs/authz`: `financeOptOutOverrides` covers every `finance_*` catalog code and nothing else; DENY beats an ALLOW override and a role grant; a new `finance_*` code in the catalog is included.
- IAM `users.service`: `false` rejected for a non-engineer, on create and update; reset on role change; token revocation only when the value changes; refused when finance reports open items; refused with 503 when finance does not answer; allowed when both lists are empty; turning on skips the check; a Project Manager can change it only for engineers they may manage.
- IAM `auth.service` and `effective.service`: the token and the effective read both lack every finance permission when the switch is off, and `holders` for a finance permission never returns such an engineer.
- Finance integration test, in the existing Postgres style: the endpoint counts pending requests and unsettled advances, ignores drafts, returned requests and closed advances, and is refused without `user.update`.
- Web: form shows the checkbox only for the Field Engineer role; access summary drops finance; overview hides the button.
- Mobile: widget test that the Finance tab is absent without `finance_request.view` and present with it.
- E2E: an engineer with finance off sees no Finance menu and the finance API answers 403; the admin's attempt to switch it off for an engineer with a pending request is refused with the message.

## 10. Rollout

One IAM migration adds the column with a default of `true`, so nothing changes until someone switches an engineer off. No backfill. Add `FINANCE_SERVICE_URL` to the IAM environment and compose files before deploying IAM.
