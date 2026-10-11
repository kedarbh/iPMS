import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('./decision-dialog', () => ({ DecisionDialog: () => null }));

const { QueueTable } = await import('./queue-table');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', number: 'ADV-2026-0007', kind: 'ADVANCE', status: 'PENDING_PM', revision: 1, entryStatus: 'PENDING_PM',
  projectId: 'p-1', projectCode: 'NP004', projectName: 'Pokhara Hydro Retrofit', workOrderId: null, categoryId: 'c-1',
  requesterId: 'u-eng', advanceId: null, purpose: 'Taxi to Pokhara', requestedAmount: '2400.00', approvedAmount: null,
  appliedAmount: null, submittedAt: '2026-10-05T08:00:00Z', createdAt: '2026-10-05T07:00:00Z', updatedAt: '2026-10-07T08:00:00Z',
  category: { code: 'TRAVEL', name: 'Travel' }, ...over,
});
const PM = ['finance_approval.pm'];
const NOW = '2026-10-10T08:00:00Z';
const html = (items: unknown[], permissions = PM) =>
  renderToStaticMarkup(<QueueTable items={items as never} names={{ 'u-eng': 'Bikash Tamang' }} permissions={permissions} now={NOW} />);

describe('QueueTable', () => {
  it('shows the request, who, where, how much and how long', () => {
    const out = html([row()]);
    expect(out).toContain('href="/finance/requests/r-1"');
    expect(out).toContain('ADV-2026-0007');
    expect(out).toContain('Taxi to Pokhara');
    expect(out).toContain('Bikash Tamang');
    expect(out).toContain('BT');
    expect(out).toContain('NP004');
    expect(out).toContain('NPR 2,400.00');
    expect(out).toContain('3 days');
    expect(out).toContain('amber');
  });

  it('offers Approve and Return at the viewer’s step, and Pay at finance', () => {
    const pm = html([row()]);
    expect(pm).toContain('>Approve<');
    expect(pm).toContain('>Return<');
    const fin = html([row({ status: 'PENDING_FINANCE' })], ['finance_payment.record']);
    expect(fin).toContain('>Pay<');
    expect(fin).not.toContain('>Approve<');
  });

  it('offers no buttons for a step the viewer does not hold', () => {
    const out = html([row({ status: 'PENDING_DIRECTOR' })]);
    expect(out).not.toContain('>Approve<');
    expect(out).not.toContain('>Return<');
  });

  it('shows the warnings a row carries', () => {
    expect(html([row({ flags: [{ code: 'WAITING_LONG', tone: 'amber', days: 5 }] })])).toContain('Waiting 5 days');
  });

  it('says the queue is clear when empty', () => {
    expect(html([])).toContain('Nothing waits on you.');
  });
});
