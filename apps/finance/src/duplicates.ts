import type { PrismaClient } from '@prisma-clients/finance';

/** Requests that no longer claim anything: a bill on one of these may be claimed again. */
const DEAD = ['CANCELLED', 'REJECTED'];

export interface BillKey {
  vendor: string;
  invoiceNumber?: string | null;
  invoiceDate: Date;
  amount: string;
}

export interface DuplicateHit {
  requestId: string;
  number: string;
  status: string;
  vendor: string;
  invoiceNumber: string | null;
  /** SAME_NUMBER: the same vendor's number in the same year. SAME_BILL: no number to go by, but vendor, date and amount agree. */
  reason: 'SAME_NUMBER' | 'SAME_BILL' | 'NUMBER_OTHER_YEAR';
}

export const normVendor = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
export const normNumber = (n?: string | null) => (n ?? '').trim().toUpperCase().replace(/\s+/g, '');

/** Mid-July, when the Nepali fiscal year (Shrawan 1, the 16th or 17th) begins. */
const FISCAL_START = { month: 6, day: 16 };

function fiscalYear(d: Date): number {
  const afterStart = d.getUTCMonth() > FISCAL_START.month || (d.getUTCMonth() === FISCAL_START.month && d.getUTCDate() >= FISCAL_START.day);
  return afterStart ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

/** Whether two bill dates fall in the same fiscal year, which is when suppliers restart their invoice numbers at 1. */
export function sameNumberingYear(a: Date, b: Date): boolean {
  return fiscalYear(a) === fiscalYear(b);
}

type Bill = { vendor: string; invoiceNumber: string | null; invoiceDate: Date; amount: { toFixed(d: number): string } | string };
const amountOf = (b: Bill) => (typeof b.amount === 'string' ? b.amount : b.amount.toFixed(2));

/** How [other] relates to [mine], or null if it does not. */
export function compareBills(mine: BillKey, other: Bill): DuplicateHit['reason'] | null {
  if (normVendor(mine.vendor) !== normVendor(other.vendor)) return null;
  const number = normNumber(mine.invoiceNumber);
  if (number && number === normNumber(other.invoiceNumber)) {
    return sameNumberingYear(mine.invoiceDate, other.invoiceDate) ? 'SAME_NUMBER' : 'NUMBER_OTHER_YEAR';
  }
  const sameDay = mine.invoiceDate.getTime() === other.invoiceDate.getTime();
  if (sameDay && Number(mine.amount) === Number(amountOf(other))) return 'SAME_BILL';
  return null;
}

/** Bills in [mine] that repeat one another, which no second request is needed to be wrong. */
export function repeatsWithin(mine: readonly BillKey[]): BillKey | null {
  for (let i = 0; i < mine.length; i += 1) {
    for (let j = i + 1; j < mine.length; j += 1) {
      const a = mine[i]!;
      const b = mine[j]!;
      if (compareBills(a, { ...b, invoiceNumber: b.invoiceNumber ?? null }) === 'SAME_NUMBER') return a;
    }
  }
  return null;
}

/** Other live requests (anyone's) whose bills match any of [bills]. */
export async function findDuplicates(prisma: Pick<PrismaClient, 'requestInvoice'>, requestId: string, bills: readonly BillKey[]): Promise<DuplicateHit[]> {
  if (bills.length === 0) return [];
  const numbers = [...new Set(bills.map((b) => b.invoiceNumber?.trim()).filter((n): n is string => !!n))];
  const days = [...new Map(bills.map((b) => [b.invoiceDate.getTime(), b.invoiceDate])).values()];
  const rows = await prisma.requestInvoice.findMany({
    where: {
      requestId: { not: requestId },
      request: { status: { notIn: DEAD } },
      // Only a number or a day can make two bills alike; vendors are compared, spelling-tolerantly, below.
      OR: [...(numbers.length > 0 ? [{ invoiceNumber: { in: numbers, mode: 'insensitive' as const } }] : []), { invoiceDate: { in: days } }],
    },
    select: { vendor: true, invoiceNumber: true, invoiceDate: true, amount: true, request: { select: { id: true, number: true, status: true } } },
  });
  const hits = new Map<string, DuplicateHit>();
  const rank = { SAME_NUMBER: 0, SAME_BILL: 1, NUMBER_OTHER_YEAR: 2 } as const;
  for (const mine of bills) {
    for (const other of rows) {
      const reason = compareBills(mine, other);
      if (!reason) continue;
      const key = `${other.request.id}:${reason}`;
      if (hits.has(key)) continue;
      hits.set(key, { requestId: other.request.id, number: other.request.number, status: other.request.status, vendor: other.vendor, invoiceNumber: other.invoiceNumber, reason });
    }
  }
  return [...hits.values()].sort((a, b) => rank[a.reason] - rank[b.reason]);
}
