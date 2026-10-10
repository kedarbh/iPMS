import { describe, expect, it } from 'vitest';
import { resolveSearch } from './search';

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
