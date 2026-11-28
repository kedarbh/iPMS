import { getAdvance, listCategories } from '../../lib/finance-api';
import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { listProjects } from '../../lib/project-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { RequestForm } from '../request-form';

interface Search { kind?: string; advanceId?: string }
const KINDS = ['ADVANCE', 'REIMBURSEMENT', 'SETTLEMENT'] as const;
type Kind = (typeof KINDS)[number];
const asKind = (value: string | undefined): Kind | undefined => KINDS.find((kind) => kind === value);

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { kind: rawKind, advanceId } = await searchParams;
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') return <StatePage title="Sign in to raise a request"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  const back = <a className="primary-button" href="/finance">Back to finance</a>;
  if (viewer.state !== 'ready') {
    return <StatePage title="Finance is not available"><p>Your account could not be checked. Try again shortly.</p>{back}</StatePage>;
  }
  if (!hasPermission(viewer.data, 'finance_request.create')) {
    return <StatePage title="You cannot raise requests"><p>Only field engineers and project managers raise advances and reimbursements.</p>{back}</StatePage>;
  }

  const kind = asKind(rawKind);
  const [projects, categories, advance] = await Promise.all([
    listProjects(), listCategories(), kind === 'SETTLEMENT' && advanceId ? getAdvance(advanceId) : Promise.resolve(null),
  ]);
  const shell = (content: React.ReactNode, title: string) => (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><strong>New request</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar"><div><p className="eyebrow">FINANCE</p><h1>{title}</h1></div></div>
          <section className="panel">{content}</section>
        </div>
      </section>
    </main>
  );

  if (!kind) {
    return shell(
      <div className="finance-grid">
        <a className="panel" href="/finance/new?kind=ADVANCE"><h2>Advance</h2><p className="subtle">Ask for money before you spend it.</p></a>
        <a className="panel" href="/finance/new?kind=REIMBURSEMENT"><h2>Reimbursement</h2><p className="subtle">Claim back money you already spent, with the invoices.</p></a>
      </div>,
      'What do you need?',
    );
  }
  if (categories.state !== 'ready' || (kind !== 'SETTLEMENT' && projects.state !== 'ready')) {
    return <StatePage title="The form is not available"><p>{categories.state === 'ready' ? 'Projects could not be loaded.' : 'Categories could not be loaded.'}</p>{back}</StatePage>;
  }
  if (kind === 'SETTLEMENT') {
    if (!advance || advance.state !== 'ready' || !advance.data.balance || advance.data.balance.status === 'CLOSED') {
      return <StatePage title="That advance cannot be settled"><p>Only a paid advance with money outstanding can be settled.</p>{back}</StatePage>;
    }
    const { advance: adv, balance } = advance.data;
    return shell(
      <RequestForm kind="SETTLEMENT" projects={[]} categories={categories.data.filter((c) => !c.disabledAt)}
        advance={{ id: adv.id, number: adv.number, projectId: adv.projectId, projectName: adv.projectName, outstanding: balance.outstanding }} />,
      'Settle an advance',
    );
  }
  return shell(
    <RequestForm kind={kind} projects={(projects.state === 'ready' ? projects.data : []).filter((p) => p.status !== 'CANCELLED').map((p) => ({ id: p.id, code: p.code, name: p.name }))}
      categories={categories.data.filter((c) => !c.disabledAt)} />,
    kind === 'ADVANCE' ? 'Request an advance' : 'Claim a reimbursement',
  );
}
