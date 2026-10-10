/**
 * The signed-in chrome. Every page that uses `.app-shell` must render the
 * sidebar: `.content` reserves its width unconditionally, so a page without one
 * is laid out against an empty gutter.
 */

import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { BrandMark } from './components/brand';
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from './components/sidebar-state';
import { NotificationCenter } from './components/notification-center';
import { SidebarToggle } from './components/sidebar-toggle';
import { TopSearch } from './components/top-search';
import { ProjectGuideTrigger } from './components/project-guide';
import { getCurrentUser, hasPermission, mayReadDocs } from './lib/iam-api';
import { getMyProfile } from './lib/user-api';
import { listWorkOrders } from './lib/work-order-api';
import { homeFor } from './overview/model';

function OverviewIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ProjectsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 7a2 2 0 0 1 2-2h4l2 2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function WorkOrdersIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m10 8 4 4-4 4" />
    </svg>
  );
}

function ChecklistsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function UsersIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function DocsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function AuditIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ProfileIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

type Section = 'overview' | 'projects' | 'checklists' | 'work-orders' | 'users' | 'docs' | 'profile' | 'audit' | 'finance' | 'finance-categories' | 'finance-reports';

function NavItem({
  section,
  active,
  href,
  icon,
  children,
  badge,
}: {
  section: Section;
  active: Section;
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  /** A count of things waiting on the viewer; omitted when there are none. */
  badge?: number;
}) {
  const current = section === active;
  const tooltipText = typeof children === 'string' ? children : '';
  return (
    <a
      className={`nav-item${current ? ' active' : ''}`}
      href={href}
      aria-current={current ? 'page' : undefined}
      data-tooltip={tooltipText}
    >
      <span className="icon" aria-hidden="true">{icon}</span>
      <span className="nav-label">{children}</span>
      {badge ? <span className="nav-badge" aria-label={`${badge} waiting`}>{badge}</span> : null}
    </a>
  );
}

/**
 * Asks who the viewer is rather than taking it as a prop, so every page's call
 * site stays `<Sidebar active="…" />` and no page has to thread an identity it
 * does not otherwise need.
 *
 * Hiding an item is UX, never a boundary: `/users` renders its own forbidden
 * state, and the gateway refuses the request underneath either way. When the
 * identity call fails the item is hidden — the fail-closed direction — and the
 * rest of the navigation still renders.
 */
