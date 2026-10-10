import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { RequestService } from '../requests/request.service.js';
import { QueryService } from './query.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService;
let approvals: ApprovalService;
let payments: PaymentService;
let queries: QueryService;
let categoryId: string;

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma); payments = new PaymentService(prisma); queries = new QueryService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const raise = async (amount = '1000') => {
  const r = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Travel', amount }, ACTORS.engineer, scopes.project, PROJECT);
  return requests.submit(r.id, ACTORS.engineer);
};
const reimburse = async (amount: string, n: number) => {
  const r = await requests.create({
    kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel',
    invoices: [{ vendor: 'Fuel stop', invoiceNumber: `F-${n}`, invoiceDate: new Date('2026-10-01'), amount }],
  }, ACTORS.engineer, scopes.project, PROJECT);
  return requests.submit(r.id, ACTORS.engineer);
};
const close = async (id: string) => {
  await approvals.approve(id, {}, ACTORS.pm, scopes.project);
  await approvals.approve(id, {}, ACTORS.director, scopes.project);
  await payments.pay(id, { mode: 'CASH', reference: `V-${id.slice(-6)}`, paidOn: new Date() }, ACTORS.finance, scopes.global);
};

describe('decision context', () => {
  it('goes only to the approver at the request’s step', async () => {
    const r = await raise();
    expect(await queries.get(r.id, ACTORS.engineer, scopes.project)).not.toHaveProperty('context');
    expect(await queries.get(r.id, ACTORS.director, scopes.project)).not.toHaveProperty('context');
    const forPm = await queries.get(r.id, ACTORS.pm, scopes.project);
    expect(forPm.context).toEqual({
      requester: { openAdvances: 0, outstanding: '0.00', overdue: 0, oldestOverdueDays: null },
      category: null,
      project: { thisMonth: '0.00', average3: '0.00' },
      flags: [],
    });
  });

  it('tells the approver what the requester already holds, leaving out the advance being settled', async () => {
    const held = await raise('1000'); await close(held.id);
    const settled = await raise('400'); await close(settled.id);
    const s = await requests.create({
      kind: 'SETTLEMENT', advanceId: settled.id, categoryId, purpose: 'Bills',
      invoices: [{ vendor: 'Hotel', invoiceNumber: 'H-7', invoiceDate: new Date('2026-10-01'), amount: '350' }],
    }, ACTORS.engineer, scopes.project);
    await requests.submit(s.id, ACTORS.engineer);
    const detail = await queries.get(s.id, ACTORS.pm, scopes.project);
    expect(detail.context?.requester).toEqual({ openAdvances: 1, outstanding: '1000.00', overdue: 0, oldestOverdueDays: null });
  });

  it('gives the norm for the kind and category once five have closed, and the project’s spend this month', async () => {
    for (let n = 1; n <= 5; n += 1) { const r = await reimburse(String(n * 100), n); await close(r.id); }
    const pending = await reimburse('250', 99);
    const { context } = await queries.get(pending.id, ACTORS.pm, scopes.project);
    expect(context?.category).toEqual({ median: '300.00', p25: '200.00', p75: '400.00', samples: 5 });
    expect(context?.project).toEqual({ thisMonth: '1500.00', average3: '0.00' });
  });
});
