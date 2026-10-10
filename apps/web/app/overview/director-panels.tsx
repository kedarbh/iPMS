import type { FinanceOverview, PipelineStep } from '@ipms/contracts';
import { KIND_LABEL, flagText, formatMoney, personName } from '../finance/model';
import { decideTimeText, nprShort, waitingFor, type ProjectHealth, type Signal } from './director-model';

const STEP_NAME: Record<PipelineStep['status'], string> = { PENDING_PM: 'With PM', PENDING_DIRECTOR: 'With Director', PENDING_FINANCE: 'With Finance' };
const monthName = (key: string): string => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

function Badge({ signal }: { signal: Signal | null }) {
  return signal ? <span className={`dr-badge ${signal.severity}`}>{signal.label}</span> : <span className="dr-badge neutral">—</span>;
}

function Progress({ health }: { health: ProjectHealth }) {
  return (
    <span className="dr-progress" role="img" aria-label={`${health.completion}% complete${health.expected === null ? '' : `, ${health.expected}% expected by now`}`}>
      <i className={health.schedule.severity} style={{ width: `${health.completion}%` }} />
      {health.expected === null ? null : <b style={{ left: `${health.expected}%` }} />}
    </span>
  );
}

/** Where requests stand, and what waits on the viewer with its flags. */
export function WaitingPanel({ finance, names, now }: { finance: FinanceOverview | null; names: ReadonlyMap<string, string>; now: Date }) {
  if (!finance) {
    return (
      <section className="ov-card ov-panel" id="waiting">
        <header className="ov-panel-head"><div><h2>Waiting on you</h2></div></header>
        <p className="ov-note">Finance did not answer, so what waits on you cannot be shown here. <a className="ov-link" href="/finance?view=awaiting">Open the finance queue</a></p>
      </section>
    );
  }
  return (
    <section className="ov-card ov-panel" id="waiting">
      <header className="ov-panel-head">
        <div><h2>Waiting on you</h2><p>Longest waiting first</p></div>
        <a className="ov-link" href="/finance?view=awaiting">Open queue <span aria-hidden="true">→</span></a>
      </header>
      <ol className="dr-pipeline" aria-label="Where requests are">
        {finance.pipeline.steps.map((step) => (
          <li key={step.status} className={step.mine ? 'mine' : undefined}>
            <a href={`/finance?view=all&status=${step.status}`}>
              <span>{step.mine ? 'With you' : STEP_NAME[step.status]}</span>
              <b>{step.count}</b>
              <em>{nprShort(step.amount)}{step.count > 0 ? ` · oldest ${waitingFor(step.oldestSince, now)}` : ''}</em>
            </a>
          </li>
        ))}
        <li>
          <a href="/finance?view=all&status=PAID">
            <span>Paid this month</span>
            <b>{finance.pipeline.paidThisMonth.count}</b>
            <em>{nprShort(finance.pipeline.paidThisMonth.amount)}</em>
          </a>
        </li>
      </ol>
      {finance.queue.length === 0 ? (
        <div className="ov-empty"><strong>All caught up</strong><p>Requests reach you once the project manager approves them.</p></div>
      ) : (
        <ul className="mg-queue">
          {finance.queue.map((item) => {
            const age = waitingFor(item.waitingSince, now);
            return (
              <li key={item.id}>
                <span className="mg-icon" aria-hidden="true">₨</span>
                <div className="mg-main">
                  <p><a href={`/finance/requests/${item.id}`}>{item.purpose}</a><code>{item.number}</code></p>
                  <span>{KIND_LABEL[item.kind]} · {item.category} · {item.projectCode} {item.projectName}</span>
                  <span>{personName(item.requesterId, names)}</span>
                  {item.flags.length > 0 ? (
                    <ul className="finance-flags" aria-label="Warnings">
                      {item.flags.map((flag) => <li key={flag.code} className={flag.tone}>{flagText(flag)}</li>)}
                    </ul>
                  ) : null}
                </div>
                <div className="mg-end">
                  <b>{formatMoney(item.amount)}</b>
                  <span className="ov-sub">{age === 'today' ? 'Arrived today' : `Waiting ${age}`}</span>
                  <a className="mg-review" href={`/finance/requests/${item.id}`}>Review</a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Every project in scope, worst first, with the reason behind each signal. */
export function PortfolioPanel({ health, failure, workOrdersMissing }: { health: readonly ProjectHealth[]; failure: string | null; workOrdersMissing: boolean }) {
  return (
    <section className="ov-card ov-panel" id="portfolio">
      <header className="ov-panel-head">
        <div><h2>Portfolio</h2><p>Worst first. The tick on each bar is where the project should be by now.</p></div>
        <a className="ov-link" href="/projects">All projects <span aria-hidden="true">→</span></a>
      </header>
      {failure ? <p className="ov-note">Projects are unavailable: {failure}</p>
        : health.length === 0 ? <div className="ov-empty"><strong>No active projects in your scope</strong></div>
          : (
            <>
              {workOrdersMissing ? <p className="ov-note">Work orders unavailable: quality is not shown, and projects without milestone requirements count planned tasks only.</p> : null}
              <div className="ov-scroll">
                <table className="ov-table dr-portfolio">
                  <thead><tr><th>Project</th><th>Progress</th><th>Schedule</th><th>Quality</th><th>Money</th></tr></thead>
                  <tbody>
                    {health.map((h) => (
                      <tr key={h.id}>
                        <td><a className="ov-project" href={`/projects/${h.id}`}>{h.name}</a><span className="ov-sub">{h.code}</span></td>
                        <td><b>{h.completion}%</b>{h.partial ? <span className="ov-sub">partial</span> : null}<Progress health={h} /></td>
                        <td><Badge signal={h.schedule} /><span className="ov-sub">{h.schedule.reason}</span></td>
                        <td><Badge signal={h.quality} />{h.quality ? <span className="ov-sub">{h.quality.reason}</span> : null}</td>
                        <td><Badge signal={h.money} />{h.money ? <span className="ov-sub">{h.money.reason}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
    </section>
  );
}

/** Spend over six months, this month by category, and cash still with engineers. */
export function MoneyPanel({ finance, names }: { finance: FinanceOverview | null; names: ReadonlyMap<string, string> }) {
  if (!finance) {
    return (
      <section className="ov-card ov-panel" id="money">
        <header className="ov-panel-head"><div><h2>Money</h2></div></header>
        <p className="ov-note">Finance did not answer, so spend and cash out cannot be shown.</p>
      </section>
    );
  }
  const totals = finance.months.map((month, i) => ({ month, amount: finance.projects.reduce((t, p) => t + Number(p.spentByMonth[i] ?? 0), 0) }));
  const peak = Math.max(1, ...totals.map((t) => t.amount));
  const cash = finance.projects.reduce((t, p) => t + Number(p.cashHeld), 0);
  const overdue = finance.projects.reduce((t, p) => t + Number(p.overdueSettlements.amount), 0);
  return (
    <section className="ov-card ov-panel" id="money">
      <header className="ov-panel-head">
        <div><h2>Money</h2><p>Spent is reimbursed plus settled, by the month Finance closed it (the spend report filters by the day a request was raised). Cash still out on advances is shown apart.</p></div>
        <a className="ov-link" href="/finance/reports">Spend report <span aria-hidden="true">→</span></a>
      </header>
      <ol className="dr-bars" aria-label="Spend by month">
        {totals.map((t) => (
          <li key={t.month}><i style={{ height: `${Math.round((t.amount / peak) * 100)}%` }} /><b>{nprShort(t.amount)}</b><span>{monthName(t.month)}</span></li>
        ))}
      </ol>
      <h3 className="dr-sub">This month by category</h3>
      {finance.categories.length === 0 ? <p className="ov-sub">Nothing spent this month yet.</p> : (
        <ul className="dr-list">{finance.categories.map((c) => <li key={c.categoryId}><span>{c.name}</span><b>{nprShort(c.amount)}</b></li>)}</ul>
      )}
      <h3 className="dr-sub">Cash with engineers: {nprShort(cash)}{overdue > 0 ? <em className="red"> · {nprShort(overdue)} overdue</em> : null}</h3>
      {finance.cashHolders.length === 0 ? <p className="ov-sub">No advances are out.</p> : (
        <ul className="dr-list">
          {finance.cashHolders.map((h) => (
            <li key={h.requesterId}>
              <span>{personName(h.requesterId, names)}<em> · {h.open} open{h.overdue > 0 ? `, ${h.overdue} overdue` : ''}</em></span>
              <b>{nprShort(h.outstanding)}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The viewer's own decisions over 30 days. */
export function DecisionsPanel({ finance }: { finance: FinanceOverview | null }) {
  if (!finance) return null;
  const d = finance.decisions;
  return (
    <section className="ov-card ov-panel" id="decisions">
      <header className="ov-panel-head">
        <div><h2>Your decisions</h2><p>Last 30 days</p></div>
        <a className="ov-link" href="/finance?view=handled">Decided by me <span aria-hidden="true">→</span></a>
      </header>
      <dl className="dr-stats">
        <div><dt>Approved</dt><dd><b>{d.approved.count}</b><span>{nprShort(d.approved.amount)}</span></dd></div>
        <div><dt>Trimmed</dt><dd><b>{d.trimmed.count}</b><span>{nprShort(d.trimmed.saved)} saved</span></dd></div>
        <div><dt>Returned</dt><dd><b>{d.returned}</b></dd></div>
        <div><dt>Rejected</dt><dd><b>{d.rejected}</b></dd></div>
        <div><dt>Median time to decide</dt><dd><b>{d.medianHoursToDecide === null ? '—' : decideTimeText(d.medianHoursToDecide)}</b></dd></div>
      </dl>
    </section>
  );
}