export async function Sidebar({ active }: { active: Section }) {
  const [viewer, profile] = await Promise.all([getCurrentUser(), getMyProfile()]);
  const mayViewUsers = viewer.state === 'ready' && hasPermission(viewer.data, 'user.view');
  const mayViewTemplates = viewer.state === 'ready' && hasPermission(viewer.data, 'qc_template.view');
  const mayViewTasks = viewer.state === 'ready' && hasPermission(viewer.data, 'task.view');
  const mayViewAudit = viewer.state === 'ready' && hasPermission(viewer.data, 'audit.view');
  const mayViewFinance = viewer.state === 'ready' && hasPermission(viewer.data, 'finance_request.view');
  const mayManageCategories = viewer.state === 'ready' && hasPermission(viewer.data, 'finance_category.manage');
  const maySeeSpend = viewer.state === 'ready' && hasPermission(viewer.data, 'finance_request.view_all');
  const mayReadDocumentation = viewer.state === 'ready' && mayReadDocs(viewer.data);
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === SIDEBAR_COLLAPSED;
  const home = viewer.state === 'ready' ? homeFor(viewer.data.roles) : 'admin';
  const manager = home === 'manager';
  // QC and field staff share the manager's grouped menu; the cash-in-hand records are for everyone else.
  const staff = home === 'qc' || home === 'engineer';
  // Finance lives in the finance workspace, so its menu is only that and the docs.
  const financeHome = home === 'finance' && mayViewFinance;
  // A Director oversees projects and approves money: their overview, the projects, quality to read, and finance.
  const director = home === 'director';
  // A manager's or QC's home is a queue, so the menu says how long theirs is; so does a Director who is also a QC Manager.
  const reviews = manager || home === 'qc' || (director && viewer.state === 'ready' && viewer.data.roles.includes('QC_MANAGER'));
  const waiting = reviews && mayViewTasks ? await listWorkOrders({ status: 'REVIEWING', limit: 1 }) : null;
  const toReview = waiting?.state === 'ready' ? waiting.data.counts.REVIEWING : 0;
  const person = profile?.state === 'ready' ? profile.data : null;
  const name = person?.fullName ?? 'Account';
  const role = person?.roles[0]?.name ?? '';

  const qualityGroup = mayViewTasks || mayViewTemplates ? (
    <div className="nav-section" role="group" aria-labelledby="nav-quality">
      <p className="nav-section-label" id="nav-quality">Quality &amp; EHS</p>
      {mayViewTasks ? (
        <NavItem section="work-orders" active={active} href="/quality/work-orders" icon={<WorkOrdersIcon />} badge={toReview}>
          Work orders
        </NavItem>
      ) : null}
      {mayViewTemplates ? (
        <NavItem section="checklists" active={active} href="/quality/templates" icon={<ChecklistsIcon />}>
          Checklist library
        </NavItem>
      ) : null}
    </div>
  ) : null;

  const financeGroup = mayViewFinance ? (
    <div className="nav-section" role="group" aria-labelledby="nav-finance">
      <p className="nav-section-label" id="nav-finance">Finance</p>
      <NavItem section="finance" active={active} href="/finance" icon={<CashIcon />}>
        Requests
      </NavItem>
      {mayManageCategories ? (
        <NavItem section="finance-categories" active={active} href="/finance/categories" icon={<CashIcon />}>
          Categories
        </NavItem>
      ) : null}
      {maySeeSpend ? (
        <NavItem section="finance-reports" active={active} href="/finance/reports" icon={<CashIcon />}>
          Spend report
        </NavItem>
      ) : null}
    </div>
  ) : null;

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="sidebar-header">
        <a className="brand" href="/" aria-label="Axiom home">
          <img className="brand-full" src="/brand/axiom-logo-horizontal.svg" alt="Axiom" />
          <div className="brand-badge">
            <BrandMark size={22} />
          </div>
        </a>
        <SidebarToggle initiallyCollapsed={collapsed} />
      </div>

      <nav aria-label="Primary navigation">
        {financeHome ? financeGroup : (
          <>
            <NavItem section="overview" active={active} href="/" icon={<OverviewIcon />}>
              Overview
            </NavItem>
            <NavItem section="projects" active={active} href="/projects" icon={<ProjectsIcon />}>
              Projects
            </NavItem>
            {director || manager || staff ? (
              <>
                {qualityGroup}
                {financeGroup}
              </>
            ) : (
              <div className="nav-section" role="group" aria-labelledby="nav-records">
                <p className="nav-section-label" id="nav-records">Records</p>
                {mayViewTasks ? (
                  <NavItem section="work-orders" active={active} href="/quality/work-orders" icon={<WorkOrdersIcon />}>
                    Work orders
                  </NavItem>
                ) : null}
                {mayViewTemplates ? (
                  <NavItem section="checklists" active={active} href="/quality/templates" icon={<ChecklistsIcon />}>
                    Checklist library
                  </NavItem>
                ) : null}
                {mayViewAudit ? (
                  <NavItem section="audit" active={active} href="/#audit-log" icon={<AuditIcon />}>
                    Audit log
                  </NavItem>
                ) : null}
              </div>
            )}
            {!(manager || staff || director) ? financeGroup : null}
          </>
        )}

        {mayViewUsers ? (
          <div className="nav-section" role="group" aria-labelledby="nav-admin">
            <p className="nav-section-label" id="nav-admin">Admin</p>
            <NavItem section="users" active={active} href="/users" icon={<UsersIcon />}>
              Users
            </NavItem>
          </div>
        ) : null}
      </nav>

      <div className="sidebar-bottom">
        {mayReadDocumentation ? (
          <NavItem section="docs" active={active} href="/docs" icon={<DocsIcon />}>
            Documentation
          </NavItem>
        ) : null}
        <div className="sidebar-user">
          <a href="/profile" className="sidebar-user-link" aria-label="Account profile" data-tooltip={name}>
            <span className="sidebar-avatar" aria-hidden="true">{initialsOf(name)}</span>
            <span className="sidebar-user-meta">
              <b>{name}</b>
              {role ? <span>{role}</span> : null}
            </span>
          </a>
          <form action="/api/auth/logout" method="post" className="sidebar-logout-form">
            <button
              type="submit"
              className="footer-icon-btn logout"
              title="Sign out"
              aria-label="Sign out"
              data-tooltip="Sign out"
            >
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/** "Jane Doe" → "JD"; falls back to the first two letters of a single name. */
export function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1] ?? '' : '';
  const letters = last ? `${first.charAt(0)}${last.charAt(0)}` : first.slice(0, 2);
  return letters.toUpperCase() || '?';
}

/**
 * The right-hand end of the topbar. Houses the section search, any action
 * buttons passed in, and the interactive NotificationCenter bell and flyout panel.
 */
export function TopActions({ children }: { children?: React.ReactNode }) {
  return (
    <div className="top-actions">
      <Suspense fallback={null}><TopSearch /></Suspense>
      {children}
      <ProjectGuideTrigger />
      <NotificationCenter />
    </div>
  );
}

/** The signed-out / error surface, which stands on its own without the shell. */
export function StatePage({ eyebrow, title, children }: { eyebrow?: string; title: string; children: React.ReactNode }) {
  return (
    <main className="state-page">
      <section className="state-card">
        <a className="brand" href="/" aria-label="Axiom home"><BrandMark /></a>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}
