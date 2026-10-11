import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../components/toast', () => ({
  useActionStateWithToast: (_action: unknown, initial: unknown) => [initial, () => undefined],
}));
vi.mock('./actions', () => ({ approveAction: vi.fn(), returnAction: vi.fn(), payAction: vi.fn() }));
vi.mock('react-dom', async (original) => ({ ...(await original<typeof import('react-dom')>()), useFormStatus: () => ({ pending: false }) }));

const { DecisionDialog } = await import('./decision-dialog');

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE', status: 'PENDING_DIRECTOR', purpose: 'Site travel',
  requestedAmount: '50000.00', approvedAmount: null, flags: [], ...over,
}) as never;
const html = (kind: 'approve' | 'return' | 'pay', over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<DecisionDialog request={request(over)} kind={kind} onClose={() => undefined} />);

describe('DecisionDialog', () => {
  it('names the request and posts from the queue', () => {
    const out = html('approve');
    expect(out).toContain('role="dialog"');
    expect(out).toContain('ADV-2026-0007');
    expect(out).toContain('Site travel');
    expect(out).toContain('NPR 50,000.00');
    expect(out).toContain('name="from" value="queue"');
    expect(out).toContain('name="id" value="r-1"');
  });

  it('is named by its title and the request reference', () => {
    const out = html('approve');
    expect(out).toContain('aria-labelledby="fin-dialog-title-r-1 fin-dialog-title-r-1-ref"');
    expect(out).toContain('<h2 id="fin-dialog-title-r-1">');
    expect(out).toMatch(/<p class="eyebrow" id="fin-dialog-title-r-1-ref">ADVANCE/);
  });

  it('lets only the director trim the amount', () => {
    expect(html('approve')).toContain('name="amount"');
    expect(html('approve', { status: 'PENDING_PM' })).not.toContain('name="amount"');
  });

  it('requires a reason to return', () => {
    const out = html('return');
    expect(out).toMatch(/<textarea[^>]*name="comment"[^>]*required/);
    expect(out).toContain('Return to requester');
  });

  it('asks for payment details when money moves, and not for a settlement', () => {
    expect(html('pay', { status: 'PENDING_FINANCE' })).toMatch(/<select[^>]*name="mode"[^>]*required/);
    expect(html('pay', { status: 'PENDING_FINANCE', kind: 'SETTLEMENT' })).not.toMatch(/<select[^>]*name="mode"[^>]*required/);
  });

  it('shows the row’s warnings above the fields', () => {
    expect(html('approve', { flags: ['Possible duplicate: Fuel stop on ADV-2026-0003'] })).toContain('Possible duplicate: Fuel stop on ADV-2026-0003');
  });
});
