import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../../components/toast', () => ({
  useActionStateWithToast: (_action: unknown, initial: unknown) => [initial, () => undefined],
}));
vi.mock('../../actions', () => ({
  submitAction: vi.fn(), cancelAction: vi.fn(), approveAction: vi.fn(), returnAction: vi.fn(),
  rejectAction: vi.fn(), payAction: vi.fn(), cashReturnAction: vi.fn(), remindAction: vi.fn(),
}));
vi.mock('react-dom', async (original) => ({ ...(await original<typeof import('react-dom')>()), useFormStatus: () => ({ pending: false }) }));

const { ActionPanels } = await import('./panels');

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE', status: 'PENDING_DIRECTOR', requestedAmount: '50000.00', approvedAmount: null, ...over,
}) as never;
const html = (actions: string[], over: Record<string, unknown> = {}, difference: number | null = null) =>
  renderToStaticMarkup(<ActionPanels request={request(over)} actions={actions as never} difference={difference} />);

describe('ActionPanels', () => {
  it('renders nothing when there is nothing to do', () => {
    expect(html([])).toBe('');
  });

  it('lets a draft be edited and submitted', () => {
    const out = html(['edit', 'submit'], { status: 'DRAFT' });
    expect(out).toContain('href="/finance/requests/r-1/edit"');
    expect(out).toContain('Submit for approval');
  });

  it('offers an amount only at the Director step', () => {
    expect(html(['approve', 'return', 'reject'])).toContain('name="amount"');
    expect(html(['approve', 'return', 'reject'], { status: 'PENDING_PM' })).not.toContain('name="amount"');
  });

  it('carries the request id as a hidden field', () => {
    expect(html(['approve', 'return', 'reject'])).toMatch(/<input[^>]*type="hidden"[^>]*name="id"[^>]*value="r-1"|<input[^>]*name="id"[^>]*value="r-1"/);
  });

  it('asks for a reason on return and reject', () => {
    const out = html(['approve', 'return', 'reject']);
    expect(out).toContain('Return to requester');
    expect(out).toContain('Reject');
    expect(out).toMatch(/name="comment"[^>]*required/);
  });

  it('shows the payment form to Finance with the approved amount', () => {
    const out = html(['pay', 'return', 'reject'], { status: 'PENDING_FINANCE', approvedAmount: '40000.00' });
    expect(out).toContain('NPR 40,000.00');
    expect(out).toContain('name="mode"');
    expect(out).toContain('name="reference"');
    expect(out).toContain('name="paidOn"');
    expect(out).not.toContain('name="amount"');
  });

  it('explains that a settlement only needs payment details when money is paid out', () => {
    expect(html(['pay'], { status: 'PENDING_FINANCE', kind: 'SETTLEMENT', approvedAmount: '5000.00' })).toContain('only if money is paid out');
  });

  it('links a paid advance to settlement and lets Finance record returned cash', () => {
    expect(html(['settle'], { status: 'PAID' })).toContain('href="/finance/new?kind=SETTLEMENT&amp;advanceId=r-1"');
    expect(html(['cashReturn'], { status: 'PAID' })).toContain('name="amount"');
  });

  it('offers a settlement reminder on an overdue advance', () => {
    expect(html(['remind'], { status: 'PAID' })).toContain('Send settlement reminder');
  });

  describe('settling against the advance', () => {
    const settlement = { status: 'PENDING_FINANCE', kind: 'SETTLEMENT', approvedAmount: '7500.00' };

    it('lets Finance take back the unspent balance and close the advance', () => {
      const out = html(['pay'], settlement, 2500);
      expect(out).toContain('still holds <strong>NPR 2,500.00</strong>');
      expect(out).toContain('name="balanceReceived"');
      // The details appear once the box is ticked.
      expect(out).not.toContain('name="mode"');
    });

    it('asks for payment details when the invoices exceed the advance', () => {
      const out = html(['pay'], settlement, -1200);
      expect(out).toContain('excess of <strong>NPR 1,200.00</strong>');
      expect(out).toMatch(/name="mode"[^>]*required|required[^>]*name="mode"/);
      expect(out).not.toContain('name="balanceReceived"');
    });

    it('needs nothing when the invoices match what is outstanding', () => {
      const out = html(['pay'], settlement, 0);
      expect(out).toContain('no money moves');
      expect(out).not.toContain('name="mode"');
    });
  });
});
