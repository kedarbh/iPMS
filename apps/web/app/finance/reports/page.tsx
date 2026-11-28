import { spendReport } from '../../lib/finance-api';
import { getCurrentUser, hasPermission } from '../../lib/iam-api';
import { listUserDirectory } from '../../lib/user-api';
import { Sidebar, StatePage, TopActions } from '../../shell';
import { formatAmount, personName } from '../model';
import { resolveReportQuery, sumMoney } from '../report-model';

type Raw = { groupBy?: string | string[]; from?: string | string[]; to?: string | string[] };

const GROUP_LABEL = { project: 'Project', category: 'Category', requester: 'Requested by' } as const;

export default async function SpendReportPage({ searchParams }: { searchParams: Promise<Raw> }) {
  const query = resolveReportQuery(await searchParams);
  const viewer = await getCurrentUser();
  if (viewer.state === 'unauthenticated') {
    return <StatePage title="Sign in to see the spend report"><a className="primary-button" href="/login">Sign in</a></StatePage>;
  }
  if (viewer.state !== 'ready' || !hasPermission(viewer.data, 'finance_request.view_all')) {
    return <StatePage title="The spend report is not available"><p>Your role does not include company-wide finance reports.</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }

  const [result, directory] = await Promise.all([
    spendReport(query),
    query.groupBy === 'requester' ? listUserDirectory() : Promise.resolve(null),
  ]);
  if (result.state !== 'ready') {
    return <StatePage title="The spend report is not available"><p>{result.state === 'unauthenticated' ? 'Sign in again to continue.' : result.message}</p><a className="primary-button" href="/finance">Back to finance</a></StatePage>;
  }
  const names = new Map(directory?.state === 'ready' ? directory.data.map((person) => [person.id, person.fullName]) : []);
  const rows = result.data.map((row) => ({ ...row, label: query.groupBy === 'requester' ? personName(row.key, names) : row.label }));
  const total = (pick: (row: (typeof rows)[number]) => string): string => formatAmount(sumMoney(rows.map(pick)));
  const exportParams = new URLSearchParams({ groupBy: query.groupBy });
  if (query.from) exportParams.set('from', query.from);
  if (query.to) exportParams.set('to', query.to);

  return (
    <main className="app-shell">
      <Sidebar active="finance-reports" />
      <section className="content">
        <header className="topbar">
          <div className="crumbs"><a href="/">Workspace</a><b>/</b><a href="/finance">Finance</a><b>/</b><strong>Spend report</strong></div>
          <TopActions />
        </header>
        <div className="dashboard">
          <div className="toolbar">
            <div>
              <p className="eyebrow">FINANCE</p><h1>Spend report</h1>
              <p className="subtle">Advances, settlements and reimbursements, added up.</p>
            </div>
            <a className="primary-button" href={`/api/finance/report?${exportParams.toString()}`}>Export to Excel</a>
          </div>
          <section className="panel">
            <form method="get" className="inline-form report-filters">
              <label className="field">Group by
                <select name="groupBy" defaultValue={query.groupBy}>
                  <option value="project">Project</option>
                  <option value="category">Category</option>
                  <option value="requester">Requester</option>
                </select>
              </label>
              <label className="field">From<input name="from" type="date" defaultValue={query.from ?? ''} /></label>
              <label className="field">To<input name="to" type="date" defaultValue={query.to ?? ''} /></label>
              <button className="primary-button" type="submit">Show</button>
            </form>
            {rows.length === 0 ? <p className="finance-empty">No completed spend in this period.</p> : (
              <>
                <p className="report-unit">All amounts in NPR</p>
                <div className="finance-table-wrap spend-scroll" role="region" aria-label="Spend table, scrolls sideways" tabIndex={0}>
                  <table className="finance-table spend-table">
                    <caption className="sr-only">Spend by {GROUP_LABEL[query.groupBy].toLowerCase()}, in NPR</caption>
                    <thead>
                      <tr>
                        <th scope="col">{GROUP_LABEL[query.groupBy]}</th>
                        <th scope="col" className="finance-num">Advances paid</th><th scope="col" className="finance-num">Settled (applied)</th>
                        <th scope="col" className="finance-num">Cash returned</th><th scope="col" className="finance-num">Outstanding</th>
                        <th scope="col" className="finance-num">Reimbursed</th><th scope="col" className="finance-num">Expense</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.key}>
                          <th scope="row">{row.label}</th>
                          <Amount value={row.advancesPaid} />
                          <Amount value={row.applied} />
                          <Amount value={row.cashReturned} />
                          <Amount value={row.outstanding} />
                          <Amount value={row.reimbursed} />
                          <Amount value={row.expense} />
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">Total</th>
                        <th scope="col" className="finance-num">{total((r) => r.advancesPaid)}</th><th scope="col" className="finance-num">{total((r) => r.applied)}</th>
                        <th scope="col" className="finance-num">{total((r) => r.cashReturned)}</th><th scope="col" className="finance-num">{total((r) => r.outstanding)}</th>
                        <th scope="col" className="finance-num">{total((r) => r.reimbursed)}</th><th scope="col" className="finance-num">{total((r) => r.expense)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="subtle">Outstanding is each advance&apos;s balance today; the other columns follow the dates above.</p>
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

/** One figure in the table. A zero is greyed so the columns that carry money stand out. */
function Amount({ value }: { value: string }) {
  return <td className={Number(value) === 0 ? 'finance-num zero' : 'finance-num'}>{formatAmount(value)}</td>;
}
