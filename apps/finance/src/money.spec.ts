import { describe, expect, it } from 'vitest';
import { compareMoney, fromMinor, minMoney, subMoney, sumMoney, toMinor, vatIncluded } from './money.js';

describe('money', () => {
  it('converts to integer paisa without floating point', () => {
    expect(toMinor('1500.50')).toBe(150050n);
    expect(toMinor('0.1')).toBe(10n);
    expect(toMinor('7')).toBe(700n);
    expect(toMinor('19.99')).toBe(1999n);
  });

  it('formats back to two decimals', () => {
    expect(fromMinor(150050n)).toBe('1500.50');
    expect(fromMinor(5n)).toBe('0.05');
    expect(fromMinor(0n)).toBe('0.00');
    expect(fromMinor(-250n)).toBe('-2.50');
  });

  it('sums exactly where floats would drift', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney([])).toBe('0.00');
    expect(sumMoney(['1000', '250.75', '0.25'])).toBe('1251.00');
  });

  it('subtracts, compares and takes the lesser', () => {
    expect(subMoney('100.00', '33.33')).toBe('66.67');
    expect(compareMoney('10.00', '10')).toBe(0);
    expect(compareMoney('9.99', '10')).toBe(-1);
    expect(compareMoney('10.01', '10')).toBe(1);
    expect(minMoney('5.00', '4.99')).toBe('4.99');
  });
});

describe('vatIncluded', () => {
  it('is the 13% inside an amount that already includes it', () => {
    expect(vatIncluded('113')).toBe('13.00');
    expect(vatIncluded('15000')).toBe('1725.66');
    expect(vatIncluded('2250')).toBe('258.85');
  });

  it('rounds halves up to the paisa', () => {
    expect(vatIncluded('0.01')).toBe('0.00');
    expect(vatIncluded('0.50')).toBe('0.06');
    expect(vatIncluded('1')).toBe('0.12');
  });

  it('is zero for nothing, and takes another rate', () => {
    expect(vatIncluded('0')).toBe('0.00');
    expect(vatIncluded('110', 10)).toBe('10.00');
  });
});
