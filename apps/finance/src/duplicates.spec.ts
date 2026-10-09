import { describe, expect, it } from 'vitest';
import { compareBills, findDuplicates, repeatsWithin, sameNumberingYear } from './duplicates.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const mine = { vendor: 'Himal Fuel', invoiceNumber: '17', invoiceDate: d('2026-10-01'), amount: '1500.00' };
const other = (o: object = {}) => ({ vendor: 'himal  fuel ', invoiceNumber: '17', invoiceDate: d('2026-09-01'), amount: '900.00', ...o });

describe('sameNumberingYear', () => {
  it('follows the Nepali fiscal year, which turns over in mid-July', () => {
    expect(sameNumberingYear(d('2026-08-01'), d('2026-10-01'))).toBe(true);
    expect(sameNumberingYear(d('2026-08-01'), d('2027-07-01'))).toBe(true); // across New Year, same fiscal year
    expect(sameNumberingYear(d('2026-06-01'), d('2026-08-01'))).toBe(false);
    expect(sameNumberingYear(d('2025-10-01'), d('2026-10-01'))).toBe(false);
  });
});

describe('compareBills', () => {
  it('matches a vendor\'s number in the same year, ignoring case, spacing and the amount', () => {
    expect(compareBills(mine, other())).toBe('SAME_NUMBER');
    expect(compareBills({ ...mine, invoiceNumber: ' 17 ' }, other({ invoiceNumber: '17' }))).toBe('SAME_NUMBER');
  });
  it('does not block a number that has restarted in a new year', () => {
    expect(compareBills(mine, other({ invoiceDate: d('2025-10-01') }))).toBe('NUMBER_OTHER_YEAR');
  });
  it('does not match another vendor with the same number', () => {
    expect(compareBills(mine, other({ vendor: 'Everest Hardware' }))).toBeNull();
  });
  it('flags the same vendor, day and amount when there is no number to go by', () => {
    const bare = { ...mine, invoiceNumber: null };
    expect(compareBills(bare, other({ invoiceNumber: null, invoiceDate: d('2026-10-01'), amount: '1500.00' }))).toBe('SAME_BILL');
    expect(compareBills(bare, other({ invoiceNumber: null, invoiceDate: d('2026-10-02'), amount: '1500.00' }))).toBeNull();
  });
});

describe('repeatsWithin', () => {
  it('finds one bill listed twice on a request', () => {
    expect(repeatsWithin([mine, { ...mine, amount: '10.00' }])).toBe(mine);
    expect(repeatsWithin([mine, { ...mine, invoiceNumber: '18' }])).toBeNull();
  });
});

describe('findDuplicates', () => {
  const row = (o: object = {}) => ({ vendor: 'Himal Fuel', invoiceNumber: '17', invoiceDate: d('2026-09-01'), amount: { toFixed: () => '900.00' }, request: { id: 'r-9', number: 'SET-2026-0009', status: 'PAID' }, ...o });
  const prisma = (rows: unknown[]) => ({ requestInvoice: { findMany: async () => rows } }) as never;

  it('reports each other request once, a reused number first', async () => {
    const hits = await findDuplicates(prisma([row(), row({ invoiceNumber: null, invoiceDate: d('2026-10-01'), amount: { toFixed: () => '1500.00' }, request: { id: 'r-8', number: 'REI-1', status: 'PENDING_PM' } })]), 'r-1', [mine]);
    expect(hits.map((h) => [h.number, h.reason])).toEqual([['SET-2026-0009', 'SAME_NUMBER'], ['REI-1', 'SAME_BILL']]);
  });
  it('has nothing to say about a request without bills', async () => {
    expect(await findDuplicates(prisma([row()]), 'r-1', [])).toEqual([]);
  });
});
