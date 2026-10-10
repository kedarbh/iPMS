# Optional Finance for Field Engineers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Field Engineer can be created with finance switched off, and then holds no `finance_*` permission, so the web Finance menu, the finance API and the mobile Finance tab are all closed to them.

**Architecture:** One new column, `user.financeEnabled` (default `true`), chosen only on the create-user form. When it is `false`, IAM adds a global DENY override for every `finance_*` permission, in memory, in the two places it builds a user's permissions: the token claim and the effective-permissions read (which also feeds the access simulator and `holders`). A DENY outranks any role grant, so no other service changes. The web and mobile apps then hide what the missing permission already closes.

**Tech Stack:** NestJS 12 + Prisma 7 (IAM), Zod 4 (`libs/contracts`), Vitest 4, Next.js (web), Flutter 3.47 (mobile).

**Spec:** `docs/superpowers/specs/2026-10-10-field-engineer-optional-finance-design.md`

## Global Constraints

- Only a Field Engineer may have finance off. The service refuses it for any other role, or no role, with a 400: `Only a Field Engineer can have finance turned off`.
- The switch is chosen at account creation only. `UpdateUserSchema` does not accept it (it strips unknown keys), and there is no open-requests check, no new finance-service endpoint, and no `FINANCE_SERVICE_URL`.
- `setRoles` resets `financeEnabled` to `true` when the user's new role is not `FIELD_ENGINEER`.
- The permissions removed are every permission whose module starts with `finance_`, read from the `PERMISSIONS` catalog, never listed by hand.
- Denial reason shown in the effective-permissions read: `Finance is handled by this engineer's own company`.
- Web label: `Advances and expenses through Axiom`, checked by default, hint `Turn off for vendor engineers whose own company pays their advances and settles their expenses.`
- Users list tag text: `Finance off`.
- IAM consumes `@ipms/authz` and `@ipms/contracts` as **built packages** (`dist/`, gitignored). After editing either lib, rebuild it before running IAM or web tests: `pnpm --filter @ipms/authz build` and `pnpm --filter @ipms/contracts build`.
- The working tree already has uncommitted edits to five files under `apps/web/app/finance/` that are not part of this work. **Never `git add -A` or `git add .`**; add the exact files each task names.
- Run commands from the repo root, `/Volumes/kedar/webprojects/iPMS`. A subshell `( cd dir && … )` keeps the shell's directory from drifting.
- End every commit message with the `Co-Authored-By` line the harness gives you for commits.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `libs/authz/src/finance-opt-out.ts` | create | `financeOptOutOverrides()` and `FINANCE_OPT_OUT_REASON` |
| `libs/authz/src/finance-opt-out.spec.ts` | create | its tests |
| `libs/authz/src/index.ts` | modify | export them |
| `apps/iam/prisma/schema.prisma` | modify | `User.financeEnabled` |
| `apps/iam/prisma/migrations/20261010000100_user_finance_enabled/migration.sql` | create | add the column |
| `libs/contracts/src/iam/user.ts` | modify | `CreateUserSchema.financeEnabled`, `UserResponseSchema.financeEnabled` |
| `libs/contracts/src/iam/user.spec.ts` | modify | contract tests |
| `apps/iam/src/users/users.service.ts` | modify | create validation, response field, `setRoles` reset |
| `apps/iam/src/users/users.service.spec.ts` | modify | service tests |
| `apps/iam/prisma/seed.integration.spec.ts` | modify | column default, and proof the migration applies |
| `apps/iam/src/auth/auth.service.ts` | modify | token claim drops finance |
| `apps/iam/src/auth/auth.service.spec.ts` | modify | tests |
| `apps/iam/src/effective/effective.service.ts` | modify | effective read, simulator and `holders` drop finance |
| `apps/iam/src/effective/effective.service.spec.ts` | modify | tests |
| `apps/web/app/lib/user-api.ts` | modify | `User.financeEnabled` |
| `apps/web/app/users/role-access.ts` + `.spec.ts` | modify | summary can leave finance out |
| `apps/web/app/users/forms.tsx` | modify | the checkbox on the new-user form |
| `apps/web/app/users/actions.ts` + `actions.spec.ts` | modify | send `financeEnabled: false` when offered and unticked |
| `apps/web/app/users/page.tsx` + `page.spec.tsx` (new) | modify/create | "Finance off" tag |
| `apps/web/app/styles.css` | modify | `.role-pill-off`, `.finance-choice` |
| `apps/web/app/overview/engineer-overview.tsx` + `.spec.tsx` (new) | modify/create | hide the Finance button |
| `apps/web/app/page.tsx` | modify | pass `canViewFinance` |
| `apps/mobile/lib/shared/layout/floating_nav_bar.dart` | modify | `hiddenTabs` |
| `apps/mobile/lib/shared/layout/main_scaffold.dart` | modify | `hiddenTabs`, `financeTabIndex`, fallback |
| `apps/mobile/lib/main.dart` | modify | `SignedInHome` |
| `apps/mobile/lib/features/guide/presentation/app_guide_modal.dart` | modify | drop the Finance entry |
| `apps/mobile/test/shared/main_scaffold_test.dart` | modify | hidden-tab test |
| `apps/mobile/test/shared/signed_in_home_test.dart` | create | permission → tab test |
| `e2e/finance-optional.e2e.spec.ts` | create | end to end |
| `docs/superpowers/specs/2026-10-10-field-engineer-optional-finance-design.md` | modify | §7 wording |

---

### Task 1: The finance opt-out overrides (`libs/authz`)

**Files:**
- Create: `libs/authz/src/finance-opt-out.ts`
- Create: `libs/authz/src/finance-opt-out.spec.ts`
- Modify: `libs/authz/src/index.ts`

**Interfaces:**
- Produces: `financeOptOutOverrides(): AuthzOverride[]`, `FINANCE_OPT_OUT_REASON: string`, both exported from `@ipms/authz`. Tasks 3 and 4 import them.

- [ ] **Step 1: Write the failing test**

Create `libs/authz/src/finance-opt-out.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { check } from './evaluate.js';
import { FINANCE_OPT_OUT_REASON, financeOptOutOverrides } from './finance-opt-out.js';
import { resolvePermissions } from './permission-resolution.js';
import { PERMISSIONS } from './permissions.js';
import type { AuthzOverride } from './types.js';

const NOW = new Date('2026-10-10T12:00:00Z');

/** What a Field Engineer's role grants today, plus two non-finance permissions. */
const ENGINEER_ROLE = [
  'project.view', 'task.view',
  'finance_request.view', 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit',
];

describe('financeOptOutOverrides', () => {
  it('denies every finance permission in the catalog, and nothing else', () => {
    const denied = financeOptOutOverrides().map((o) => o.permission).sort();
    const finance = PERMISSIONS.filter((p) => p.module.startsWith('finance_')).map((p) => p.code).sort();
    expect(denied).toEqual(finance);
    expect(denied).toContain('finance_request.view');
    expect(denied).toContain('finance_approval.director');
    expect(denied.every((code) => code.startsWith('finance_'))).toBe(true);
  });

  it('are global DENY overrides with no validity window', () => {
    for (const o of financeOptOutOverrides()) {
      expect(o).toMatchObject({ effect: 'DENY', projectId: null, siteId: null, validFrom: null, validUntil: null });
    }
  });

  it('strip finance from an engineer role and keep everything else', () => {
    const resolved = resolvePermissions(ENGINEER_ROLE, financeOptOutOverrides(), NOW);
    expect([...resolved].sort()).toEqual(['project.view', 'task.view']);
  });

  it('outrank an ALLOW override added by hand', () => {
    const allow: AuthzOverride = {
      permission: 'finance_request.create', effect: 'ALLOW',
      projectId: null, siteId: null, validFrom: null, validUntil: null,
    };
    const resolved = resolvePermissions(ENGINEER_ROLE, [allow, ...financeOptOutOverrides()], NOW);
    expect(resolved).not.toContain('finance_request.create');
  });

  it('make check() refuse a finance permission as a DENY override', () => {
    const decision = check({
      user: { id: 'u-1', roles: ['FIELD_ENGINEER'], permissions: ENGINEER_ROLE, tokenVersion: 0, isActive: true },
      permission: 'finance_request.view',
      scope: { global: true, projectIds: [], siteIds: [] },
      overrides: financeOptOutOverrides(),
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('DENIED_BY_OVERRIDE');
  });
});

describe('FINANCE_OPT_OUT_REASON', () => {
  it('says whose money it is', () => {
    expect(FINANCE_OPT_OUT_REASON).toBe("Finance is handled by this engineer's own company");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `(cd libs/authz && pnpm exec vitest run src/finance-opt-out.spec.ts)`
Expected: FAIL, `Failed to resolve import "./finance-opt-out.js"`.

- [ ] **Step 3: Write the implementation**

Create `libs/authz/src/finance-opt-out.ts`:

```ts
import { PERMISSIONS } from './permissions.js';
import type { AuthzOverride } from './types.js';

