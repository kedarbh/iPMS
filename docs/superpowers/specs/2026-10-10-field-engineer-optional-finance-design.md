# Optional Finance for Field Engineers

Date: 2026-10-10
Status: Draft for review

## 1. Why

Some field engineers work for a vendor. Their advances and settlements are handled by their own company, not through Axiom's finance service. Today every Field Engineer holds the finance permissions and sees the Finance menu, so vendor engineers see a feature they must not use, and could raise requests that Axiom Finance would then have to refuse.

Finance becomes optional for Field Engineers only. Every other role is unchanged.

## 2. Scope

In scope:
- A switch on the new-user form for Field Engineers: finance on (the default) or off.
- With the switch off, the user holds no `finance_*` permission, so the web Finance menu, the finance API and the mobile Finance tab all close, with no change to the finance service itself.

Out of scope:
- Changing the switch after the account exists. It is chosen once, at creation. The app is still in development, so no engineer has requests or advances yet, and nothing needs migrating or checking. If this is later needed on live accounts, it will need a check for open requests and unsettled advances first, and is a separate change.
- Recording which vendor an engineer belongs to, a separate vendor role, and any change to approvers, Finance, reports or notifications.

## 3. Decisions

- **Marking:** a `financeEnabled` boolean on the IAM `user`, default `true`. Existing users are unchanged. A separate role was rejected because code that checks for `FIELD_ENGINEER` (project access expiry, the engineer overview, the PM's role assignment) would have to learn the new role. An employer field was rejected as more than the need.
- **Set once, at creation:** the create-user form and API accept the switch; the update and role endpoints do not.
- **How it takes effect:** by removing permissions in IAM, not by hiding screens. A vendor engineer's request is refused by the API (403), not just invisible.

## 4. IAM

### Data and rules

- `user.financeEnabled Boolean @default(true)`, added by a migration. The user list and get responses carry it.
- `CreateUserSchema` accepts an optional `financeEnabled`. `false` is accepted only when `roleCodes` is `['FIELD_ENGINEER']`; for any other role (or none) the request is rejected with a 400.
- `UpdateUserSchema` does not accept it. The schema already strips unknown keys, so an update that sends it is ignored.
- `setRoles` resets `financeEnabled` to `true` when the new role is not `FIELD_ENGINEER`, so an engineer later made something else does not stay without finance by accident.
- Who may set it follows the existing create rules: an administrator, or a Project Manager creating a Field Engineer, which is the only role a PM may create. No new power is granted.
- The `user.created` audit entry records the value. No tokens exist yet for a new account, so nothing is revoked.

### Removing the permissions

`libs/authz` gains one pure function, `financeOptOutOverrides()`, returning a global DENY override for every permission whose module starts with `finance_`, taken from the `PERMISSIONS` catalog. A future finance permission is covered without anyone remembering to list it.

IAM appends these overrides whenever a user's `financeEnabled` is `false`, in the two places it builds overrides: `AuthService.claimsFor` (the token) and `EffectiveService.toOverrides` (the effective-permissions read, `simulate`, and `holders`). A DENY outranks a role grant and an ALLOW override alike, so an ALLOW override added by hand cannot bring finance back. The effective-permissions read reports these permissions as denied, with the reason "Finance is handled by this engineer's own company". Nothing is written to `user_permission_override`, so the existing override list never shows these synthetic rows.

## 5. Finance service

No change. It already refuses a caller without `finance_request.create` or `finance_settlement.submit`, and a vendor engineer's token no longer carries them.

History is not affected either: if a vendor engineer ever did have requests, approvers, Finance and the project-spend report would still show them.

## 6. Web (`apps/web`)

- **New-user form** (`apps/web/app/users/forms.tsx`): a checkbox shown only while the Field Engineer role is selected, labelled "Advances and expenses through Axiom", checked by default, with the hint "Turn off for vendor engineers whose own company pays their advances and settles their expenses."
- **Access summary** next to the role picker (`role-access.ts`) leaves out the finance permissions when the box is unticked.
- **Users list** shows a "Finance off" tag on these engineers.
- **Engineer overview** (`overview/engineer-overview.tsx`) hides the "Finance requests" button for a user without `finance_request.view`.
- The Finance menu in `shell.tsx` needs no change: it already shows only for `finance_request.view`.
- The edit-user form does not show the switch.

## 7. Mobile (`apps/mobile`)

The Finance tab and its page are built only when the signed-in user has `finance_request.view`. Today `main.dart` always includes `FinanceScreen` and the nav bar has a fixed Finance entry, so a user without finance sees "Ask an administrator if you need to raise advances", which is wrong for vendor staff. The nav bar and the page list come from one list, so they cannot get out of step.

## 8. Edge cases

- **Set wrongly at creation.** It cannot be changed from the app in this version. While the app is in development the account can be deactivated and created again.
- **An engineer later made a Project Manager.** The switch resets to `true` (section 4).
- **Notifications.** Unchanged; a vendor engineer never appears as a requester, so none are sent.

## 9. Testing

- `libs/authz`: `financeOptOutOverrides` covers every `finance_*` catalog code and nothing else; DENY beats an ALLOW override and a role grant; a new `finance_*` code added to the catalog is included.
- IAM `users.service`: `false` rejected for a non-engineer and for no role; accepted for a Field Engineer, by an administrator and by a PM; update ignores it; `setRoles` to another role resets it.
- IAM `auth.service` and `effective.service`: the token and the effective read both lack every finance permission when the switch is off, and `holders` for a finance permission never returns such an engineer.
- Web: the checkbox shows only for the Field Engineer role; the access summary drops finance; the overview hides the button.
- Mobile: widget test that the Finance tab is absent without `finance_request.view` and present with it.
- E2E: an engineer created with finance off sees no Finance menu and the finance API answers 403.

## 10. Rollout

One IAM migration adds the column with a default of `true`, so existing accounts are unchanged. No backfill, no new configuration, and no change to the other services' deployment.
