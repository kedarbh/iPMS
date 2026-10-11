import { describe, expect, it } from 'vitest';
import { historyHref, legacyTarget, queueHref, rawFilters, resolveHistory, resolveSearch } from './search';

const ENG = { mayAct: false, seeAll: false, mayRaise: true };
const PM = { mayAct: true, seeAll: false, mayRaise: true };
const FIN = { mayAct: true, seeAll: true, mayRaise: false };
const PM_ALL = { mayAct: true, seeAll: true, mayRaise: true };

describe('resolveSearch', () => {
  it('only offers the tabs the viewer may use', () => {
    expect(resolveSearch({}, ENG).tabs).toEqual(['mine']);
    expect(resolveSearch({}, PM).tabs).toEqual(['awaiting', 'mine']);
    expect(resolveSearch({}, FIN).tabs).toEqual(['awaiting', 'handled', 'all']);
    expect(resolveSearch({}, PM_ALL).tabs).toEqual(['awaiting', 'handled', 'mine', 'all']);
  });

  it('opens Decided by me for an approver who sees every request', () => {
    expect(resolveSearch({ view: 'handled' }, FIN).view).toBe('handled');
    expect(resolveSearch({ view: 'handled' }, PM).view).toBe('awaiting');
  });

  it('falls back to mine when an engineer asks for a view they may not use', () => {
    expect(resolveSearch({ view: 'all' }, ENG).view).toBe('mine');
    expect(resolveSearch({ view: 'awaiting' }, ENG).view).toBe('mine');
    expect(resolveSearch({ view: 'nonsense' }, ENG).view).toBe('mine');
  });

  it('defaults to awaiting for someone with a step permission, and honours permitted views', () => {
    expect(resolveSearch({}, PM).view).toBe('awaiting');
    expect(resolveSearch({ view: 'mine' }, PM).view).toBe('mine');
    expect(resolveSearch({ view: 'all' }, PM).view).toBe('awaiting');
    expect(resolveSearch({ view: 'all' }, FIN).view).toBe('all');
  });

  it('drops a status or kind that is not in the enum', () => {
    const r = resolveSearch({ status: 'BOGUS', kind: 'LOAN' }, FIN);
    expect(r).not.toHaveProperty('status');
    expect(r).not.toHaveProperty('kind');
    const ok = resolveSearch({ status: 'PENDING_PM', kind: 'SETTLEMENT' }, FIN);
    expect(ok.status).toBe('PENDING_PM');
    expect(ok.kind).toBe('SETTLEMENT');
  });

  it('turns the page into a whole number of at least 1', () => {
    expect(resolveSearch({}, ENG).page).toBe(1);
    expect(resolveSearch({ page: '3' }, ENG).page).toBe(3);
    expect(resolveSearch({ page: '1.5' }, ENG).page).toBe(1);
    expect(resolveSearch({ page: 'x' }, ENG).page).toBe(1);
    expect(resolveSearch({ page: '-3' }, ENG).page).toBe(1);
    expect(resolveSearch({ page: '0' }, ENG).page).toBe(1);
  });
});