/** Shown wherever IAM explains why a Field Engineer holds no finance permission. */
export const FINANCE_OPT_OUT_REASON = "Finance is handled by this engineer's own company";

/**
 * Every permission in a `finance_*` module, read from the catalog rather than
 * listed, so a finance permission added later is closed to an opted-out
 * engineer without anyone remembering to add it here.
 */
const FINANCE_CODES: readonly string[] = PERMISSIONS
  .filter((p) => p.module.startsWith('finance_'))
  .map((p) => p.code);

/**
 * The global DENY overrides that stand in for "this engineer's company handles
 * their money".
 *
 * Synthesised in memory for a user whose `financeEnabled` is false, never
 * stored. A DENY outranks a role grant and an ALLOW override alike
 * (`resolvePermissions`, `check()`), so the token claim, the effective-permissions
 * read and `holders` all agree, and an ALLOW added by hand cannot bring finance back.
 */
export function financeOptOutOverrides(): AuthzOverride[] {
  return FINANCE_CODES.map((permission) => ({
    permission, effect: 'DENY', projectId: null, siteId: null, validFrom: null, validUntil: null,
  }));
}
```

Edit `libs/authz/src/index.ts`: add this line at the end of the file:

```ts
export { FINANCE_OPT_OUT_REASON, financeOptOutOverrides } from './finance-opt-out.js';
```

- [ ] **Step 4: Run the tests and rebuild the package**

Run: `(cd libs/authz && pnpm exec vitest run) && pnpm --filter @ipms/authz build`
Expected: all authz tests PASS (the new file adds 6), and the build ends with no `tsc` errors.

- [ ] **Step 5: Commit**

```bash
git add libs/authz/src/finance-opt-out.ts libs/authz/src/finance-opt-out.spec.ts libs/authz/src/index.ts
git commit -m "feat(authz): overrides that close finance to an opted-out engineer"
```

---

### Task 2: The column, the contract and user creation (`libs/contracts`, `apps/iam`)

**Files:**
- Modify: `apps/iam/prisma/schema.prisma`
- Create: `apps/iam/prisma/migrations/20261010000100_user_finance_enabled/migration.sql`
- Modify: `libs/contracts/src/iam/user.ts`
- Modify: `libs/contracts/src/iam/user.spec.ts`
- Modify: `apps/iam/src/users/users.service.ts`
- Modify: `apps/iam/src/users/users.service.spec.ts`
- Modify: `apps/iam/prisma/seed.integration.spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `CreateUserDto.financeEnabled?: boolean`; `UserResponse.financeEnabled: boolean`; the Prisma field `User.financeEnabled`. Task 3 reads `user.financeEnabled`; Task 4 sends `financeEnabled: false` to `POST /users` and reads it from the response.

- [ ] **Step 1: Write the failing contract tests**

In `libs/contracts/src/iam/user.spec.ts`, add inside `describe('CreateUserSchema', …)` after the `'strips keys the caller has no business setting'` test:

```ts
  it('leaves financeEnabled undecided unless the caller sends it', () => {
    expect(CreateUserSchema.parse(valid).financeEnabled).toBeUndefined();
    expect(CreateUserSchema.parse({ ...valid, financeEnabled: false }).financeEnabled).toBe(false);
    expect(CreateUserSchema.parse({ ...valid, financeEnabled: true }).financeEnabled).toBe(true);
  });

  it('refuses a financeEnabled that is not a boolean', () => {
    expect(CreateUserSchema.safeParse({ ...valid, financeEnabled: 'no' }).success).toBe(false);
  });
```

and inside `describe('UpdateUserSchema', …)` after the password test:

```ts
  it('has no financeEnabled: finance is chosen when the account is created, and not afterwards', () => {
    expect(UpdateUserSchema.parse({ fullName: 'Ann Lee', financeEnabled: false })).toEqual({ fullName: 'Ann Lee' });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `(cd libs/contracts && pnpm exec vitest run src/iam/user.spec.ts)`
Expected: FAIL on `leaves financeEnabled undecided…` (the first assertion passes, the `false` case gets `undefined` because the key is stripped) and on `refuses a financeEnabled that is not a boolean`.

- [ ] **Step 3: Change the contract**

In `libs/contracts/src/iam/user.ts`, replace

```ts
  roleCodes: SingleRoleSchema.default([]),
}).strip();
export type CreateUserDto = z.infer<typeof CreateUserSchema>;
```

with

```ts
  roleCodes: SingleRoleSchema.default([]),
  /**
   * Whether the user goes through Axiom finance. Only a Field Engineer may have
   * it off (the service refuses it for anyone else): some are vendor staff whose
   * own company pays their advances and settles their expenses. Chosen here and
   * nowhere else, so `UpdateUserSchema` does not carry it.
   */
  financeEnabled: z.boolean().optional(),
}).strip();
export type CreateUserDto = z.infer<typeof CreateUserSchema>;
```

and in `UserResponseSchema` replace

```ts
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
```

with

```ts
  mustChangePassword: z.boolean(),
  financeEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
```

- [ ] **Step 4: Run the contract tests and rebuild**

Run: `(cd libs/contracts && pnpm exec vitest run src/iam/user.spec.ts) && pnpm --filter @ipms/contracts build`
Expected: PASS, build clean.

- [ ] **Step 5: Add the column**

In `apps/iam/prisma/schema.prisma`, in `model User`, after the `mustChangePassword Boolean @default(false)` line add:

```prisma

  /// False for a Field Engineer whose own company, not Axiom finance, handles
  /// their advances and settlements. Chosen once, when the account is created;
  /// the finance permissions are then withheld at token issuance (see
  /// `financeOptOutOverrides` in @ipms/authz). Only a Field Engineer may have it off.
  financeEnabled Boolean @default(true)
