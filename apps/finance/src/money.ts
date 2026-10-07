/**
 * NPR amounts are strings ("1500.50"). All arithmetic goes through integer
 * paisa so no float ever touches a balance. Inputs are trusted to be at most
 * two decimals: the contracts' MoneySchema enforces that at the edge, and
 * Prisma returns Decimal(14,2), formatted with toFixed(2).
 */

export function toMinor(amount: string): bigint {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? amount.slice(1) : amount).split('.');
  const minor = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -minor : minor;
}

export function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const text = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

export const sumMoney = (values: string[]): string => fromMinor(values.reduce((total, v) => total + toMinor(v), 0n));
export const subMoney = (a: string, b: string): string => fromMinor(toMinor(a) - toMinor(b));

export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const diff = toMinor(a) - toMinor(b);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

/**
 * The VAT inside an amount that includes it: amount × 13 / 113, to the paisa,
 * halves rounding up. Integer arithmetic throughout, like every other figure.
 */
export function vatIncluded(amount: string, ratePercent = 13): string {
  const rate = BigInt(ratePercent);
  const minor = toMinor(amount);
  return fromMinor((minor * rate * 2n + (100n + rate)) / ((100n + rate) * 2n));
}

export const minMoney = (a: string, b: string): string => (compareMoney(a, b) <= 0 ? fromMinor(toMinor(a)) : fromMinor(toMinor(b)));
