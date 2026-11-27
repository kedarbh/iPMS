import type { ReactNode } from 'react';
import type { Series } from '../reports/report-model';

/**
 * Small server-rendered charts for the Director's home and the portfolio
 * report. They are plain HTML and SVG, so they need no client script: a
 * native tooltip (`title`) gives the exact figure on hover, every chart also
 * prints its key values as text, and the report carries the full table.
 * Marks follow .interface-design/system.md: thin bars with 4px ends, a 2px
 * gap between stacked segments, recessive axes, text in text inks only.
 */

const share = (value: number, peak: number): number => (peak > 0 ? Math.max(0, Math.min(100, (value / peak) * 100)) : 0);

/** The key to a multi-series chart. Swatches carry identity; the words stay in ink. */
export function Legend({ series, unit }: { series: readonly Pick<Series, 'key' | 'label' | 'color'>[]; unit?: string | undefined }) {
  return (
    <ul className="ch-legend" aria-label="Key">
      {series.map((s) => <li key={s.key}><i style={{ background: s.color }} aria-hidden="true" />{s.label}</li>)}
      {unit ? <li className="ch-unit">{unit}</li> : null}
    </ul>
  );
}

/**
 * Columns of stacked series, one column per period, oldest first. The last
 * period is the one in progress; its label is set in ink.
 */
export function StackedColumns({ series, periods, label, format, unit }: {
  series: readonly Series[]; periods: readonly string[]; label: string; format: (value: number) => string;
  /** The unit the column figures are in, shown at the end of the key. */
  unit?: string | undefined;
}) {
  const totals = periods.map((_, i) => series.reduce((t, s) => t + (s.values[i] ?? 0), 0));
  const peak = Math.max(0, ...totals);
  return (
    <figure className="ch-figure">
      {series.length > 1 ? <Legend series={series} unit={unit} /> : unit ? <p className="ch-legend ch-unit">{unit}</p> : null}
      <ol className="ch-cols" aria-label={label} style={{ ['--n' as string]: periods.length }}>
        {periods.map((period, i) => (
          <li key={period} className={i === periods.length - 1 ? 'now' : undefined}>
            <b>{totals[i]! > 0 ? format(totals[i]!) : '—'}</b>
            <span className="ch-stack" style={{ height: `${share(totals[i]!, peak)}%` }}>
              {series.map((s) => {
                const value = s.values[i] ?? 0;
                return value > 0 ? (
                  <i key={s.key} style={{ flexGrow: value, background: s.color }} title={`${s.label}, ${period}: ${format(value)}`} />
                ) : null;
              })}
            </span>
            <span className="ch-axis">{period}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** One series over time. Past periods recede; the period in progress takes the accent. */
export function Columns({ values, periods, short, label, format = String }: {
  values: readonly number[]; periods: readonly string[]; label: string; format?: (value: number) => string;
  /** Shorter period labels for narrow screens. */
  short?: readonly string[] | undefined;
}) {
  const peak = Math.max(0, ...values);
  return (
    <ol className="ch-cols single" aria-label={label} style={{ ['--n' as string]: values.length }}>
      {values.map((value, i) => (
        <li key={periods[i] ?? i} className={i === values.length - 1 ? 'now' : undefined}>
          <b>{format(value)}</b>
          <span className="ch-stack" style={{ height: `${share(value, peak)}%` }} title={`${periods[i] ?? ''}: ${format(value)}`}>
            {value > 0 ? <i style={{ flexGrow: 1 }} /> : null}
          </span>
          <span className="ch-axis">
            {short ? <><span className="ch-long">{periods[i]}</span><span className="ch-short" aria-hidden="true">{short[i]}</span></> : periods[i]}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  /** The figure printed at the end of the bar. */
  display: string;
  /** Muted text under the label. */
  sub?: string | undefined;
  tone?: 'red' | 'amber' | 'green' | 'neutral' | undefined;
}

/**
 * Horizontal bars against one scale. `max` fixes the scale (100 for a
 * percentage); without it the longest bar fills the track. `target` draws a
 * tick on every track, such as a passing mark.
 */
export function BarList({ items, label, max, target }: {
  items: readonly BarItem[]; label: string; max?: number | undefined; target?: { value: number; label: string } | undefined;
}) {
  const peak = max ?? Math.max(0, ...items.map((item) => item.value));
  return (
    <ul className="ch-barlist" aria-label={label}>
      {items.map((item) => (
        <li key={item.key}>
          <span className="ch-barlist-label">{item.label}{item.sub ? <em>{item.sub}</em> : null}</span>
          <span className="ch-track" title={`${typeof item.label === 'string' ? `${item.label}: ` : ''}${item.display}`}>
            <i className={item.tone ?? 'neutral'} style={{ width: `${share(item.value, peak)}%` }} />
            {target ? <b style={{ left: `${share(target.value, peak)}%` }} aria-hidden="true" /> : null}
          </span>
          <span className="ch-barlist-value">{item.display}</span>
        </li>
      ))}
      {target ? <li className="ch-barlist-note"><span /><span><b aria-hidden="true" />{target.label}</span><span /></li> : null}
    </ul>
  );
}

/**
 * Shares of one whole as a single segmented bar, with its key. Used for work
 * orders by status, where each tone is a status colour and is named in text.
 */
export function SegmentBar({ segments, label }: {
  segments: readonly { key: string; label: string; count: number; tone: string }[]; label: string;
}) {
  const total = segments.reduce((t, s) => t + s.count, 0);
  return (
    <span className="ch-segments" role="img" aria-label={`${label}: ${segments.filter((s) => s.count > 0).map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ') || 'none'}`}>
      {total === 0 ? <i className="empty" style={{ flexGrow: 1 }} /> : segments.map((s) => (
        s.count > 0 ? <i key={s.key} className={s.tone} style={{ flexGrow: s.count }} title={`${s.label}: ${s.count}`} /> : null
      ))}
    </span>
  );
}

/** A trend line without axes, for a table cell. The last point is marked. */
export function Sparkline({ values, label, width = 96, height = 26 }: {
  values: readonly number[]; label: string; width?: number; height?: number;
}) {
  if (values.length < 2) return <span className="ch-spark-none">—</span>;
  const peak = Math.max(1, ...values);
  const pad = 3;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (values.length - 1);
  const y = (v: number) => height - pad - (v / peak) * (height - pad * 2);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg className="ch-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <title>{label}</title>
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="base" />
      <polyline points={points} />
      <circle cx={x(last)} cy={y(values[last]!)} r="3" />
    </svg>
  );
}
