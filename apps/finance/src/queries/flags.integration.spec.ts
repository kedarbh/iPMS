import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthzScope } from '@ipms/authz';
import type { RequestFlag } from '@ipms/contracts';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, OTHER_PROJECT, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { RequestService } from '../requests/request.service.js';
import { requestFlags } from './flags.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService;
let approvals: ApprovalService;
let payments: PaymentService;
let categoryId: string;
const DAY = 86_400_000;
const NOW = new Date('2026-10-10T06:00:00Z');

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma); payments = new PaymentService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const scopeOf = (project: typeof PROJECT) => (project.id === PROJECT.id ? scopes.project : scopes.otherProject);
const advance = async (amount = '1000', requester = ACTORS.engineer, project = PROJECT) => {
  const r = await requests.create({ kind: 'ADVANCE', projectId: project.id, categoryId, purpose: 'Travel', amount }, requester, scopeOf(project), project);
  return requests.submit(r.id, requester);
};
const reimbursement = async (amount: string, invoice: { vendor: string; invoiceNumber?: string; invoiceDate?: Date }, requester = ACTORS.engineer, project = PROJECT) => {
  const r = await requests.create({
    kind: 'REIMBURSEMENT', projectId: project.id, categoryId, purpose: 'Fuel',
    invoices: [{ vendor: invoice.vendor, ...(invoice.invoiceNumber ? { invoiceNumber: invoice.invoiceNumber } : {}), invoiceDate: invoice.invoiceDate ?? new Date('2026-10-01'), amount }],
  }, requester, scopeOf(project), project);
  return requests.submit(r.id, requester);
};
/** Approves in the project's own scope and has Finance pay with global scope, as in production. */
const close = async (id: string, paidOn = new Date('2026-10-09'), project = PROJECT) => {
  await approvals.approve(id, {}, ACTORS.pm, scopeOf(project));
  await approvals.approve(id, {}, ACTORS.director, scopeOf(project));
  await payments.pay(id, { mode: 'CASH', reference: `V-${id.slice(-6)}`, paidOn }, ACTORS.finance, scopes.global);
};
const flagsFor = async (id: string, now = NOW, scope: AuthzScope = scopes.project): Promise<RequestFlag[]> => {
  const row = await prisma.financeRequest.findUniqueOrThrow({ where: { id }, include: { category: { select: { name: true } } } });
  return (await requestFlags(prisma, [row], scope, now)).get(id) ?? [];
};

