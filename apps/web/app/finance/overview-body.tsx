import type { FinanceOverview, RequestKind } from '../lib/finance-api';
import {
  KIND_LABEL, KIND_PLURAL, addMoney, dayCount, formatMoney, initials, overdueSummary, personName, waitLabel, waitTone, waitingDays, waitingTitle,
  type ApproverRole,
} from './model';

const KINDS: readonly RequestKind[] = ['ADVANCE', 'SETTLEMENT', 'REIMBURSEMENT'];
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The approver's home: what waits, what is overdue, who holds cash. Pure markup over `FinanceOverview`. */
export function OverviewBody({ overview, names, role, now }: { overview: FinanceOverview; names: ReadonlyMap<string, string>; role: ApproverRole; now: Date }) {
  const { waiting } = overview;
  const overdue = overdueSummary(overview.projects, overview.cashHolders, names);
  const oldest = waiting.oldestSince ? ` · oldest ${dayCount(waitingDays(waiting.oldestSince, now))}` : '';
  const heldTotal = addMoney(...overview.projects.map((p) => p.cashHeld));

  return (
    <>
      <div className="fin-cards">
        <div className="fin-card dark">
          <span className="fin-card-head">{waitingTitle(role)}</span>
          <strong>{formatMoney(waiting.amount)}</strong>
          <small>{plural(waiting.total, 'request')}{oldest}</small>
        </div>
        {KINDS.map((kind) => (
          <div className="fin-card" key={kind}>
            <span className="fin-card-head"><i className={`fin-kind ${kind}`} aria-hidden="true">{KIND_LABEL[kind][0]}</i>{KIND_PLURAL[kind]}</span>
            <strong>{formatMoney(waiting.byKind[kind].amount)}</strong>
            <small>{waiting.byKind[kind].count} waiting</small>
          </div>
        ))}
      </div>

      {overdue ? (
        <div className="fin-banner" role="status">
          <div>
            <strong>{plural(overdue.count, 'settlement')} overdue</strong>
            <p>{formatMoney(overdue.amount)}{overdue.people.length > 0 || overdue.partial ? ` with ${[...overdue.people, ...(overdue.partial ? ['others'] : [])].join(' and ')}` : ''}, past the settle-by day.</p>
          </div>
          <a className="fin-banner-link" href="#cash">See who</a>
        </div>
      ) : null}

      <div className="fin-two">
        <section className="panel" aria-label="Waiting for you">
          <header className="panel-header">
            <h2>Waiting for you</h2>
            <a href="/finance/queue">Open queue</a>
          </header>
          {overview.queue.length === 0 ? <p className="finance-empty">Nothing waits on you.</p> : (
            <ul className="fin-list">
              {overview.queue.map((item) => {
                const who = personName(item.requesterId, names);
                const days = waitingDays(item.waitingSince, now);
                return (
                  <li key={item.id}>
                    <span className="fin-avatar" aria-hidden="true">{initials(who)}</span>
                    <div className="fin-list-main">
                      <a href={`/finance/requests/${item.id}`}><strong>{item.purpose}</strong></a>
                      <span className="subtle">{item.number} · {KIND_LABEL[item.kind]} · {who}</span>
                    </div>
                    <div className="fin-list-side">
                      <strong>{formatMoney(item.amount)}</strong>
                      <span className={`finance-pill ${waitTone(days)}`}>{waitLabel(days)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel" id="cash" aria-label="Cash with engineers">
          <header className="panel-header">
            <h2>Cash with engineers</h2>
            <span className="subtle">{formatMoney(heldTotal)} open</span>
          </header>
          {overview.cashHolders.length === 0 ? <p className="finance-empty">No cash is out.</p> : (
            <ul className="fin-list">
              {overview.cashHolders.map((holder) => {
                const who = personName(holder.requesterId, names);
                return (
                  <li key={holder.requesterId}>
                    <span className="fin-avatar" aria-hidden="true">{initials(who)}</span>
                    <div className="fin-list-main">
                      <strong>{who}</strong>
                      <span className={holder.overdue > 0 ? 'fin-overdue' : 'subtle'}>{holder.open} open{holder.overdue > 0 ? ` · ${holder.overdue} overdue` : ''}</span>
                    </div>
                    <div className="fin-list-side"><strong>{formatMoney(holder.outstanding)}</strong></div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
