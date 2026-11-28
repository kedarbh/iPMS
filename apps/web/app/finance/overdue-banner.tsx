'use client';
import { useId, useState } from 'react';

export interface OverdueRow { id: string; number: string; who: string; project: string; amount: string; late: string }

/**
 * The overdue settlements banner. "See who" opens the list of overdue advances
 * in place, each linking to its request, so the answer is right under the
 * question whatever else is on screen.
 */
export function OverdueBanner({ title, summary, rows, more }: { title: string; summary: string; rows: OverdueRow[]; more: number }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="fin-banner" role="status">
      <div className="fin-banner-head">
        <div>
          <strong>{title}</strong>
          <p>{summary}</p>
        </div>
        {rows.length > 0 ? (
          <button type="button" className="fin-banner-link" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'See who'}
          </button>
        ) : null}
      </div>
      {open ? <OverdueList id={listId} rows={rows} more={more} /> : null}
    </div>
  );
}

/** The opened list: one row per overdue advance, longest overdue first, each linking to its request. */
export function OverdueList({ id, rows, more }: { id: string; rows: OverdueRow[]; more: number }) {
  return (
    <ul className="fin-overdue-list" id={id}>
      {rows.map((row) => (
        <li key={row.id}>
          <a href={`/finance/requests/${row.id}`}>
            <span className="fin-overdue-main"><strong>{row.who}</strong><span className="subtle">{row.number} · {row.project}</span></span>
            <span className="fin-overdue-side"><strong>{row.amount}</strong><span className="fin-overdue">{row.late}</span></span>
          </a>
        </li>
      ))}
      {more > 0 ? <li className="subtle fin-overdue-more">and {more} more</li> : null}
    </ul>
  );
}