```

Create `apps/iam/prisma/migrations/20261010000100_user_finance_enabled/migration.sql`:

```sql
-- Whether the user goes through Axiom finance. False only for a Field Engineer
-- whose own company handles their advances and settlements; set at creation.
ALTER TABLE "user" ADD COLUMN "financeEnabled" boolean NOT NULL DEFAULT true;
```

Regenerate the Prisma client (the URL is only read, not connected to):

Run: `(cd apps/iam && DATABASE_URL=postgresql://x:x@localhost:5433/x pnpm exec prisma generate)`
Expected: `✔ Generated Prisma Client …`.

- [ ] **Step 6: Write the failing service tests**

In `apps/iam/src/users/users.service.spec.ts`:

1. In the `row()` fixture, add `financeEnabled: true,` after `mustChangePassword: false,`:

```ts
    mustChangePassword: false, financeEnabled: true, lastLoginAt: null, createdAt: new Date('2026-01-01T00:00:00Z'),
```

2. Add this block after the `describe('UsersService.create', …)` block (before `describe('UsersService.update', …)`):

```ts
describe('UsersService.create — the finance switch', () => {
  const dto = {
    email: 'vendor.one@ipms.local', fullName: 'Vendor One',
    password: 'a-long-enough-password', roleCodes: ['FIELD_ENGINEER'],
  };

  it('leaves finance on unless told otherwise', async () => {
    const { service, tx } = build(null);
    await service.create(dto, ACTOR, ADMIN);
    expect(tx.user.create.mock.calls[0]![0].data.financeEnabled).toBe(true);
  });

  it('lets an administrator create a field engineer with finance off', async () => {
    const { service, tx } = build(null);
    await service.create({ ...dto, financeEnabled: false }, ACTOR, ADMIN);
    expect(tx.user.create.mock.calls[0]![0].data.financeEnabled).toBe(false);
  });

  it('lets a project manager create a field engineer with finance off', async () => {
    const { service, tx } = build(null);
    await service.create({ ...dto, financeEnabled: false }, ACTOR, MANAGER);
    expect(tx.user.create.mock.calls[0]![0].data.financeEnabled).toBe(false);
  });

  it('refuses finance off for any role but a field engineer', async () => {
    const { service, tx } = build(null);
    await expect(service.create({ ...dto, roleCodes: ['QC_MANAGER'], financeEnabled: false }, ACTOR, ADMIN))
      .rejects.toThrow('Only a Field Engineer can have finance turned off');
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('refuses finance off for a user with no role', async () => {
    const { service } = build(null);
    await expect(service.create({ ...dto, roleCodes: [], financeEnabled: false }, ACTOR, ADMIN))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts finance on for any role', async () => {
    const { service, tx } = build(null);
    await service.create({ ...dto, roleCodes: ['QC_MANAGER'], financeEnabled: true }, ACTOR, ADMIN);
    expect(tx.user.create).toHaveBeenCalled();
  });

  it('records the choice in the audit entry', async () => {
    const { service, tx } = build(null);
    await service.create({ ...dto, financeEnabled: false }, ACTOR, ADMIN);
    const audit = tx.outboxEvent.create.mock.calls
      .map((call) => call[0].data)
      .find((data: { subject: string }) => data.subject === 'audit.event.recorded');
    expect(audit.payload.newState.financeEnabled).toBe(false);
  });

  it('reports the switch on the user it returns', async () => {
    const { service } = build(row({ financeEnabled: false }));
    expect((await service.get(TARGET)).financeEnabled).toBe(false);
  });
});
```

3. Add this block after the `describe('UsersService.setRoles', …)` block:

```ts
describe('UsersService.setRoles — the finance switch', () => {
  const financeWrites = (tx: ReturnType<typeof build>['tx']) =>
    tx.user.update.mock.calls.filter(([arg]) => 'financeEnabled' in (arg as { data: object }).data);

  it('gives finance back to an engineer who stops being one', async () => {
    const { service, tx } = build(row({ financeEnabled: false }));
    await service.setRoles(TARGET, { roleCodes: ['QC_MANAGER'] }, ACTOR, ADMIN);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: TARGET }, data: { financeEnabled: true } });
  });

  it('records the reset in the audit entry', async () => {
    const { service, tx } = build(row({ financeEnabled: false }));
    await service.setRoles(TARGET, { roleCodes: ['QC_MANAGER'] }, ACTOR, ADMIN);
    const audit = tx.outboxEvent.create.mock.calls
      .map((call) => call[0].data)
      .find((data: { subject: string }) => data.subject === 'audit.event.recorded');
    expect(audit.payload.previousState).toEqual({ roleCodes: ['FIELD_ENGINEER'], financeEnabled: false });
    expect(audit.payload.newState).toEqual({ roleCodes: ['QC_MANAGER'], financeEnabled: true });
  });

  it('leaves finance off when the user is still a field engineer', async () => {
    const { service, tx } = build(row({ financeEnabled: false }));
    await service.setRoles(TARGET, { roleCodes: ['FIELD_ENGINEER'] }, ACTOR, ADMIN);
    expect(financeWrites(tx)).toHaveLength(0);
  });

  it('does not write finance for a user who already has it on', async () => {
    const { service, tx } = build();
    await service.setRoles(TARGET, { roleCodes: ['QC_MANAGER'] }, ACTOR, ADMIN);
    expect(financeWrites(tx)).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `(cd apps/iam && pnpm exec vitest run src/users/users.service.spec.ts)`
Expected: FAIL: the `data.financeEnabled` assertions get `undefined`, the refusal tests resolve instead of rejecting, `reports the switch…` gets `undefined`, and the `setRoles` reset tests find no write.

- [ ] **Step 8: Implement in `apps/iam/src/users/users.service.ts`**

(a) After the `DIRECTORY_LIMIT` constant add:

```ts

/** The one role that may have finance turned off: vendor staff, whose own company handles their money. */
const FIELD_ENGINEER = 'FIELD_ENGINEER';
```

(b) In `USER_SELECT`, change the second line to

```ts
  isActive: true, mustChangePassword: true, financeEnabled: true, lastLoginAt: true, createdAt: true,
```

(c) In `interface UserRow`, after `mustChangePassword: boolean;` add:

```ts
  financeEnabled: boolean;
```

(d) In `toResponse`, after `mustChangePassword: row.mustChangePassword,` add:

```ts
    financeEnabled: row.financeEnabled,
```

(e) In `create`, replace

```ts
    this.assertMayAssign(actorRoleCodes, dto.roleCodes);

    // Hashed before the transaction opens
```

with

```ts
    this.assertMayAssign(actorRoleCodes, dto.roleCodes);

    // Finance is on unless the caller says otherwise, and only a Field Engineer
    // may turn it off: it exists for vendor staff whose own company pays their
    // advances and settles their expenses. Checked here rather than in the
    // schema so the refusal is a 400 naming the rule.
    const financeEnabled = dto.financeEnabled ?? true;
    if (!financeEnabled && !(dto.roleCodes.length === 1 && dto.roleCodes[0] === FIELD_ENGINEER)) {
      throw new BadRequestException('Only a Field Engineer can have finance turned off');
    }

    // Hashed before the transaction opens
```

(f) In the same method, replace

```ts
          mustChangePassword: true,
        },
      });
```

with

```ts
          mustChangePassword: true,
          financeEnabled,
        },
      });
```

(g) In the same method, replace

```ts
      await this.audit(tx, actorId, 'user.created', id, {}, {
        email: dto.email, fullName: dto.fullName,
        roleCodes: roles.map((role) => role.code),
      });
```

with

```ts
      await this.audit(tx, actorId, 'user.created', id, {}, {
        email: dto.email, fullName: dto.fullName,
        roleCodes: roles.map((role) => role.code),
        financeEnabled,
      });
```

(h) In `setRoles`, replace

```ts
      await this.audit(tx, actorId, 'user.roles_changed', id,
        { roleCodes: previousCodes }, { roleCodes: dto.roleCodes });
```

with

```ts
      // An engineer made something else is no longer one: finance is theirs
      // again, rather than withheld by a switch only an engineer can carry.
      const restoresFinance = existing.financeEnabled === false && !dto.roleCodes.includes(FIELD_ENGINEER);
      if (restoresFinance) await tx.user.update({ where: { id }, data: { financeEnabled: true } });

      await this.audit(tx, actorId, 'user.roles_changed', id,
        { roleCodes: previousCodes, ...(restoresFinance ? { financeEnabled: false } : {}) },
        { roleCodes: dto.roleCodes, ...(restoresFinance ? { financeEnabled: true } : {}) });
```

- [ ] **Step 9: Run the service tests and the typecheck**

Run: `(cd apps/iam && pnpm exec vitest run src/users) && pnpm --filter iam typecheck`
Expected: all users tests PASS (the existing ones included), typecheck clean.

- [ ] **Step 10: Prove the migration applies, and the default**

In `apps/iam/prisma/seed.integration.spec.ts`, inside `describe('seedDemoUsers global scope replication', …)`, after the test `'grants global scope to the administrator and to finance, nobody else'`, add:

```ts
  it('leaves finance on for every demo account', async () => {
    expect(await prisma.user.count({ where: { financeEnabled: false } })).toBe(0);
    expect(await prisma.user.count({ where: { financeEnabled: true } })).toBeGreaterThan(0);
  });
```

Run: `(cd apps/iam && pnpm exec vitest run prisma/seed.integration.spec.ts)`
Expected: PASS. This starts a Postgres container (Docker must be running) and runs `prisma migrate deploy`, so a passing run proves the new migration applies cleanly.

- [ ] **Step 11: Commit**

```bash
git add apps/iam/prisma/schema.prisma apps/iam/prisma/migrations/20261010000100_user_finance_enabled/migration.sql \
  libs/contracts/src/iam/user.ts libs/contracts/src/iam/user.spec.ts \
  apps/iam/src/users/users.service.ts apps/iam/src/users/users.service.spec.ts \
  apps/iam/prisma/seed.integration.spec.ts
