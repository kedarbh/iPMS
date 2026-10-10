'use client';
import { FormError, RowAction, SubmitButton } from '../../../components/forms';
import { useActionStateWithToast } from '../../../components/toast';
import { EMPTY, type FormState } from '../../../lib/form-state';
import type { FinanceRequest } from '../../../lib/finance-api';
import { approveAction, cancelAction, cashReturnAction, payAction, rejectAction, returnAction, submitAction } from '../../actions';
import { formatMoney, type RequestAction } from '../../model';

type Act = (state: FormState, form: FormData) => Promise<FormState>;
type Subject = Pick<FinanceRequest, 'id' | 'number' | 'kind' | 'status' | 'requestedAmount' | 'approvedAmount'>;

const today = (): string => new Date().toISOString().slice(0, 10);

export function PaymentFields({ required }: { required: boolean }) {
  return (
    <div className="form-grid">
      <label className="field">How was it paid?
        <select name="mode" required={required} defaultValue="">
          <option value="" disabled={required}>{required ? 'Choose' : '—'}</option>
          <option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option>
          <option value="CHEQUE">Cheque</option><option value="MOBILE_WALLET">Mobile wallet (eSewa, Khalti)</option>
        </select>
      </label>
      <label className="field">Reference<input name="reference" required={required} maxLength={100} placeholder="Transaction or voucher number" /></label>
      <label className="field">Date<input name="paidOn" type="date" required={required} defaultValue={today()} /></label>
      <label className="field">Note<input name="note" maxLength={500} /></label>
    </div>
  );
}

/** One small form: hidden id, its fields, an error line and a button. */
function ActionForm({ action, id, success, title, children, button, tone = 'primary-button' }: {
  action: Act; id: string; success: string; title: string; children?: React.ReactNode; button: string; tone?: string;
}) {
  const [state, run] = useActionStateWithToast(action, EMPTY, success);
  return (
    <form action={run} className="panel-form finance-action">
      <h3>{title}</h3>
      <input type="hidden" name="id" value={id} />
      {children}
      <FormError state={state} />
      <SubmitButton className={tone}>{button}</SubmitButton>
    </form>
  );
}

const reason = (label: string) => (
  <label className="field">{label}<textarea name="comment" required maxLength={1000} rows={2} /></label>
);

/** Only the forms the viewer may use for this request right now; the service re-checks every one. */
export function ActionPanels({ request, actions }: { request: Subject; actions: readonly RequestAction[] }) {
  if (actions.length === 0) return null;
  const has = (action: RequestAction): boolean => actions.includes(action);
  const director = request.status === 'PENDING_DIRECTOR';
  const settlement = request.kind === 'SETTLEMENT';

  return (
    <section className="panel finance-actions" aria-label="Actions">
      {has('edit') ? <a className="ghost-button" href={`/finance/requests/${request.id}/edit`}>Edit</a> : null}
      {has('submit') ? (
        <RowAction action={submitAction} hidden={{ id: request.id }} label="Submit for approval" success="Submitted" className="primary-button" />
      ) : null}
      {has('settle') ? <a className="primary-button" href={`/finance/new?kind=SETTLEMENT&advanceId=${request.id}`}>Settle this advance</a> : null}

      {has('approve') ? (
        <ActionForm action={approveAction} id={request.id} success="Approved" title="Approve" button="Approve">
          {director ? (
            <label className="field">Approved amount (NPR)
              <input name="amount" inputMode="decimal" placeholder={request.requestedAmount} />
              <span className="hint">Leave empty to approve {formatMoney(request.requestedAmount)}, or enter a lower amount.</span>
            </label>
          ) : null}
          <label className="field">Note (optional)<input name="comment" maxLength={1000} /></label>
        </ActionForm>
      ) : null}

      {has('pay') ? (
        <ActionForm action={payAction} id={request.id} success={settlement ? 'Settled' : 'Payment recorded'} title={settlement ? 'Settle' : 'Record payment'} button={settlement ? 'Confirm settlement' : 'Record payment'}>
          <p className="form-note">Approved amount: <strong>{formatMoney(request.approvedAmount)}</strong>.{settlement ? ' Payment details are needed only if money is paid out.' : ''}</p>
          <PaymentFields required={!settlement} />
        </ActionForm>
      ) : null}

      {has('cashReturn') ? (
        <ActionForm action={cashReturnAction} id={request.id} success="Cash return recorded" title="Record returned cash" button="Record cash return">
          <label className="field">Amount returned (NPR)<input name="amount" inputMode="decimal" required /></label>
          <PaymentFields required />
        </ActionForm>
      ) : null}

      {has('return') ? (
        <ActionForm action={returnAction} id={request.id} success="Returned" title="Return to requester" button="Return to requester" tone="ghost-button">
          {reason('Why? The requester will see this.')}
        </ActionForm>
      ) : null}
      {has('reject') ? (
        <ActionForm action={rejectAction} id={request.id} success="Rejected" title="Reject" button="Reject" tone="danger-button">
          {reason('Why? This ends the request.')}
        </ActionForm>
      ) : null}

      {has('cancel') ? (
        <RowAction action={cancelAction} hidden={{ id: request.id }} label="Cancel request" confirm="Cancel this request? It will be withdrawn from approval." success="Cancelled" />
      ) : null}
    </section>
  );
}