describe('requestFlags', () => {
  it('flags nothing on a fresh request from someone holding no cash', async () => {
    const r = await advance();
    expect(await flagsFor(r.id)).toEqual([]);
  });

  it('says when the requester already holds unsettled cash, red once an advance is overdue', async () => {
    const fresh = await advance('1000'); await close(fresh.id, new Date('2026-10-09'));
    const next = await advance('300');
    expect(await flagsFor(next.id)).toEqual([{ code: 'REQUESTER_HOLDS_CASH', tone: 'amber', outstanding: '1000.00', advances: 1, overdue: 0, oldestOverdueDays: null }]);

    const late = await advance('1000'); await close(late.id, new Date('2026-09-30'));
    expect(await flagsFor(next.id)).toEqual([{ code: 'REQUESTER_HOLDS_CASH', tone: 'red', outstanding: '2000.00', advances: 2, overdue: 1, oldestOverdueDays: 3 }]);
  });

  it('leaves out the advance a settlement settles', async () => {
    const a = await advance('1000'); await close(a.id);
    const s = await requests.create({
      kind: 'SETTLEMENT', advanceId: a.id, categoryId, purpose: 'Bills',
      invoices: [{ vendor: 'Hotel', invoiceNumber: 'H-1', invoiceDate: new Date('2026-10-01'), amount: '500' }],
    }, ACTORS.engineer, scopes.project);
    await requests.submit(s.id, ACTORS.engineer);
    expect((await flagsFor(s.id)).map((f) => f.code)).not.toContain('REQUESTER_HOLDS_CASH');
  });

  it('flags an amount over twice the usual for its kind and category, once five have closed', async () => {
    for (let n = 1; n <= 4; n += 1) { const r = await reimbursement('1000', { vendor: 'Fuel stop', invoiceNumber: `F-${n}` }); await close(r.id); }
    const big = await reimbursement('2500', { vendor: 'Fuel stop', invoiceNumber: 'F-99' });
    expect((await flagsFor(big.id)).map((f) => f.code)).not.toContain('UNUSUAL_AMOUNT');

    const fifth = await reimbursement('1000', { vendor: 'Fuel stop', invoiceNumber: 'F-5' }); await close(fifth.id);
    expect(await flagsFor(big.id)).toContainEqual({ code: 'UNUSUAL_AMOUNT', tone: 'amber', ratio: 2.5, median: '1000.00', category: expect.any(String) });
  });

  it('does not count cash the requester holds on a project outside the caller\'s scope', async () => {
    const elsewhere = await advance('1000', ACTORS.engineer, OTHER_PROJECT); await close(elsewhere.id, new Date('2026-10-09'), OTHER_PROJECT);
    const pending = await advance('300');
    expect(await flagsFor(pending.id)).toEqual([]);
    // The same advance is counted for a caller who can see its project, so the empty list above is the scope at work.
    expect((await flagsFor(pending.id, NOW, scopes.global)).map((f) => f.code)).toContain('REQUESTER_HOLDS_CASH');
  });

  it('does not take the usual amount from requests outside the caller\'s scope', async () => {
    for (let n = 1; n <= 5; n += 1) {
      const r = await reimbursement('1000', { vendor: 'Fuel stop', invoiceNumber: `OP-${n}` }, ACTORS.engineer, OTHER_PROJECT);
      await close(r.id, new Date('2026-10-09'), OTHER_PROJECT);
    }
    const big = await reimbursement('2500', { vendor: 'Fuel stop', invoiceNumber: 'IP-99' });
    expect((await flagsFor(big.id)).map((f) => f.code)).not.toContain('UNUSUAL_AMOUNT');
    expect((await flagsFor(big.id, NOW, scopes.global)).map((f) => f.code)).toContain('UNUSUAL_AMOUNT');
  });

  it('flags a bill already on another live request in scope, and not one outside it', async () => {
    const first = await reimbursement('750', { vendor: 'Hardware' });
    const second = await reimbursement('750', { vendor: 'Hardware' }, ACTORS.otherEngineer);
    expect(await flagsFor(second.id)).toContainEqual({ code: 'DUPLICATE_BILL', tone: 'red', matches: [{ requestId: first.id, number: first.number, vendor: 'Hardware', invoiceNumber: null }] });

    await resetDb(prisma);
    await reimbursement('750', { vendor: 'Hardware' }, ACTORS.otherEngineer, OTHER_PROJECT);
    const mine = await reimbursement('750', { vendor: 'Hardware' });
    expect((await flagsFor(mine.id)).map((f) => f.code)).not.toContain('DUPLICATE_BILL');
  });

  it('flags a long wait at the current step', async () => {
    const r = await advance();
    await prisma.$executeRaw`UPDATE "finance_request" SET "updatedAt" = ${new Date(Date.now() - 5 * DAY)} WHERE "id" = ${r.id}::uuid`;
    expect(await flagsFor(r.id, new Date())).toEqual([{ code: 'WAITING_LONG', tone: 'amber', days: 5 }]);
  });

  it('counts the wait in Kathmandu calendar days, as the page does', async () => {
    const r = await advance();
    // 22:45 on 6 Oct in Kathmandu: 3.5 days (84 hours) before NOW, which is 11:45 on 10 Oct, but 4 calendar days.
    await prisma.$executeRaw`UPDATE "finance_request" SET "updatedAt" = ${new Date('2026-10-06T17:00:00Z')} WHERE "id" = ${r.id}::uuid`;
    expect(await flagsFor(r.id)).toContainEqual({ code: 'WAITING_LONG', tone: 'amber', days: 4 });
  });

  it('flags only requests that are waiting for someone', async () => {
    const paid = await advance(); await close(paid.id);
    expect(await flagsFor(paid.id)).toEqual([]);
  });
});
