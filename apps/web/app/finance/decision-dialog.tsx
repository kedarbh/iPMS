'use client';
import { useEffect } from 'react';
import { FormError, SubmitButton } from '../components/forms';
import { useActionStateWithToast } from '../components/toast';
import { EMPTY } from '../lib/form-state';
import type { RequestKind, RequestStatus } from '../lib/finance-api';
import { approveAction, payAction, returnAction } from './actions';
import { KIND_LABEL, formatMoney, type QueueAction } from './model';
import { PaymentFields } from './requests/[id]/panels';

export interface DialogRequest {
  id: string; number: string; kind: RequestKind; status: RequestStatus; purpose: string;
  requestedAmount: string; approvedAmount: string | null; flags: string[];
}

const COPY: Record<QueueAction, { title: string; button: string; success: string }> = {
  approve: { title: 'Approve', button: 'Approve', success: 'Approved' },
  return: { title: 'Return to requester', button: 'Return to requester', success: 'Returned' },
  pay: { title: 'Record payment', button: 'Record payment', success: 'Payment recorded' },
};

/** A centred dialog over the queue. The action finishes with `done`, which closes it; an error stays inline. */
export function DecisionDialog({ request, kind, onClose }: { request: DialogRequest; kind: QueueAction; onClose: () => void }) {
  const action = kind === 'approve' ? approveAction : kind === 'pay' ? payAction : returnAction;
  const settlement = request.kind === 'SETTLEMENT';
  const copy = kind === 'pay' && settlement ? { title: 'Settle', button: 'Confirm settlement', success: 'Settled' } : COPY[kind];
  const [state, run] = useActionStateWithToast(action, EMPTY, copy.success);

  useEffect(() => { if (state.done) onClose(); }, [state.done, onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fin-dialog-overlay" onClick={onClose}>
      <div className="fin-dialog" role="dialog" aria-modal="true" aria-label={`${copy.title} ${request.number}`} onClick={(event) => event.stopPropagation()}>
        <header className="fin-dialog-head">
          <div>
            <p className="eyebrow">{KIND_LABEL[request.kind].toUpperCase()} · {request.number}</p>
            <h2>{copy.title}</h2>
            <p className="subtle">{request.purpose} · {formatMoney(request.approvedAmount ?? request.requestedAmount)}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {request.flags.length > 0 ? (
          <ul className="finance-flags fin-dialog-flags" aria-label="Warnings">{request.flags.map((flag) => <li key={flag} className="amber">{flag}</li>)}</ul>
        ) : null}
        <form action={run} className="panel-form">
          <input type="hidden" name="id" value={request.id} />
          <input type="hidden" name="from" value="queue" />
          {kind === 'approve' && request.status === 'PENDING_DIRECTOR' ? (
            <label className="field">Approved amount (NPR)
              <input name="amount" inputMode="decimal" placeholder={request.requestedAmount} />
              <span className="hint">Leave empty to approve {formatMoney(request.requestedAmount)}, or enter a lower amount.</span>
            </label>
          ) : null}
          {kind === 'approve' ? <label className="field">Note (optional)<input name="comment" maxLength={1000} /></label> : null}
          {kind === 'return' ? <label className="field">Why? The requester will see this.<textarea name="comment" required maxLength={1000} rows={3} /></label> : null}
          {kind === 'pay' ? (
            <>
              <p className="form-note">Approved amount: <strong>{formatMoney(request.approvedAmount ?? request.requestedAmount)}</strong>.{settlement ? ' Payment details are needed only if money is paid out.' : ''}</p>
              <PaymentFields required={!settlement} />
            </>
          ) : null}
          <FormError state={state} />
          <div className="fin-dialog-actions">
            <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
            <SubmitButton className={kind === 'return' ? 'danger-button' : 'primary-button'}>{copy.button}</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
