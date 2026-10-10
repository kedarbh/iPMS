import { getAdvance, getRequest, listCategories } from '../../../../lib/finance-api';
import { getCurrentUser } from '../../../../lib/iam-api';
import { Sidebar, StatePage, TopActions } from '../../../../shell';
import { RequestForm, type AdvanceContext } from '../../../request-form';

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') return <StatePage title="Sign in to edit a request"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  if (viewer.state !== 'ready') return <StatePage title="Editing is not available"><p>Your account could not be loaded.</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;

  const [found, categories] = await Promise.all([getRequest(id), listCategories()]);
  if (found.state === 'unauthenticated') return <StatePage title="Sign in to edit a request"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  if (found.state !== 'ready') {
    return <StatePage title="Request not found"><p>This request does not exist or you cannot see it.</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }
  const request = found.data;
  const back = <a className="primary-button" href={`/finance/requests/${request.id}`}>Back to the request</a>;
  if (request.requesterId !== viewer.data.id) {
    return <StatePage title="This is not your request"><p>Only the person who raised a request can edit it.</p>{back}</StatePage>;
  }
  if (request.status !== 'DRAFT' && request.status !== 'RETURNED') {
    return <StatePage title="This request can no longer be edited"><p>Only a draft or a returned request can be changed.</p>{back}</StatePage>;
  }
  if (categories.state !== 'ready') {
    return <StatePage title="The form is not available"><p>Categories could not be loaded.</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }

  let advance: AdvanceContext | undefined;
  if (request.kind === 'SETTLEMENT' && request.advanceId) {
    const view = await getAdvance(request.advanceId);
    if (view.state === 'ready' && view.data.balance) {
      advance = { id: view.data.advance.id, number: view.data.advance.number, projectName: view.data.advance.projectName, outstanding: view.data.balance.outstanding };
    }
  }

  return (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><a href={`/finance/requests/${request.id}`}>{request.number}</a><b>/</b><strong>Edit</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar"><div><p className="eyebrow">FINANCE</p><h1>Edit {request.number}</h1></div></div>
          <section className="panel">
            <RequestForm
              kind={request.kind}
              projects={[]}
              categories={categories.data.filter((c) => !c.disabledAt || c.id === request.categoryId)}
              {...(advance ? { advance } : {})}
              initial={{
                id: request.id,
                categoryId: request.categoryId,
                purpose: request.purpose,
                remarks: request.remarks ?? '',
                requestedAmount: request.requestedAmount,
                invoices: request.invoices.map(({ vendor, invoiceNumber, invoiceDate, amount, vat, supplierTaxNo, mediaId }) => ({
                  vendor, invoiceDate, amount,
                  ...(invoiceNumber ? { invoiceNumber } : {}),
                  ...(vat ? { vat: true } : {}),
                  ...(supplierTaxNo ? { supplierTaxNo } : {}),
                  ...(mediaId ? { mediaId } : {}),
                })),
              }}
            />
          </section>
        </div>
      </section>
    </main>
  );
}
