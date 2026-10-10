import type { FinanceRequest, RequestPage, RequestView } from '../lib/finance-api';
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, flagText, formatMoney, personName } from './model';

const DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });

export interface TableQuery { status?: string; kind?: string }

/** A workspace link that keeps the view and any filter that is set. */
export function financeHref(view: RequestView, query: TableQuery = {}, page?: number): string {
  const params = new URLSearchParams({ view });
  if (query.status) params.set('status', query.status);
  if (query.kind) params.set('kind', query.kind);
  if (page !== undefined) params.set('page', String(page));
  return `/finance?${params.toString()}`;
}

/** The finance workspace's list: one row per request, in the order the view gives them (the awaiting view oldest first), linking to the request. */
export function RequestsTable({ page, names, view, query = {} }: { page: RequestPage; names: ReadonlyMap<string, string>; view: RequestView; query?: TableQuery }) {
  if (page.items.length === 0) return <p className="finance-empty">{view === 'awaiting' ? 'All caught up. Nothing is waiting for you.' : 'Nothing here yet.'}</p>;
  const last = Math.max(1, Math.ceil(page.total / page.limit));
  return (
    <>
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead>
            <tr><th>Request</th><th>Project</th><th>For</th><th>Requested by</th><th className="finance-num">Amount</th><th>Status</th><th>Updated</th></tr>
          </thead>
          <tbody>
            {page.items.map((request: FinanceRequest) => (
              <tr key={request.id}>
                <td>
                  <a href={`/finance/requests/${request.id}`}><strong>{request.number}</strong></a><span className="subtle">{KIND_LABEL[request.kind]}</span>
                  {request.flags && request.flags.length > 0 ? (
                    <ul className="finance-flags" aria-label="Warnings">
                      {request.flags.map((flag) => <li key={flag.code} className={flag.tone}>{flagText(flag)}</li>)}
                    </ul>
                  ) : null}
                </td>
                <td>{request.projectName}<span className="subtle">{request.projectCode}</span></td>
                <td>{request.purpose}<span className="subtle">{request.category?.name ?? ''}</span></td>
                <td>{personName(request.requesterId, names)}</td>
                <td className="finance-num">
                  {formatMoney(request.approvedAmount ?? request.requestedAmount)}
                  {request.approvedAmount !== null && request.approvedAmount !== request.requestedAmount
                    ? <span className="subtle">asked {formatMoney(request.requestedAmount)}</span> : null}
                </td>
                <td><span className={`finance-pill ${STATUS_TONE[request.status]}`}>{STATUS_LABEL[request.status]}</span></td>
                <td>{DATE.format(new Date(request.updatedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {last > 1 ? (
        <nav className="pager" aria-label="Pages">
          {page.page > 1 ? <a className="ghost-button" href={financeHref(view, query, page.page - 1)}>Previous</a> : <span />}
          <span className="subtle">Page {page.page} of {last}</span>
          {page.page < last ? <a className="ghost-button" href={financeHref(view, query, page.page + 1)}>Next</a> : <span />}
        </nav>
      ) : null}
    </>
  );
}