git commit -m "feat(iam): a field engineer can be created with finance switched off"
```

---

### Task 3: Withhold the finance permissions (`apps/iam`)

**Files:**
- Modify: `apps/iam/src/auth/auth.service.ts`
- Modify: `apps/iam/src/auth/auth.service.spec.ts`
- Modify: `apps/iam/src/effective/effective.service.ts`
- Modify: `apps/iam/src/effective/effective.service.spec.ts`

**Interfaces:**
- Consumes: `financeOptOutOverrides()` and `FINANCE_OPT_OUT_REASON` from `@ipms/authz` (Task 1, rebuilt); the `User.financeEnabled` Prisma field (Task 2). A user row from `findUnique({ include: … })` already carries scalar columns, so `financeEnabled` arrives with no select change.
- Produces: tokens, the effective read, the simulator and `holders` that all treat a user with `financeEnabled === false` as holding no `finance_*` permission.

- [ ] **Step 1: Write the failing auth tests**

Append to `apps/iam/src/auth/auth.service.spec.ts`:

```ts
/**
 * A Field Engineer whose own company handles their money gets a token with no
 * finance permission in it, so every service's guard refuses finance for them
 * without a line of finance-specific code. A DENY outranks the role grant.
 */
describe('AuthService and the finance switch', () => {
  const ENGINEER_ROLE = {
    role: {
      code: 'FIELD_ENGINEER', isActive: true,
      permissions: [
        { permission: { code: 'task.view' } },
        { permission: { code: 'finance_request.view' } },
        { permission: { code: 'finance_request.create' } },
        { permission: { code: 'finance_settlement.submit' } },
      ],
    },
    validFrom: null, validUntil: null,
  };

  it('keeps finance in the token when the switch is on', async () => {
    const { service } = await build({ roles: [ENGINEER_ROLE], financeEnabled: true });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('finance_request.create');
  });

  it('keeps finance in the token for a row that predates the switch', async () => {
    const { service } = await build({ roles: [ENGINEER_ROLE] });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toContain('finance_request.create');
  });

  it('leaves every finance permission out of the token, and keeps the rest', async () => {
    const { service } = await build({ roles: [ENGINEER_ROLE], financeEnabled: false });
    const pair = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    expect(tokens.verifyAccess(pair.accessToken).permissions).toEqual(['task.view']);
  });

  it('leaves finance out after a refresh as well', async () => {
    const { service } = await build({ roles: [ENGINEER_ROLE], financeEnabled: false });
    const { refreshToken } = await service.login({ email: 'engineer@ipms.local', password: 'demo12345' });
    const pair = await service.refresh(refreshToken);
    expect(tokens.verifyAccess(pair.accessToken).permissions).toEqual(['task.view']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `(cd apps/iam && pnpm exec vitest run src/auth/auth.service.spec.ts)`
Expected: FAIL on `leaves every finance permission out…` and `leaves finance out after a refresh…` (the token still carries the finance codes).

- [ ] **Step 3: Implement in `apps/iam/src/auth/auth.service.ts`**

Change the import:

```ts
import { financeOptOutOverrides, resolvePermissions, type AuthzOverride } from '@ipms/authz';
```

In `claimsFor`, change the parameter type from `user: { roles: unknown; overrides?: unknown },` to

```ts
    user: { roles: unknown; overrides?: unknown; financeEnabled?: boolean },
```

and replace

```ts
    const overrides: AuthzOverride[] = ((user.overrides ?? []) as OverrideRow[]).map((o) => ({
      permission: o.permission.code,
      effect: o.effect === 'DENY' ? 'DENY' : 'ALLOW',
      projectId: o.projectId,
      siteId: o.siteId,
      validFrom: o.validFrom,
      validUntil: o.validUntil,
    }));
```

with

```ts
    const stored: AuthzOverride[] = ((user.overrides ?? []) as OverrideRow[]).map((o) => ({
      permission: o.permission.code,
      effect: o.effect === 'DENY' ? 'DENY' : 'ALLOW',
      projectId: o.projectId,
      siteId: o.siteId,
      validFrom: o.validFrom,
      validUntil: o.validUntil,
    }));
    // A Field Engineer whose own company handles their money holds no finance
    // permission. Synthesised here, never stored; a DENY outranks any role grant
    // or ALLOW override, so nothing else needs to know.
    const overrides = user.financeEnabled === false ? [...stored, ...financeOptOutOverrides()] : stored;
```

- [ ] **Step 4: Run the auth tests**

Run: `(cd apps/iam && pnpm exec vitest run src/auth/auth.service.spec.ts)`
Expected: PASS.

- [ ] **Step 5: Write the failing effective-service tests**

In `apps/iam/src/effective/effective.service.spec.ts`, add the import `import { FINANCE_OPT_OUT_REASON } from '@ipms/authz';` next to the existing imports, then append:

```ts
/**
 * A Field Engineer whose own company handles their money. The effective read,
 * the simulator and `holders` must all say what the token says: no finance.
 */
describe('EffectiveService — finance switched off', () => {
  function buildEngineer(financeEnabled: boolean) {
    const user = {
      id: USER, isActive: true, tokenVersion: 0, financeEnabled,
      globalScopes: [],
      roles: [{
        role: {
          code: 'FIELD_ENGINEER', isActive: true,
          permissions: [
            { permission: { code: 'task.view' } },
            { permission: { code: 'finance_request.view' } },
            { permission: { code: 'finance_request.create' } },
          ],
        },
        validFrom: null, validUntil: null,
      }],
      projectScopes: [{ projectId: 'p-1' }],
      siteScopes: [],
      overrides: [],
    };
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user), findMany: vi.fn().mockResolvedValue([user]) } };
    return new EffectiveService(prisma as never);
  }

  it('reports each finance permission as denied, with the reason', async () => {
    const result = await buildEngineer(false).forUser(USER);
    expect(result.find((p) => p.code === 'finance_request.create')).toMatchObject({
      granted: false, source: 'OVERRIDE_DENY', sourceDetail: FINANCE_OPT_OUT_REASON,
    });
    expect(result.find((p) => p.code === 'finance_request.view')).toMatchObject({ granted: false });
  });

  it('still grants everything that is not finance', async () => {
    const result = await buildEngineer(false).forUser(USER);
    expect(result.find((p) => p.code === 'task.view')).toMatchObject({ granted: true, source: 'ROLE' });
  });

  it('leaves finance granted when the switch is on', async () => {
    const result = await buildEngineer(true).forUser(USER);
    expect(result.find((p) => p.code === 'finance_request.create')).toMatchObject({ granted: true, source: 'ROLE' });
  });

  it('refuses a finance permission in the simulator', async () => {
    const result = await buildEngineer(false).simulate({ userId: USER, permissionCode: 'finance_request.create' });
    expect(result).toMatchObject({ allowed: false, reason: 'DENIED_BY_OVERRIDE' });
  });

  it('allows the same permission in the simulator when the switch is on', async () => {
    const result = await buildEngineer(true).simulate({ userId: USER, permissionCode: 'finance_request.create' });
    expect(result.allowed).toBe(true);
  });

  it('never lists such an engineer as a holder of a finance permission', async () => {
    expect(await buildEngineer(false).holders('finance_request.view', 'p-1')).toEqual([]);
    expect(await buildEngineer(true).holders('finance_request.view', 'p-1')).toEqual([USER]);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `(cd apps/iam && pnpm exec vitest run src/effective/effective.service.spec.ts)`
Expected: FAIL on the five "switched off" tests; the two "switch is on" tests already pass.

- [ ] **Step 7: Implement in `apps/iam/src/effective/effective.service.ts`**

Change the import:

```ts
import {
  check, FINANCE_OPT_OUT_REASON, financeOptOutOverrides, resolvePermissions,
  type AuthzOverride, type AuthzResource, type AuthzScope, type AuthzUser,
} from '@ipms/authz';
```

In `interface LoadedUser`, after `tokenVersion: number;` add:

```ts
  /** Absent on a row that predates the column; only an explicit false opts out. */
  financeEnabled?: boolean;
```

After the `isLive` function add:

```ts
/**
 * A Field Engineer whose own company handles their money gets a global DENY on
 * every finance permission, appended to their overrides in memory. Everything
 * downstream (`forUser`, `simulate`, `holders`, `check()`) already honours a
 * DENY over any role grant, so none of it needs to know why. Matches the token
 * claim, which applies the same overrides in `AuthService.claimsFor`.
 */
function withFinanceOptOut(user: LoadedUser): LoadedUser {
  if (user.financeEnabled !== false) return user;
  const denied = financeOptOutOverrides().map((o) => ({
    permission: { code: o.permission }, effect: o.effect,
    projectId: null, siteId: null, validFrom: null, validUntil: null,
    reason: FINANCE_OPT_OUT_REASON,
  }));
  return { ...user, overrides: [...user.overrides, ...denied] };
}
```

In `load`, change `return user as unknown as LoadedUser;` to

```ts
    return withFinanceOptOut(user as unknown as LoadedUser);
```

In `holders`, replace

```ts
    const users = (await this.prisma.user.findMany({
      where: { isActive: true },
      include: USER_INCLUDE,
    })) as unknown as LoadedUser[];
```

with

```ts
    const users = ((await this.prisma.user.findMany({
      where: { isActive: true },
      include: USER_INCLUDE,
    })) as unknown as LoadedUser[]).map(withFinanceOptOut);
```

- [ ] **Step 8: Run all IAM unit tests and the typecheck**

Run: `(cd apps/iam && pnpm exec vitest run src) && pnpm --filter iam typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add apps/iam/src/auth/auth.service.ts apps/iam/src/auth/auth.service.spec.ts \
  apps/iam/src/effective/effective.service.ts apps/iam/src/effective/effective.service.spec.ts
git commit -m "feat(iam): withhold every finance permission from an engineer with finance off"
```

---

### Task 4: The choice on the new-user form (`apps/web`)

**Files:**
- Modify: `apps/web/app/lib/user-api.ts`
- Modify: `apps/web/app/users/role-access.ts`, `apps/web/app/users/role-access.spec.ts`
- Modify: `apps/web/app/users/forms.tsx`
- Modify: `apps/web/app/users/actions.ts`, `apps/web/app/users/actions.spec.ts`
- Modify: `apps/web/app/users/page.tsx`; create `apps/web/app/users/page.spec.tsx`
- Modify: `apps/web/app/styles.css`

**Interfaces:**
- Consumes: `POST /api/v1/users` accepting `financeEnabled` and returning it (Task 2); `@ipms/contracts` rebuilt.
- Produces: `User.financeEnabled: boolean`; `summarizeAccess(selected, roles, catalog, options?: { financeEnabled?: boolean })`; `isFinancePermission(code: string): boolean`; form fields `financeOffered` (marker) and `financeEnabled` (checkbox).

- [ ] **Step 1: Write the failing role-access tests**

Append to `apps/web/app/users/role-access.spec.ts`:

```ts
describe('summarizeAccess with finance switched off', () => {
  const financeCatalog = [
    ...catalog,
    { code: 'finance_request.view', module: 'finance_request', description: 'View your own finance requests' },
    { code: 'finance_request.create', module: 'finance_request', description: 'Raise an advance or reimbursement request' },
  ];
  const engineer = [{
    code: 'FIELD_ENGINEER', name: 'Field Engineer',
    permissionCodes: ['project.view', 'finance_request.view', 'finance_request.create'],
  }];

  it('lists finance by default', () => {
    const summary = summarizeAccess(['FIELD_ENGINEER'], engineer, financeCatalog);
    expect(summary.total).toBe(3);
    expect(summary.groups.map((g) => g.label)).toContain('Finance request');
  });

  it('leaves finance out when it is switched off, and keeps the rest', () => {
    const summary = summarizeAccess(['FIELD_ENGINEER'], engineer, financeCatalog, { financeEnabled: false });
    expect(summary.total).toBe(1);
    expect(summary.groups.map((g) => g.module)).toEqual(['project']);
  });

  it('knows a finance permission by its module', () => {
    expect(isFinancePermission('finance_payment.record')).toBe(true);
    expect(isFinancePermission('project.view')).toBe(false);
  });
});
```

Change the import at the top of that file to `import { isFinancePermission, summarizeAccess } from './role-access';`.

- [ ] **Step 2: Run it to verify it fails**

Run: `(cd apps/web && pnpm exec vitest run app/users/role-access.spec.ts)`
Expected: FAIL: `isFinancePermission is not a function` (and the finance-off summary still has 3 permissions).

- [ ] **Step 3: Implement in `apps/web/app/users/role-access.ts`**

Add before `summarizeAccess`:

```ts
/** Finance permissions live in `finance_*` modules: `finance_request.view`, `finance_payment.record`, … */
export function isFinancePermission(code: string): boolean {
  return code.startsWith('finance_');
}

```

Change the signature and loop:

```ts
export function summarizeAccess(
  selected: readonly string[],
  roles: readonly RolePermissions[],
  catalog: readonly PermissionInfo[],
  options: { financeEnabled?: boolean } = {},
): AccessSummary {
  const withFinance = options.financeEnabled ?? true;
  const grantedBy = new Map<string, string[]>();
  for (const role of roles) {
    if (!selected.includes(role.code)) continue;
    for (const code of role.permissionCodes) {
      // An engineer created with finance off never holds these; iam withholds them.
      if (!withFinance && isFinancePermission(code)) continue;
      grantedBy.set(code, [...(grantedBy.get(code) ?? []), role.name]);
    }
  }
```

(the rest of the function is unchanged).

- [ ] **Step 4: Run it to verify it passes**

Run: `(cd apps/web && pnpm exec vitest run app/users/role-access.spec.ts)`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing action tests**

In `apps/web/app/users/actions.spec.ts`, inside `describe('createUserAction', …)` after the `'omits employeeCode…'` test, add:

```ts
  describe('the finance switch', () => {
    it('turns finance off when the box was offered and left unticked', async () => {
      await expect(createUserAction({}, form({ ...NEW_USER, financeOffered: '1' }))).rejects.toThrow('NEXT_REDIRECT');
      expect(createUser.mock.calls[0]![0]).toMatchObject({ roleCodes: ['FIELD_ENGINEER'], financeEnabled: false });
    });

    it('leaves finance on when the box was ticked', async () => {
      await expect(createUserAction({}, form({ ...NEW_USER, financeOffered: '1', financeEnabled: 'on' })))
        .rejects.toThrow('NEXT_REDIRECT');
      expect(createUser.mock.calls[0]![0]).not.toHaveProperty('financeEnabled');
    });

    it('leaves finance on when the box was never offered', async () => {
      await expect(createUserAction({}, form(NEW_USER))).rejects.toThrow('NEXT_REDIRECT');
      expect(createUser.mock.calls[0]![0]).not.toHaveProperty('financeEnabled');
    });

    it('ignores the box for any other role', async () => {
      await expect(createUserAction({}, form({ ...NEW_USER, roleCodes: 'QC_MANAGER', financeOffered: '1' })))
        .rejects.toThrow('NEXT_REDIRECT');
      expect(createUser.mock.calls[0]![0]).not.toHaveProperty('financeEnabled');
    });
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `(cd apps/web && pnpm exec vitest run app/users/actions.spec.ts)`
Expected: FAIL on `turns finance off when the box was offered and left unticked`.

- [ ] **Step 7: Implement the action and the type**

In `apps/web/app/users/actions.ts`, replace

```ts
  const employeeCode = optional(form, 'employeeCode');
  const result = await createUser({
    email, fullName, password: password.password, roleCodes: role.roleCodes,
    ...(employeeCode === undefined ? {} : { employeeCode }),
  });
```

with

```ts
  const employeeCode = optional(form, 'employeeCode');
  // The box is offered, with a marker beside it, only for a Field Engineer.
  // Offered and not ticked means off; a form that never offered it leaves
  // finance on, so a missing field can never switch anyone's finance off.
  const financeOff = role.roleCodes[0] === 'FIELD_ENGINEER'
    && form.get('financeOffered') !== null && form.get('financeEnabled') === null;
  const result = await createUser({
    email, fullName, password: password.password, roleCodes: role.roleCodes,
    ...(employeeCode === undefined ? {} : { employeeCode }),
    ...(financeOff ? { financeEnabled: false } : {}),
  });
```

In `apps/web/app/lib/user-api.ts`, in `export interface User`, after `mustChangePassword: boolean;` add:

```ts
  /** False for a Field Engineer whose own company handles their advances and expenses. */
  financeEnabled: boolean;
```

Run: `(cd apps/web && pnpm exec vitest run app/users/actions.spec.ts)`
Expected: PASS.

- [ ] **Step 8: Add the checkbox to the form**

In `apps/web/app/users/forms.tsx`:

(a) Replace the `RoleAccessSummary` signature and its first line:

```tsx
function RoleAccessSummary({ selected, roles, catalog, financeEnabled = true }: {
  selected: string | undefined; roles: RolePermissions[]; catalog: Permission[]; financeEnabled?: boolean;
}) {
  const { total, groups } = summarizeAccess(selected === undefined ? [] : [selected], roles, catalog, { financeEnabled });
```

(b) Replace the start of `RolePicker`:

```tsx
function RolePicker({ grantable, held, locked, roles, catalog, offerFinanceChoice = false }: {
  grantable: Role[]; held: string | undefined; locked: UserRoleSummary[];
  roles: RolePermissions[]; catalog: Permission[];
  /** Only the new-user form: finance is chosen when the account is created, never afterwards. */
  offerFinanceChoice?: boolean;
}) {
  const [selected, setSelected] = useState<string | undefined>(held);
  const [financeEnabled, setFinanceEnabled] = useState(true);
  // The choice exists for a Field Engineer alone; for anyone else finance is just what their role grants.
  const choosesFinance = offerFinanceChoice && selected === 'FIELD_ENGINEER';
  return (
```

(c) Replace the end of `RolePicker`:

```tsx
      </fieldset>
      {choosesFinance ? (
        <div className="finance-choice">
          <input type="hidden" name="financeOffered" value="1" />
          <label className="checkbox">
            <input
              type="checkbox" name="financeEnabled" checked={financeEnabled}
              onChange={(event) => setFinanceEnabled(event.target.checked)}
            />
            Advances and expenses through Axiom
          </label>
          <p className="subtle">
            Turn off for vendor engineers whose own company pays their advances and settles their expenses.
          </p>
        </div>
      ) : null}
      <RoleAccessSummary
        selected={selected} roles={roles} catalog={catalog}
        financeEnabled={!choosesFinance || financeEnabled}
      />
    </>
```

(d) In `CreateUserForm`, change the picker line to

```tsx
      <RolePicker grantable={grantable} held={undefined} locked={[]} roles={grantable} catalog={catalog} offerFinanceChoice />
```

- [ ] **Step 9: Write the failing users-list test**

Create `apps/web/app/users/page.spec.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const listUsers = vi.fn();
const getCurrentUser = vi.fn();
vi.mock('../lib/user-api', () => ({ listUsers }));
vi.mock('../lib/iam-api', () => ({ getCurrentUser, hasPermission: () => false }));
vi.mock('../shell', () => ({
  Sidebar: () => null, TopActions: () => null, StatePage: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const { default: UsersPage } = await import('./page');

const person = (over: Record<string, unknown> = {}) => ({
  id: 'u-1', email: 'ann@ipms.local', fullName: 'Ann Lee', employeeCode: null, isActive: true,
  mustChangePassword: false, financeEnabled: true, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z',
  roles: [{ code: 'FIELD_ENGINEER', name: 'Field Engineer' }], ...over,
});
const listed = (items: unknown[]) => ({ state: 'ready', data: { items, total: items.length, page: 1, limit: 20 } });
const render = async () => renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  getCurrentUser.mockReset().mockResolvedValue({ state: 'ready', data: { id: 'u-admin', roles: [], permissions: [], tokenVersion: 0, isActive: true } });
});

describe('users list', () => {
  it('tags an engineer whose finance is handled elsewhere', async () => {
    listUsers.mockResolvedValue(listed([person({ financeEnabled: false })]));
    expect(await render()).toContain('Finance off');
  });

  it('shows no tag when finance is on', async () => {
    listUsers.mockResolvedValue(listed([person()]));
    expect(await render()).not.toContain('Finance off');
  });
});
```

Run: `(cd apps/web && pnpm exec vitest run app/users/page.spec.tsx)`
Expected: FAIL on `tags an engineer…` (no such text yet).

- [ ] **Step 10: Add the tag and the styles**

In `apps/web/app/users/page.tsx`, replace

```tsx
                            : <span className="role-pills">{user.roles.map((role) => <span key={role.name} className="role-pill">{role.name}</span>)}</span>}
```

with

```tsx
                            : (
                              <span className="role-pills">
                                {user.roles.map((role) => <span key={role.name} className="role-pill">{role.name}</span>)}
                                {user.financeEnabled ? null : <span className="role-pill role-pill-off" title="Their own company handles their advances and expenses">Finance off</span>}
                              </span>
                            )}
```

In `apps/web/app/styles.css`, directly after the `.role-pill { … }` line (around line 1499) add:

```css
.role-pill-off { background: #fdf1e1; color: #8a5a0c; }
.finance-choice { margin-top: 12px; }
.finance-choice .subtle { margin: 4px 0 0 24px; font-size: 12px; }
```

- [ ] **Step 11: Run the web tests and the typecheck**

Run: `(cd apps/web && pnpm exec vitest run app/users) && pnpm --filter web typecheck`
Expected: PASS, typecheck clean. (If typecheck reports errors in `apps/web/app/finance/`, they come from the unrelated uncommitted edits already in the tree. Confirm by reading the error paths, report them, and do not touch those files.)

- [ ] **Step 12: Commit**

```bash
git add apps/web/app/lib/user-api.ts apps/web/app/users/role-access.ts apps/web/app/users/role-access.spec.ts \
  apps/web/app/users/forms.tsx apps/web/app/users/actions.ts apps/web/app/users/actions.spec.ts \
  apps/web/app/users/page.tsx apps/web/app/users/page.spec.tsx apps/web/app/styles.css
git commit -m "feat(web): choose, when creating a field engineer, whether finance is theirs"
```

---

### Task 5: Hide the Finance button on the engineer home (`apps/web`)

**Files:**
- Modify: `apps/web/app/overview/engineer-overview.tsx`
- Create: `apps/web/app/overview/engineer-overview.spec.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Produces: `EngineerOverview({ canViewFinance }: { canViewFinance: boolean })`. The Finance menu in `shell.tsx` already shows only for `finance_request.view`, so it needs nothing.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/overview/engineer-overview.spec.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const listWorkOrders = vi.fn();
const getMyProfile = vi.fn();
vi.mock('../lib/work-order-api', () => ({ listWorkOrders }));
vi.mock('../lib/user-api', () => ({ getMyProfile }));
vi.mock('../shell', () => ({
  Sidebar: () => null, TopActions: () => null, StatePage: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const { EngineerOverview } = await import('./engineer-overview');

beforeEach(() => {
  listWorkOrders.mockReset().mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
  getMyProfile.mockReset().mockResolvedValue({ state: 'ready', data: { fullName: 'Sita Rai' } });
});

const render = async (canViewFinance: boolean) => renderToStaticMarkup(await EngineerOverview({ canViewFinance }));

describe('EngineerOverview', () => {
  it('links to finance for an engineer who may use it', async () => {
    const out = await render(true);
    expect(out).toContain('Finance requests');
    expect(out).toContain('href="/finance"');
  });

  it('shows no finance link for an engineer whose company handles their money', async () => {
    const out = await render(false);
    expect(out).not.toContain('Finance requests');
    expect(out).not.toContain('href="/finance"');
    expect(out).toContain('Your work');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `(cd apps/web && pnpm exec vitest run app/overview/engineer-overview.spec.tsx)`
Expected: FAIL on the second test (the link is always rendered).

- [ ] **Step 3: Implement**

In `apps/web/app/overview/engineer-overview.tsx`, change the signature to

```tsx
export async function EngineerOverview({ canViewFinance }: { canViewFinance: boolean }) {
```

and replace

```tsx
            <div className="ov-head-actions">
              <a className="secondary-button" href="/finance">Finance requests</a>
            </div>
```

with

```tsx
            {canViewFinance ? (
              <div className="ov-head-actions">
                <a className="secondary-button" href="/finance">Finance requests</a>
              </div>
            ) : null}
```

In `apps/web/app/page.tsx`, change the import `import { getCurrentUser } from './lib/iam-api';` to

```tsx
import { getCurrentUser, hasPermission } from './lib/iam-api';
```

and replace `case 'engineer': return <EngineerOverview />;` with

```tsx
    case 'engineer': return <EngineerOverview canViewFinance={viewer.state === 'ready' && hasPermission(viewer.data, 'finance_request.view')} />;
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `(cd apps/web && pnpm exec vitest run app/overview) && pnpm --filter web typecheck`
Expected: PASS, typecheck clean (same note about the unrelated finance edits as in Task 4).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/overview/engineer-overview.tsx apps/web/app/overview/engineer-overview.spec.tsx apps/web/app/page.tsx
git commit -m "feat(web): an engineer without finance sees no finance button on their home"
```

---

### Task 6: Hide the Finance tab on mobile (`apps/mobile`)

**Files:**
- Modify: `apps/mobile/lib/shared/layout/floating_nav_bar.dart`
- Modify: `apps/mobile/lib/shared/layout/main_scaffold.dart`
- Modify: `apps/mobile/lib/main.dart`
- Modify: `apps/mobile/lib/features/guide/presentation/app_guide_modal.dart`
- Modify: `apps/mobile/test/shared/main_scaffold_test.dart`
- Create: `apps/mobile/test/shared/signed_in_home_test.dart`

**Interfaces:**
- Produces: `MainScaffold({pages, hiddenTabs = const {}})`; `const int financeTabIndex = 2` (in `main_scaffold.dart`); `SignedInHome({user})` (in `main.dart`).

**Why the tab keeps its slot:** other code jumps to tabs by index (`task_list_screen.dart` goes to `3` for Profile; the guide uses `0`–`3`). Removing the Finance page would shift Profile to `2` and break both, so the page is replaced by an empty placeholder and only the button is hidden.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/test/shared/main_scaffold_test.dart` (inside `void main() { … }`, after the existing test):

```dart
  testWidgets('MainScaffold leaves out the button of a hidden tab and falls back from it',
      (WidgetTester tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(
          home: MainScaffold(
            hiddenTabs: {financeTabIndex},
            pages: [
              TaskListScreen(),
              ProjectListScreen(),
              SizedBox.shrink(),
              ProfileScreen(),
            ],
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byIcon(Icons.account_balance_wallet_outlined), findsNothing);
    expect(find.byIcon(Icons.assignment_outlined), findsOneWidget);
    expect(find.byIcon(Icons.business_outlined), findsOneWidget);
    expect(find.byIcon(Icons.person_outline_rounded), findsOneWidget);

    // A shortcut to the hidden tab lands on the first tab, not on a blank page.
    container.read(navigationIndexProvider.notifier).setIndex(financeTabIndex);
    await tester.pump();
    expect(find.text('Your task'), findsOneWidget);

    // Profile keeps its own index.
    await tester.tap(find.byIcon(Icons.person_outline_rounded));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Security'), findsOneWidget);
  });
```

Create `apps/mobile/test/shared/signed_in_home_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/domain/models/auth_user.dart';
import 'package:mobile/main.dart';

Future<void> pumpHome(WidgetTester tester, AuthUser user) async {
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp(home: SignedInHome(user: user))),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  const inHouse = AuthUser(
    id: 'u-1', email: 'in@house', permissions: ['task.view', 'finance_request.view'],
  );
  const vendor = AuthUser(id: 'u-2', email: 'ven@dor', permissions: ['task.view']);

  testWidgets('shows the Finance tab to a user who may use finance', (tester) async {
    await pumpHome(tester, inHouse);
    expect(find.byIcon(Icons.account_balance_wallet_outlined), findsOneWidget);
  });

  testWidgets('hides the Finance tab from a user whose finance is handled elsewhere', (tester) async {
    await pumpHome(tester, vendor);
    expect(find.byIcon(Icons.account_balance_wallet_outlined), findsNothing);
    expect(find.byIcon(Icons.assignment_outlined), findsOneWidget);

    // Profile is still reachable at its own index.
    await tester.tap(find.byIcon(Icons.person_outline_rounded));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Security'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `(cd apps/mobile && flutter test test/shared)`
Expected: FAIL to compile: `Undefined name 'financeTabIndex'`, `No named parameter with the name 'hiddenTabs'`, `Undefined class 'SignedInHome'`.

- [ ] **Step 3: Implement the nav bar**

In `apps/mobile/lib/shared/layout/floating_nav_bar.dart`:

Constructor and field:

```dart
  const FloatingNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    this.onQuickAction,
    this.hiddenTabs = const {},
  });

  final int currentIndex;
  final ValueChanged<int> onTap;
  final VoidCallback? onQuickAction;

  /// Indexes whose button is not offered. The page stays in place so every
  /// other index keeps its meaning.
  final Set<int> hiddenTabs;
```

Replace the four `_buildNavItem(...)` calls in the `Row` with:

```dart
        children: [
          if (!hiddenTabs.contains(0))
            _buildNavItem(
              index: 0,
              icon: Icons.assignment_outlined,
              selectedIcon: Icons.assignment_rounded,
              label: 'Tasks',
            ),
          if (!hiddenTabs.contains(1))
            _buildNavItem(
              index: 1,
              icon: Icons.business_outlined,
              selectedIcon: Icons.business_rounded,
              label: 'Projects',
            ),
          if (!hiddenTabs.contains(2))
            _buildNavItem(
              index: 2,
              icon: Icons.account_balance_wallet_outlined,
              selectedIcon: Icons.account_balance_wallet_rounded,
              label: 'Finance',
            ),
          if (!hiddenTabs.contains(3))
            _buildNavItem(
              index: 3,
              icon: Icons.person_outline_rounded,
              selectedIcon: Icons.person_rounded,
              label: 'Profile',
            ),
        ],
```

- [ ] **Step 4: Implement the scaffold**

In `apps/mobile/lib/shared/layout/main_scaffold.dart`:

After `navigationIndexProvider`, add:

```dart

/// The Finance tab's slot in [MainScaffold.pages]. A user whose finance is
/// handled elsewhere keeps the slot, which keeps every other tab's index valid
/// (the task list jumps to Profile by index), but not the button.
const int financeTabIndex = 2;
```

In `MainScaffold`:

```dart
class MainScaffold extends ConsumerStatefulWidget {
  const MainScaffold({
    super.key,
    required this.pages,
    this.hiddenTabs = const {},
  });

  final List<Widget> pages;

  /// Tabs whose page stays in place but whose button is not offered.
  final Set<int> hiddenTabs;
```

In `build`, replace

```dart
    final pages = widget.pages;
    final currentIndex = ref.watch(navigationIndexProvider);
```

with

```dart
    final pages = widget.pages;
    final requested = ref.watch(navigationIndexProvider);
    // A shortcut to a tab this user does not have (a guide button) lands on the
    // first tab instead of a blank page.
    final currentIndex = widget.hiddenTabs.contains(requested) ? 0 : requested;
```

and pass the set to the bar:

```dart
              child: FloatingNavBar(
                currentIndex: currentIndex,
                hiddenTabs: widget.hiddenTabs,
```

- [ ] **Step 5: Implement `SignedInHome`**

In `apps/mobile/lib/main.dart`, add the import `import 'features/auth/domain/models/auth_user.dart';` with the other `features/auth` imports, replace

```dart
      home = const MainScaffold(
        pages: [
          TaskListScreen(),
          ProjectListScreen(),
          FinanceScreen(),
          ProfileScreen(),
        ],
      );
```

with

```dart
      home = SignedInHome(user: user);
```

and add at the end of the file:

```dart

/// The signed-in tabs. Some field engineers are vendor staff whose own company
/// pays their advances and settles their expenses; their token carries no
/// finance permission, so the Finance button goes and its page is an empty
/// placeholder that makes no call finance would refuse. The slot stays, which
/// keeps every other tab's index valid.
class SignedInHome extends StatelessWidget {
  const SignedInHome({super.key, required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    final showsFinance = user.can('finance_request.view');
    return MainScaffold(
      hiddenTabs: showsFinance ? const <int>{} : const {financeTabIndex},
      pages: [
        const TaskListScreen(),
        const ProjectListScreen(),
        if (showsFinance) const FinanceScreen() else const SizedBox.shrink(),
        const ProfileScreen(),
      ],
    );
  }
}
```

- [ ] **Step 6: Drop the Finance entry from the guide for users without finance**

In `apps/mobile/lib/features/guide/presentation/app_guide_modal.dart`, add the import `import '../../auth/providers/auth_provider.dart';` after the `main_scaffold.dart` import, and in `_buildComponentsView` replace

```dart
    final filtered = _kComponentsCatalog.where((c) {
```

with

```dart
    // The Finance entry describes a tab this user may not have.
    final mayUseFinance = ref.watch(authStateProvider).value?.can('finance_request.view') ?? false;
    final catalog = _kComponentsCatalog.where((c) => c.id != 'finance' || mayUseFinance).toList();
    final filtered = catalog.where((c) {
```

and replace `'Showing ${filtered.length} of ${_kComponentsCatalog.length} mobile components',` with

```dart
              'Showing ${filtered.length} of ${catalog.length} mobile components',
```

(keep the surrounding indentation as it is in the file).

- [ ] **Step 7: Run the tests and the analyzer**

Run: `(cd apps/mobile && flutter test test/shared test/features/auth && flutter analyze lib/main.dart lib/shared lib/features/guide)`
Expected: all tests PASS (`main_scaffold_test` has 2, `signed_in_home_test` has 2, the auth tests that reach `MainScaffold` still pass), and `No issues found!`.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/lib/shared/layout/floating_nav_bar.dart apps/mobile/lib/shared/layout/main_scaffold.dart \
  apps/mobile/lib/main.dart apps/mobile/lib/features/guide/presentation/app_guide_modal.dart \
  apps/mobile/test/shared/main_scaffold_test.dart apps/mobile/test/shared/signed_in_home_test.dart
git commit -m "feat(mobile): no Finance tab for an engineer whose company handles their money"
```

---

### Task 7: End to end, spec wording, full run

**Files:**
- Create: `e2e/finance-optional.e2e.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-10-field-engineer-optional-finance-design.md`

- [ ] **Step 1: Write the end-to-end test**

Create `e2e/finance-optional.e2e.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, api, waitForReady } from './helpers/stack.js';

const TEMP = 'Temp#Pass1234';
const FINAL = 'Final#Pass1234';

let admin: string;
const created: string[] = [];

async function login(email: string, password: string): Promise<string> {
  const res = await api<{ accessToken: string }>('/api/v1/auth/login', { method: 'POST', body: { email, password } });
  expect(res.status, `${email} login`).toBe(201);
  return res.body.accessToken;
}

/**
 * Creates a field engineer as an administrator would, then signs them in past
 * the forced password change: a new account's token carries no permissions at
 * all until its holder replaces the temporary password.
 */
async function engineer(label: string, financeEnabled?: boolean): Promise<{ token: string; id: string }> {
  const email = `e2e.${label}.${Date.now()}@ipms.local`;
  const res = await api<{ id: string; financeEnabled: boolean }>('/api/v1/users', {
    method: 'POST', token: admin,
    body: {
      email, fullName: `E2E ${label}`, password: TEMP, roleCodes: ['FIELD_ENGINEER'],
      ...(financeEnabled === undefined ? {} : { financeEnabled }),
    },
  });
  expect(res.status).toBe(201);
  created.push(res.body.id);
  const first = await login(email, TEMP);
  const changed = await api('/api/v1/auth/change-password', {
    method: 'POST', token: first, body: { currentPassword: TEMP, newPassword: FINAL },
  });
  expect(changed.status).toBe(201);
  return { token: await login(email, FINAL), id: res.body.id };
}

beforeAll(async () => {
  await waitForReady();
  admin = await login('admin@ipms.local', DEMO_PASSWORD);
}, 120_000);

afterAll(async () => {
  for (const id of created) await api(`/api/v1/users/${id}`, { method: 'DELETE', token: admin });
});

describe('finance for a field engineer', () => {
  it('is on by default: the token carries finance and the finance API answers', async () => {
    const { token } = await engineer('inhouse');
    const me = await api<{ permissions: string[] }>('/api/v1/auth/me', { token });
    expect(me.body.permissions).toContain('finance_request.create');
    expect((await api('/api/v1/finance/requests', { token })).status).toBe(200);
  });

  it('can be off: the token carries no finance permission and the finance API refuses', async () => {
    const { token } = await engineer('vendor', false);
    const me = await api<{ permissions: string[] }>('/api/v1/auth/me', { token });
    expect(me.body.permissions.filter((p) => p.startsWith('finance_'))).toEqual([]);
    expect(me.body.permissions).toContain('task.view');
    expect((await api('/api/v1/finance/requests', { token })).status).toBe(403);
    const raised = await api('/api/v1/finance/requests', {
      method: 'POST', token, body: { kind: 'ADVANCE', projectId: '00000000-0000-4000-8000-000000000000', categoryId: '00000000-0000-4000-8000-000000000000', purpose: 'E2E', amount: '100' },
    });
    expect(raised.status).toBe(403);
  });

  it('shows the choice on the user the API returns', async () => {
    const { id } = await engineer('flag', false);
    const read = await api<{ financeEnabled: boolean }>(`/api/v1/users/${id}`, { token: admin });
    expect(read.status).toBe(200);
    expect(read.body.financeEnabled).toBe(false);
  });

  it('is refused for any role but a field engineer', async () => {
    const res = await api('/api/v1/users', {
      method: 'POST', token: admin,
      body: { email: `e2e.qc.${Date.now()}@ipms.local`, fullName: 'E2E QC', password: TEMP, roleCodes: ['QC_MANAGER'], financeEnabled: false },
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Reword spec §7 to match what was built**

In `docs/superpowers/specs/2026-10-10-field-engineer-optional-finance-design.md`, replace the whole body of section 7 (the paragraph under `## 7. Mobile (`apps/mobile`)`) with:

```
The Finance button leaves the nav bar when the signed-in user lacks `finance_request.view`, and the page behind it becomes an empty placeholder, so the finance screen makes no call that would be refused. The tab keeps its slot, because other code jumps to tabs by index (the task list goes to Profile at `3`, the guide uses `0`–`3`) and removing the slot would shift them. A jump to a hidden tab lands on Tasks. The guide's component list drops its Finance entry.
```

- [ ] **Step 3: Full unit and type run**

Run:

```bash
(cd libs/authz && pnpm exec vitest run) && (cd libs/contracts && pnpm exec vitest run) && pnpm --filter iam typecheck && pnpm --filter web typecheck
(cd apps/iam && pnpm exec vitest run)
(cd apps/web && pnpm exec vitest run)
(cd apps/mobile && flutter test && flutter analyze)
```

Expected: every suite passes. The IAM run includes the Testcontainers integration specs, so Docker must be running. Any failure in `apps/web/app/finance/` tests comes from the unrelated uncommitted edits already in the tree; confirm that by reading the failing path, and report it rather than fixing it.

- [ ] **Step 4: Run the end-to-end test against a rebuilt stack**

The stack runs the old IAM image. Rebuild and restart the two IAM services, then run the spec:

```bash
docker compose -f docker/docker-compose.yml up -d --build iam-migrate iam
(cd e2e && pnpm exec vitest run finance-optional.e2e.spec.ts)
```

Expected: 4 tests PASS. If the stack is not running at all, start it as the README describes, then run the spec. If Docker or the stack is unavailable in the executing environment, say so plainly in the report rather than marking this step done.

- [ ] **Step 5: Commit**

```bash
git add e2e/finance-optional.e2e.spec.ts docs/superpowers/specs/2026-10-10-field-engineer-optional-finance-design.md
git commit -m "test(e2e): a field engineer with finance off holds no finance permission"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §2/§3 a switch chosen at creation only | 2 (create accepts, update strips, contract test), 4 (create form only) |
| §4 column, default true, response carries it | 2 |
| §4 only a Field Engineer may turn it off, 400 | 2 (service + tests) |
| §4 `setRoles` reset | 2 |
| §4 PM/admin may set it; audit records it; no token revocation | 2 (no revoke added; audit test) |
| §4 `financeOptOutOverrides()` from the catalog | 1 |
| §4 applied in the token and the effective read / simulate / holders, reason text | 3 |
| §5 finance service unchanged | no task needed |
| §6 checkbox, access summary, list tag, engineer home, menu unchanged, edit form unchanged | 4, 5 (menu and edit form: no change by design) |
| §7 mobile tab | 6 (spec wording corrected in 7: the tab keeps its slot) |
| §8 edge cases | covered by the reset (2) and the no-edit rule (4) |
| §9 testing | each task's tests; e2e in 7 |
| §10 rollout: one migration, default true | 2 (migration + integration test) |

**Placeholder scan:** no TBD/TODO; every code step shows code; every run step has a command and expected result.

**Type consistency:** `financeOptOutOverrides`/`FINANCE_OPT_OUT_REASON` (Task 1) are imported by those names in Task 3. `financeEnabled` is `boolean` on `UserResponse` (Task 2) and on web `User` (Task 4), optional on `CreateUserDto` and on the IAM `claimsFor`/`LoadedUser` shapes (Tasks 2–3). The form marker `financeOffered` and checkbox `financeEnabled` are written in the form (Task 4 step 8) and read in the action (Task 4 step 7) with the same names. `financeTabIndex` is defined in `main_scaffold.dart` (Task 6 step 4) and used in `main.dart` (step 5) and the test (step 1). `canViewFinance` is the same prop name in the component, its test and `page.tsx` (Task 5).
