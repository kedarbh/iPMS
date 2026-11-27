import { STATUS_SEGMENTS } from './model';
import { BarList, Columns, SegmentBar, type BarItem } from './charts';
import { FIRST_TIME_CONCERN, FIRST_TIME_WATCH } from './director-model';
import type { ReportRow, ReportTotals } from '../reports/report-model';

/** The Director's charts on delivery and quality. Pure rendering over a portfolio report. */

/** Labels for rolling weeks, oldest first: "7w ago" … "This week". */
export function weekLabels(count: number): string[] {
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? 'This wk' : `${count - 1 - i}w ago`));
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Completions across the portfolio per rolling week, and how far each project is against plan. */
export function DeliveryPanel({ totals, rows, full = false }: { totals: ReportTotals; rows: readonly ReportRow[]; full?: boolean }) {
  const weeks = weekLabels(totals.weekly.length);
  const last4 = totals.weekly.slice(-4).reduce((t, v) => t + v, 0);
  const prior4 = totals.weekly.slice(-8, -4).reduce((t, v) => t + v, 0);
  // A percentage on a handful of completions says little, so it needs a base to compare with.
  const trend = prior4 < 4 ? null : Math.round(((last4 - prior4) / prior4) * 100);
  const behind = [...rows].filter((r) => r.health.expected !== null).sort((a, b) => b.health.behind - a.health.behind).slice(0, full ? undefined : 5);
  return (
    <section className="ov-card ov-panel" id="delivery">
      <header className="ov-panel-head">
        <div>
          <h2>Delivery pace</h2>
          <p>Sites or tasks completed each rolling week, all projects. {trend === null ? '' : `Last four weeks ${trend >= 0 ? 'up' : 'down'} ${Math.abs(trend)}% on the four before.`}</p>
        </div>
        {full ? null : <a className="ov-link" href="/reports#delivery">Full report <span aria-hidden="true">→</span></a>}
      </header>
      {totals.weekly.length === 0 ? <p className="ov-sub">No completions recorded yet.</p> : <Columns values={totals.weekly} periods={weeks} short={weeks.map((w, i) => (i === weeks.length - 1 ? 'Now' : `−${weeks.length - 1 - i}w`))} label="Completed per week" />}
      {behind.length > 0 ? (
        <>
          <h3 className="dr-sub">{full ? 'Completion against plan' : 'Furthest behind plan'}</h3>
          <BarList
            label="Completion by project"
            max={100}
            items={behind.map((r): BarItem => ({
              key: r.id,
              label: <a className="ov-project" href={`/projects/${r.id}`}>{r.code}</a>,
              sub: r.health.behind > 0 ? `${r.health.behind} pts behind plan` : 'on or ahead of plan',
              value: r.health.completion,
              display: `${r.health.completion}% / ${r.health.expected}%`,
              tone: r.health.schedule.severity,
            }))}
          />
        </>
      ) : null}
    </section>
  );
}

/** First-time approval per project against the watch line, and where each project's work orders stand. */
export function QualityPanel({ rows, full = false }: { rows: readonly ReportRow[]; full?: boolean }) {
  const withWo = rows.filter((r) => r.workOrders && r.workOrders.total > 0);
  if (rows.some((r) => r.workOrders === null)) {
    return (
      <section className="ov-card ov-panel" id="quality">
        <header className="ov-panel-head"><div><h2>Quality</h2></div></header>
        <p className="ov-note">Quality control did not answer, so work order quality cannot be shown.</p>
      </section>
    );
  }
  const rated = withWo.filter((r) => r.workOrders!.firstTime !== null).sort((a, b) => a.workOrders!.firstTime! - b.workOrders!.firstTime!);
  const waiting = withWo.reduce((t, r) => t + r.workOrders!.awaitingReview, 0);
  const oldest = Math.max(0, ...withWo.map((r) => r.workOrders!.oldestReviewDays ?? 0));
  return (
    <section className="ov-card ov-panel" id="quality">
      <header className="ov-panel-head">
        <div>
          <h2>Quality</h2>
          <p>Share of the last 90 days&apos; approvals that passed first time. {waiting > 0 ? `${plural(waiting, 'work order')} in QC review, the oldest for ${plural(oldest, 'day')}.` : 'Nothing is waiting for QC review.'}</p>
        </div>
        {full ? null : <a className="ov-link" href="/reports#quality">Full report <span aria-hidden="true">→</span></a>}
      </header>
      {rated.length === 0 ? <p className="ov-sub">No approvals in the last 90 days yet.</p> : (
        <BarList
          label="First-time approval by project"
          max={100}
          target={{ value: FIRST_TIME_WATCH, label: `${FIRST_TIME_WATCH}% watch line` }}
          items={rated.map((r): BarItem => {
            const ft = r.workOrders!.firstTime!;
            return {
              key: r.id,
              label: <a className="ov-project" href={`/projects/${r.id}`}>{r.code}</a>,
              sub: r.workOrders!.awaitingReview > 0 ? `${r.workOrders!.awaitingReview} in review` : undefined,
              value: ft,
              display: `${ft}%`,
              tone: ft < FIRST_TIME_CONCERN ? 'red' : ft < FIRST_TIME_WATCH ? 'amber' : 'green',
            };
          })}
        />
      )}
      {withWo.length > 0 ? (
        <>
          <h3 className="dr-sub">Work orders by status</h3>
          <ul className="ch-wo">
            {withWo.map((r) => (
              <li key={r.id}>
                <span>{r.code}</span>
                <SegmentBar label={`${r.code} work orders`} segments={STATUS_SEGMENTS.map((s) => ({ key: s.status, label: s.label, count: r.workOrders!.byStatus[s.status], tone: s.tone }))} />
                <b>{r.workOrders!.total}</b>
              </li>
            ))}
          </ul>
          <ul className="ch-legend ch-legend-status" aria-label="Key">
            {STATUS_SEGMENTS.map((s) => <li key={s.status}><i className={s.tone} aria-hidden="true" />{s.label}</li>)}
          </ul>
        </>
      ) : null}
    </section>
  );
}
