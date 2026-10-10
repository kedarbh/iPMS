'use client';
import { useCallback, useState } from 'react';
import type { FinanceRequest } from '../lib/finance-api';
import { DecisionDialog, type DialogRequest } from './decision-dialog';
import { KIND_LABEL, flagText, formatMoney, initials, queueActions, waitLabel, waitTone, waitingDays, type QueueAction } from './model';

const BUTTON: Record<QueueAction, { label: string; className: string }> = {
  approve: { label: 'Approve', className: 'primary-button' },
  pay: { label: 'Pay', className: 'primary-button' },
  return: { label: 'Return', className: 'ghost-button' },
};

/** The waiting list with a decision on each row. Names arrive as a plain object so the server page can hand them over. */
export function QueueTable({ items, names, permissions, now }: { items: FinanceRequest[]; names: Record<string, string>; permissions: string[]; now: string }) {
  const [open, setOpen] = useState<{ request: DialogRequest; kind: QueueAction } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  if (items.length === 0) return <p className="finance-empty">Nothing waits on you.</p>;
  const at = new Date(now);

  return (
    <>
      <div className="finance-table-wrap">
        <table className="finance-table fin-queue">
          <thead>
            <tr><th>Request</th><th>Purpose</th><th>Project</th><th className="finance-num">Amount</th><th>Waiting</th><th><span className="sr-only">Decide</span></th></tr>
          </thead>
          <tbody>
            {items.map((request) => {
              const who = names[request.requesterId] ?? `${request.requesterId.slice(0, 8)}…`;
              const days = waitingDays(request.updatedAt, at);
              const dialog: DialogRequest = {
                id: request.id, number: request.number, kind: request.kind, status: request.status, purpose: request.purpose,
                requestedAmount: request.requestedAmount, approvedAmount: request.approvedAmount, flags: (request.flags ?? []).map(flagText),
              };
              return (
                <tr key={request.id}>
                  <td><a href={`/finance/requests/${request.id}`}><strong>{request.number}</strong></a><span className="subtle">{KIND_LABEL[request.kind]}</span></td>
                  <td>
                    <div className="fin-who">
                      <span className="fin-avatar" aria-hidden="true">{initials(who)}</span>
                      <div>
                        <strong>{request.purpose}</strong><span className="subtle">{who}</span>
                        {request.flags && request.flags.length > 0 ? (
                          <ul className="finance-flags" aria-label="Warnings">
                            {request.flags.map((flag) => <li key={flag.code} className={flag.tone}>{flagText(flag)}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>{request.projectCode}<span className="subtle">{request.projectName}</span></td>
                  <td className="finance-num">{formatMoney(request.approvedAmount ?? request.requestedAmount)}<span className="subtle">{request.category?.name ?? ''}</span></td>
                  <td><span className={`finance-pill ${waitTone(days)}`}>{waitLabel(days)}</span></td>
                  <td className="fin-row-actions">
                    {queueActions(request.status, permissions).map((kind) => (
                      <button key={kind} type="button" className={BUTTON[kind].className} onClick={() => setOpen({ request: dialog, kind })}>{BUTTON[kind].label}</button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open ? <DecisionDialog request={open.request} kind={open.kind} onClose={close} /> : null}
    </>
  );
}
