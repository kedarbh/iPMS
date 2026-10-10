import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DecisionContext } from '@ipms/contracts';
import { ContextPanel } from './context-panel';

const context = (over: Partial<DecisionContext> = {}): DecisionContext => ({
  requester: { openAdvances: 0, outstanding: '0.00', overdue: 0, oldestOverdueDays: null },
  category: null,
  project: { thisMonth: '120000.00', average3: '80000.00' },
  flags: [],
  ...over,
});
const html = (c: DecisionContext) => renderToStaticMarkup(<ContextPanel context={c} category="Fuel" project="Koshi Rollout" />);

describe('ContextPanel', () => {
  it('says what the requester holds, what is usual and how the project is spending', () => {
    const out = html(context({
      requester: { openAdvances: 2, outstanding: '45000.00', overdue: 1, oldestOverdueDays: 9 },
      category: { median: '3000.00', p25: '2000.00', p75: '4500.00', samples: 12 },
    }));
    expect(out).toContain('Before you decide');
    expect(out).toContain('Holds NPR 45,000.00 from 2 open advances, 1 overdue (oldest 9 days).');
    expect(out).toContain('NPR 2,000.00 to NPR 4,500.00, median NPR 3,000.00 (12 requests in 180 days).');
    expect(out).toContain('NPR 1,20,000.00 spent; NPR 80,000.00 a month on average over the 3 months before.');
  });

  it('says plainly when there is nothing to compare, and lists flags first', () => {
    const out = html(context({ flags: [{ code: 'WAITING_LONG', tone: 'amber', days: 4 }] }));
    expect(out).toContain('Holds no unsettled advances.');
    expect(out).toContain('Too few closed requests like this to compare.');
    expect(out.indexOf('Waiting 4 days')).toBeLessThan(out.indexOf('Requester'));
  });
});
