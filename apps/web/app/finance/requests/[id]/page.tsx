import { getAdvance, getRequest, type DuplicateHit } from '../../../lib/finance-api';
import { getCurrentUser } from '../../../lib/iam-api';
import { listUserDirectory } from '../../../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../../../shell';
import { ActionPanels } from './panels';
import {
  KIND_LABEL, STATUS_LABEL, STATUS_TONE, availableActions, describeEntry, formatMoney, personName, settlementStatus, waitingOn,
} from '../../model';

const WHEN = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const DUPLICATE_REASON: Record<DuplicateHit['reason'], (d: DuplicateHit) => string> = {
  SAME_NUMBER: (d) => `invoice ${d.invoiceNumber} from ${d.vendor} is on it too`,
  SAME_BILL: (d) => `a bill from ${d.vendor} with the same date and amount`,
  NUMBER_OTHER_YEAR: (d) => `invoice ${d.invoiceNumber} from ${d.vendor}, dated in another year (the supplier may have restarted numbering)`,
};
const MODE: Record<string, string> = { BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CHEQUE: 'Cheque', MOBILE_WALLET: 'Mobile wallet' };

export default async function FinanceRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [viewer, result, directory] = await Promise.all([getCurrentUser(), getRequest(id), listUserDirectory()]);
  if (result.state === 'unauthenticated' || viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to see this request"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (result.state !== 'ready' || viewer.state !== 'ready') {
    return <StatePage title="This request is not available"><p>It may not exist, or it belongs to someone you cannot see.</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }

  const request = result.data;
  const names = new Map(directory.state === 'ready' ? directory.data.map((p) => [p.id, p.fullName]) : []);
  const who = (userId: string) => personName(userId, names);
  const approvedEarlier = request.actions.filter((a) => a.revision === request.revision && a.action === 'APPROVED').map((a) => a.actorId);
  const actions = availableActions(request, viewer.data, approvedEarlier, request.balance);
  const advance = request.kind === 'SETTLEMENT' && request.advanceId ? await getAdvance(request.advanceId) : null;
  const waiting = waitingOn(request.status);
  const settle = settlementStatus(request.settlementDueOn, request.balance, new Date().toISOString().slice(0, 10));

  return (
    <main className="app-shell">
      <Sidebar active="finance" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><strong>{request.number}</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">{KIND_LABEL[request.kind].toUpperCase()}</p>
              <h1>{request.number} <span className={`finance-pill ${STATUS_TONE[request.status]}`}>{STATUS_LABEL[request.status]}</span></h1>
              <p className="subtle">{request.projectCode} — {request.projectName}{waiting ? ` · ${waiting}` : ''}</p>
            </div>
          </div>

          <ActionPanels request={request} actions={actions} />

          {(request.duplicates ?? []).length > 0 ? (
            <section className="panel" role="alert" style={{ borderLeft: '4px solid var(--danger, #b3261e)' }}>
              <h2>Possible duplicate bill</h2>
              <ul>
                {(request.duplicates ?? []).map((d) => (
                  <li key={`${d.requestId}-${d.reason}`}>
                    <a href={`/finance/requests/${d.requestId}`}>{d.number}</a> ({STATUS_LABEL[d.status]}) —{' '}
                    {DUPLICATE_REASON[d.reason](d)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="panel finance-facts">
            <dl>
              <dt>For</dt><dd>{request.purpose}</dd>
              <dt>Category</dt><dd>{request.category?.name ?? '—'}</dd>
              <dt>Requested by</dt><dd>{who(request.requesterId)}</dd>
              <dt>Requested</dt><dd>{formatMoney(request.requestedAmount)}</dd>
              <dt>Approved</dt><dd>{formatMoney(request.approvedAmount)}</dd>
              {request.kind === 'SETTLEMENT' ? <><dt>Applied to advance</dt><dd>{formatMoney(request.appliedAmount)}</dd></> : null}
              {request.advanceId ? <><dt>Advance</dt><dd><a href={`/finance/requests/${request.advanceId}`}>{advance?.state === 'ready' ? advance.data.advance.number : 'View advance'}</a></dd></> : null}
            </dl>
          </section>

          {request.balance ? (
            <section className="panel finance-facts">
              <h2>Advance balance</h2>
              <dl>
                <dt>Paid</dt><dd>{formatMoney(request.balance.paid)}</dd>
                <dt>Settled</dt><dd>{formatMoney(request.balance.applied)}</dd>
                <dt>Cash returned</dt><dd>{formatMoney(request.balance.cashReturned)}</dd>
                <dt>Outstanding</dt><dd><strong>{formatMoney(request.balance.outstanding)}</strong></dd>
                {settle ? <><dt>Settlement</dt><dd style={settle.overdue ? { color: 'var(--danger, #b3261e)', fontWeight: 600 } : undefined}>{settle.label}</dd></> : null}
              </dl>
            </section>
          ) : null}

          {request.invoices.length > 0 ? (
            <section className="panel">
              <h2>Invoices</h2>
              <div className="finance-table-wrap">
                <table className="finance-table">
                  <thead><tr><th>Vendor</th><th>Invoice no.</th><th>Date</th><th className="finance-num">Amount</th><th>File</th></tr></thead>
                  <tbody>
                    {request.invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td>{invoice.vendor}{invoice.vat ? <span className="subtle"> · VAT bill{invoice.supplierTaxNo ? ` (${invoice.supplierTaxNo})` : ''}</span> : null}</td><td>{invoice.invoiceNumber ?? '—'}</td>
                        <td>{DAY.format(new Date(invoice.invoiceDate))}</td><td className="finance-num">{formatMoney(invoice.amount)}</td>
                        <td>{invoice.mediaId ? <a href={`/api/finance/files/${invoice.mediaId}`} target="_blank" rel="noreferrer">View photo</a> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {request.payments.length > 0 ? (
            <section className="panel">
              <h2>Payments</h2>
              <div className="finance-table-wrap">
                <table className="finance-table">
                  <thead><tr><th>Type</th><th>How</th><th>Reference</th><th>Date</th><th className="finance-num">Amount</th><th>Recorded by</th></tr></thead>
                  <tbody>
                    {request.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{p.kind === 'PAYOUT' ? 'Paid out' : 'Cash returned'}</td><td>{MODE[p.mode] ?? p.mode}</td><td>{p.reference}</td>
                        <td>{DAY.format(new Date(p.paidOn))}</td><td className="finance-num">{formatMoney(p.amount)}</td><td>{who(p.recordedBy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="panel">
            <h2>History</h2>
            <ol className="finance-timeline">
              {request.actions.map((entry) => (
                <li key={entry.id}>
                  <strong>{describeEntry(entry)}</strong> <span className="subtle">by {who(entry.actorId)} · {WHEN.format(new Date(entry.at))}</span>
                  {entry.amount ? <span> · {formatMoney(entry.amount)}</span> : null}
                  {entry.comment ? <p className="subtle">“{entry.comment}”</p> : null}
                </li>
              ))}
              {request.actions.length === 0 ? <li className="subtle">Nothing has happened yet.</li> : null}
            </ol>
          </section>
        </div>
      </section>
    </main>
  );
}