describe('resolveHistory', () => {
  const caps = { mayAct: true, seeAll: true };
  it('shows everything to a viewer who sees all, and only their own to the rest', () => {
    expect(resolveHistory({}, caps)).toMatchObject({ view: 'all', pill: 'all', page: 1 });
    expect(resolveHistory({}, { mayAct: false, seeAll: false })).toMatchObject({ view: 'mine' });
  });
  it('maps a pill onto the service filters', () => {
    expect(resolveHistory({ filter: 'approval' }, caps)).toMatchObject({ pill: 'approval', stage: 'approval' });
    expect(resolveHistory({ filter: 'closed' }, caps)).toMatchObject({ stage: 'closed' });
    expect(resolveHistory({ filter: 'returned' }, caps)).toMatchObject({ status: 'RETURNED' });
  });
  it('offers decided-by-me only to approvers who see all', () => {
    expect(resolveHistory({ filter: 'handled' }, caps)).toMatchObject({ view: 'handled', pill: 'handled' });
    expect(resolveHistory({ filter: 'handled' }, { mayAct: false, seeAll: true })).toMatchObject({ view: 'all', pill: 'all' });
  });
  it('keeps the old view, status and kind params and a text query', () => {
    expect(resolveHistory({ view: 'mine', status: 'PENDING_DIRECTOR', kind: 'ADVANCE', q: ' ADV-2026 ', page: '3' }, caps))
      .toMatchObject({ view: 'mine', pill: 'mine', status: 'PENDING_DIRECTOR', kind: 'ADVANCE', q: 'ADV-2026', page: 3 });
    expect(resolveHistory({ view: 'all' }, { mayAct: false, seeAll: false })).toMatchObject({ view: 'mine' });
    expect(resolveHistory({ view: 'handled' }, caps)).toMatchObject({ view: 'handled', pill: 'handled' });
  });
  it('ignores repeated params, the queue view and unknown filters', () => {
    const out = resolveHistory({ q: ['a', 'b'] as never, filter: ['x'] as never }, caps);
    expect(out).toMatchObject({ view: 'all', pill: 'all' });
    expect(out).not.toHaveProperty('q');
    expect(resolveHistory({ view: 'awaiting' }, caps)).toMatchObject({ view: 'all', pill: 'all' });
    expect(resolveHistory({ filter: 'nonsense' }, caps)).toMatchObject({ pill: 'all' });
    expect(resolveHistory({ filter: 'mine' }, { mayAct: false, seeAll: false })).toMatchObject({ view: 'mine', pill: 'all' });
  });
});

describe('historyHref', () => {
  it('keeps only what is set', () => {
    expect(historyHref({})).toBe('/finance/history');
    expect(historyHref({ filter: 'approval', q: 'fuel', page: 2 })).toBe('/finance/history?filter=approval&q=fuel&page=2');
    expect(historyHref({ filter: 'all' })).toBe('/finance/history');
  });
});

describe('queueHref', () => {
  it('keeps only what is set, and omits page 1', () => {
    expect(queueHref({})).toBe('/finance/queue');
    expect(queueHref({ kind: 'ADVANCE' })).toBe('/finance/queue?kind=ADVANCE');
    expect(queueHref({ kind: 'ADVANCE', page: 1 })).toBe('/finance/queue?kind=ADVANCE');
    expect(queueHref({ kind: 'ADVANCE', page: 2 })).toBe('/finance/queue?kind=ADVANCE&page=2');
    expect(queueHref({ page: 3 })).toBe('/finance/queue?page=3');
  });
});

describe('rawFilters', () => {
  const caps = { mayAct: true, seeAll: true };
  it('is empty when the status comes from a pill', () => {
    expect(rawFilters(resolveHistory({ filter: 'returned' }, caps))).toEqual({});
    expect(rawFilters(resolveHistory({}, caps))).toEqual({});
  });
  it('reports a status that came from the URL', () => {
    expect(rawFilters(resolveHistory({ status: 'PENDING_PM' }, caps))).toEqual({ status: 'PENDING_PM' });
    expect(rawFilters(resolveHistory({ view: 'all', status: 'PAID' }, caps))).toEqual({ status: 'PAID' });
  });
  it('reports a kind', () => {
    expect(rawFilters(resolveHistory({ kind: 'ADVANCE' }, caps))).toEqual({ kind: 'ADVANCE' });
    expect(rawFilters(resolveHistory({ filter: 'rejected', kind: 'SETTLEMENT' }, caps))).toEqual({ kind: 'SETTLEMENT' });
  });
});

describe('legacyTarget', () => {
  it('sends the old awaiting view to the queue and other views to history', () => {
    expect(legacyTarget({})).toBeNull();
    expect(legacyTarget({ view: 'awaiting' })).toBe('/finance/queue');
    expect(legacyTarget({ view: 'awaiting', kind: 'ADVANCE' })).toBe('/finance/queue?kind=ADVANCE');
    expect(legacyTarget({ view: 'awaiting', decided: 'r-1' })).toBe('/finance/queue?decided=r-1');
    expect(legacyTarget({ view: 'handled' })).toBe('/finance/history?view=handled');
    expect(legacyTarget({ view: 'all', status: 'PAID', page: '2' })).toBe('/finance/history?view=all&status=PAID&page=2');
  });
});
