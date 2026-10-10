import type { DecisionContext } from '@ipms/contracts';
import { dayCount, flagText, formatMoney } from '../../model';

/** "Before you decide": what the approver at this step should weigh. Shown only when the service sends it. */
export function ContextPanel({ context, category, project }: { context: DecisionContext; category: string; project: string }) {
  const { requester, category: norm } = context;
  const holds = requester.openAdvances === 0
    ? 'Holds no unsettled advances.'
    : `Holds ${formatMoney(requester.outstanding)} from ${requester.openAdvances} open advance${requester.openAdvances === 1 ? '' : 's'}${requester.overdue > 0 ? `, ${requester.overdue} overdue${requester.oldestOverdueDays === null ? '' : ` (oldest ${dayCount(requester.oldestOverdueDays)})`}` : ''}.`;
  return (
    <section className="panel finance-facts finance-context" aria-labelledby="before-you-decide">
      <h2 id="before-you-decide">Before you decide</h2>
      {context.flags.length > 0 ? (
        <ul className="finance-flags" aria-label="Warnings">
          {context.flags.map((flag) => <li key={flag.code} className={flag.tone}>{flagText(flag)}</li>)}
        </ul>
      ) : null}
      <dl>
        <dt>Requester</dt>
        <dd>{holds}</dd>
        <dt>Usual for {category}</dt>
        <dd>{norm ? `${formatMoney(norm.p25)} to ${formatMoney(norm.p75)}, median ${formatMoney(norm.median)} (${norm.samples} requests in 180 days).` : 'Too few closed requests like this to compare.'}</dd>
        <dt>{project} this month</dt>
        <dd>{`${formatMoney(context.project.thisMonth)} spent; ${formatMoney(context.project.average3)} a month on average over the 3 months before.`}</dd>
      </dl>
    </section>
  );
}
