'use client';
import { useState, useTransition } from 'react';
import { useActionStateWithToast } from '../components/toast';
import { useFormStatus } from 'react-dom';
import {
  createUserAction, deactivateUserAction, reactivateUserAction,
  renewProjectAccessAction, resetUserPasswordAction, setProjectAccessAction, setUserRolesAction, updateUserAction,
} from './actions';
import { PasswordInput } from '../components/forms';
import { EMPTY, type FormState } from '../lib/form-state';
import type { Permission, Role, User, UserRoleSummary } from '../lib/user-api';
import { summarizeAccess, type RolePermissions } from './role-access';

/** Disables itself while the action runs, so a slow API cannot be double-submitted. */
function SubmitButton({ children, className = 'primary-button' }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending}>{pending ? 'Working…' : children}</button>;
}

function FormError({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <p className="form-error" role="alert">
      {state.error}
      {state.correlationId ? <> <span className="subtle">({state.correlationId})</span></> : null}
    </p>
  );
}

/**
 * What the chosen role allows, grouped by module. It sits between the role
 * choice and the save button so the effect of a change is visible before it is
 * made.
 *
 * Presentation only, and roles only: iam decides, and a user's real access also
 * depends on per-user overrides and project scope.
 */
function RoleAccessSummary({ selected, roles, catalog, financeEnabled = true }: {
  selected: string | undefined; roles: RolePermissions[]; catalog: Permission[]; financeEnabled?: boolean;
}) {
  const { total, groups } = summarizeAccess(selected === undefined ? [] : [selected], roles, catalog, { financeEnabled });
  return (
    <section className="role-access" aria-live="polite">
      <div className="role-access-heading">
        <strong>What this role allows</strong>
        {total > 0
          ? <span className="subtle">{total} permission{total === 1 ? '' : 's'} across {groups.length} area{groups.length === 1 ? '' : 's'}</span>
          : null}
      </div>
      {total === 0 ? (
        <p className="subtle">{selected === undefined ? 'Choose a role to see what it allows.' : 'This role grants no permissions.'}</p>
      ) : (
        <dl className="role-access-list">
          {groups.map((group) => (
            <div key={group.module}>
              <dt>{group.label}</dt>
              <dd className="chips">
                {group.permissions.map((permission) => (
                  <span key={permission.code} className="chip" title={permission.code}>{permission.description}</span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/**
 * The role choice. A user holds exactly one role, so this is a radio group and
 * a role is required; iam refuses more than one as well.
 *
 * `grantable` is the set this viewer may confer, already filtered by the page
 * against the same table the service enforces — so this form cannot offer a
 * grant that would be refused on submit.
 *
 * `locked` is a role the target already holds that this viewer may *not*
 * confer. It renders selected and disabled, with no `name`, so it is visible
 * but unsubmittable.
 *
 * `roles` is every role the page could read, locked ones included, so the
 * summary can describe a locked role too.
 */
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
    <>
      <fieldset className="checkbox-grid">
        <legend>Role</legend>
        {grantable.map((role) => (
          <label key={role.code} className="checkbox">
            <input
              type="radio" name="roleCodes" value={role.code} required
              defaultChecked={held === role.code}
              onChange={() => setSelected(role.code)}
            />
            {role.name}
          </label>
        ))}
        {locked.map((role) => (
          <label key={role.code} className="checkbox">
            <input type="radio" checked disabled readOnly />
            {role.name} <span className="subtle">(only an administrator can change this)</span>
          </label>
        ))}
        {grantable.length === 0 && locked.length === 0
          ? <p className="subtle">You cannot assign any roles.</p>
          : null}
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
  );
}

export function CreateUserForm({ grantable, catalog }: { grantable: Role[]; catalog: Permission[] }) {
  const [state, action] = useActionStateWithToast(createUserAction, EMPTY, 'User created');
  return (
    <form action={action} className="panel-form">
      <div className="form-grid">
        <label className="field">Full name<input name="fullName" required maxLength={200} /></label>
        <label className="field">
          Email
          <input name="email" type="email" required maxLength={255} />
          <span className="hint">The user signs in with this address.</span>
        </label>
        <label className="field">Employee code<input name="employeeCode" maxLength={50} /></label>
        <label className="field">
          Temporary password
          <PasswordInput name="password" required minLength={8} maxLength={200} autoComplete="new-password" />
          <span className="hint">At least 8 characters, with an uppercase letter, a lowercase letter, a digit and a symbol.</span>
        </label>
        <label className="field">
          Confirm password
          <PasswordInput name="confirmPassword" required minLength={8} maxLength={200} autoComplete="new-password" />
        </label>
      </div>
      <RolePicker grantable={grantable} held={undefined} locked={[]} roles={grantable} catalog={catalog} offerFinanceChoice />
      <FormError state={state} />
      <p className="form-note">
        The new user must change this password the first time they sign in. Until they do, their
        account can do nothing else.
      </p>
      <SubmitButton>Create user</SubmitButton>
    </form>
  );
}

export function EditUserForm({ user }: { user: User }) {
  const [state, action] = useActionStateWithToast(updateUserAction, EMPTY, 'Profile saved');
  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="userId" value={user.id} />
      <div className="form-grid">
        <label className="field">Full name<input name="fullName" required defaultValue={user.fullName} maxLength={200} /></label>
        <label className="field">Email<input name="email" type="email" required defaultValue={user.email} maxLength={255} /></label>
        <label className="field">
          Employee code
          <input name="employeeCode" defaultValue={user.employeeCode ?? ''} maxLength={50} />
          <span className="hint">Leave empty to remove it.</span>
        </label>
      </div>
      <FormError state={state} />
      <p className="form-note">
        The email is what this user signs in with. Changing it changes their sign-in address.
      </p>
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}

export function RoleAssignmentForm({ user, grantable, roles, catalog }: {
  user: User; grantable: Role[]; roles: Role[]; catalog: Permission[];
}) {
  const [state, action] = useActionStateWithToast(setUserRolesAction, EMPTY, 'Role updated');
  const grantableCodes = new Set(grantable.map((role) => role.code));
  const locked = user.roles.filter((role) => !grantableCodes.has(role.code));
  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="userId" value={user.id} />
      <RolePicker
        grantable={grantable} held={user.roles[0]?.code} locked={locked}
        roles={roles} catalog={catalog}
      />
      <FormError state={state} />
      <p className="form-note">Changing the role signs this user out of every device.</p>
      <SubmitButton>Save role</SubmitButton>
    </form>
  );
}

export interface ProjectOption { id: string; code: string; name: string }

/**
 * Which projects this user works on. Ticking one makes them selectable as the
 * responsible person for work orders in that project.
 *
 * Each rendered project is also sent as `offered`, so the action only touches
 * projects this form showed — see `setProjectAccessAction`.
 */
/** When a grant lapses, worked out on the server so the page and its hydration agree. */
export interface AccessExpiry { date: string; daysLeft: number }

/** Inside this many days the expiry is flagged and Renew is the main action. */
const RENEW_SOON_DAYS = 30;

export function ProjectAccessForm({ user, projects, granted, expiries }: {
  user: User; projects: ProjectOption[]; granted: string[]; expiries: Record<string, AccessExpiry>;
}) {
  const [state, action] = useActionStateWithToast(setProjectAccessAction, EMPTY, 'Project access saved');
  const [renewState, renew, renewing] = useActionStateWithToast(renewProjectAccessAction, EMPTY, 'Access renewed for another year');
  const [, startRenew] = useTransition();
  // Called directly rather than through a submit button's `formAction`: React
  // overwrites that button's `name` on the server, so the project id would not arrive.
  const renewProject = (projectId: string): void => {
    const data = new FormData();
    data.set('userId', user.id);
    data.set('renewProjectId', projectId);
    startRenew(() => renew(data));
  };
  const [selected, setSelected] = useState<Set<string>>(() => new Set(granted));
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = (project: ProjectOption): boolean =>
    needle === '' || project.name.toLowerCase().includes(needle) || project.code.toLowerCase().includes(needle);
  const toggle = (id: string, on: boolean): void =>
    setSelected((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
  const visible = projects.filter(matches);
  const setVisible = (on: boolean): void =>
    setSelected((prev) => { const next = new Set(prev); for (const p of visible) { if (on) next.add(p.id); else next.delete(p.id); } return next; });

  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="userId" value={user.id} />
      <div className="access-bar">
        <input
          type="search" className="access-search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter projects" aria-label="Filter projects"
        />
        <span className="access-count" aria-live="polite">{selected.size} of {projects.length} selected</span>
        <button type="button" className="link-button" onClick={() => setVisible(true)}>Select all</button>
        <button type="button" className="link-button" onClick={() => setVisible(false)}>Clear</button>
      </div>
      <fieldset className="access-list">
        <legend className="visually-hidden">Projects</legend>
        {projects.map((project) => (
          <label key={project.id} className={selected.has(project.id) ? 'access-item on' : 'access-item'} hidden={!matches(project)}>
            <input type="hidden" name="offered" value={project.id} />
            <input
              type="checkbox" name="projectIds" value={project.id}
              checked={selected.has(project.id)} onChange={(e) => toggle(project.id, e.target.checked)}
            />
            <span className="access-box" aria-hidden="true" />
            <span className="access-name">{project.name}</span>
            {expiries[project.id] ? <AccessExpiryNote expiry={expiries[project.id]!} /> : null}
            <code className="access-code">{project.code}</code>
            {expiries[project.id] ? (
              <button
                type="button" disabled={renewing}
                className={expiries[project.id]!.daysLeft <= RENEW_SOON_DAYS ? 'access-renew soon' : 'access-renew'}
                onClick={() => renewProject(project.id)}
              >
                {renewing ? 'Renewing…' : 'Renew'}
              </button>
            ) : null}
          </label>
        ))}
        {projects.length === 0 ? <p className="subtle">There are no projects to grant yet.</p> : null}
        {projects.length > 0 && visible.length === 0 ? <p className="subtle">No projects match “{query}”.</p> : null}
      </fieldset>
      <FormError state={state} />
      <FormError state={renewState} />
      {Object.keys(expiries).length > 0 ? (
        <p className="form-note">
          This user’s project access lasts a year. Renew it before it lapses, or it is removed automatically.
        </p>
      ) : null}
      <p className="form-note">
        Removing a project also removes any site access this user holds in it.
      </p>
      <SubmitButton>Save project access</SubmitButton>
    </form>
  );
}

function AccessExpiryNote({ expiry }: { expiry: AccessExpiry }) {
  const soon = expiry.daysLeft <= RENEW_SOON_DAYS;
  const text = expiry.daysLeft <= 0 ? 'Expires today'
    : soon ? `Expires in ${expiry.daysLeft} day${expiry.daysLeft === 1 ? '' : 's'}`
    : `Until ${expiry.date}`;
  return <span className={soon ? 'access-expiry soon' : 'access-expiry'} title={`Access ends ${expiry.date}`}>{text}</span>;
}

/**
 * Deactivation and reactivation share a shape but not a meaning, so they are
 * one component with two branches rather than two near-identical ones. Kept
 * apart from the profile form: correcting a misspelled name must not be able
 * to revoke someone's sessions.
 */
export function AccountStatusForm({ user }: { user: User }) {
  const [state, action] = useActionStateWithToast(
    user.isActive ? deactivateUserAction : reactivateUserAction,
    EMPTY,
    user.isActive ? 'Account deactivated' : 'Account reactivated',
  );
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (user.isActive && !window.confirm(`Deactivate ${user.fullName}? They will be signed out immediately.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={user.id} />
      <FormError state={state} />
      {user.isActive
        ? <SubmitButton className="danger-button">Deactivate account</SubmitButton>
        : <SubmitButton className="ghost-button">Reactivate account</SubmitButton>}
    </form>
  );
}

export function ResetPasswordForm({ user }: { user: User }) {
  const [state, action] = useActionStateWithToast(resetUserPasswordAction, EMPTY, 'Password reset');
  return (
    <form action={action} className="panel-form">
      <input type="hidden" name="userId" value={user.id} />
      <div className="form-grid">
        <label className="field">
          New password
          <PasswordInput name="password" required minLength={8} maxLength={200} autoComplete="new-password" />
          <span className="hint">At least 8 characters, with an uppercase letter, a lowercase letter, a digit and a symbol.</span>
        </label>
        <label className="field">
          Confirm password
          <PasswordInput name="confirmPassword" required minLength={8} maxLength={200} autoComplete="new-password" />
        </label>
      </div>
      <FormError state={state} />
      <p className="form-note">
        This signs the user out everywhere, and they must change the password again at their next sign-in.
      </p>
      <SubmitButton className="danger-button">Reset password</SubmitButton>
    </form>
  );
}
