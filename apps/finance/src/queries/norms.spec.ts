import { describe, expect, it } from 'vitest';
import { normOf, quantile } from './norms.js';

describe('quantile', () => {
  it('takes the nearest rank', () => {
    const sorted = [100n, 200n, 300n, 400n, 500n];
    expect(quantile(sorted, 0.5)).toBe(300n);
    expect(quantile(sorted, 0.25)).toBe(200n);
    expect(quantile(sorted, 0.75)).toBe(400n);
  });
});

describe('normOf', () => {
  it('needs at least five amounts to say what is usual', () => {
    expect(normOf(['1.00', '2.00', '3.00', '4.00'])).toBeNull();
  });

  it('gives the median and the middle half', () => {
    expect(normOf(['500.00', '100.00', '400.00', '200.00', '300.00'])).toEqual({ median: '300.00', p25: '200.00', p75: '400.00', samples: 5 });
  });
});
