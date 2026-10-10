import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, OTHER_PROJECT, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { RequestService } from '../requests/request.service.js';
import { OverviewService } from './overview.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService;
let approvals: ApprovalService;
let payments: PaymentService;
let overviews: OverviewService;
let categoryId: string;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-10-10T06:00:00Z');

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma); approvals = new ApprovalService(prisma); payments = new PaymentService(prisma); overviews = new OverviewService(prisma);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const raise = async (requester = ACTORS.engineer, amount = '1000', project = PROJECT) => {
  const scope = project.id === PROJECT.id ? scopes.project : scopes.otherProject;
  const r = await requests.create({ kind: 'ADVANCE', projectId: project.id, categoryId, purpose: 'Travel', amount }, requester, scope, project);
  return requests.submit(r.id, requester);
};
const reimburse = async (amount: string, n: number) => {
  const r = await requests.create({
    kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel',
    invoices: [{ vendor: 'Fuel stop', invoiceNumber: `F-${n}`, invoiceDate: new Date('2026-09-25'), amount }],
  }, ACTORS.engineer, scopes.project, PROJECT);
  return requests.submit(r.id, ACTORS.engineer);
};
const throughDirector = async (id: string, amount?: string) => {
  await approvals.approve(id, {}, ACTORS.pm, scopes.project);
  await approvals.approve(id, amount ? { amount } : {}, ACTORS.director, scopes.project);
};
const pay = (id: string, paidOn = new Date('2026-10-09')) =>
  payments.pay(id, { mode: 'CASH', reference: `V-${id.slice(-6)}`, paidOn }, ACTORS.finance, scopes.global);
const setUpdatedAt = (id: string, at: Date) => prisma.$executeRaw`UPDATE "finance_request" SET "updatedAt" = ${at} WHERE "id" = ${id}::uuid`;
const setActionAt = (id: string, step: string, action: string, at: Date) =>
  prisma.$executeRaw`UPDATE "approval_action" SET "at" = ${at} WHERE "requestId" = ${id}::uuid AND "step" = ${step} AND "action" = ${action}`;

describe('OverviewService', () => {
  it('refuses a caller without view_all', async () => {
    await expect(overviews.overview(ACTORS.engineer, scopes.project)).rejects.toThrow(/view_all/);
  });

  it('counts each pending step and marks the caller’s own', async () => {
    await raise(ACTORS.engineer, '1000');
    await raise(ACTORS.pm, '2500');
    const ready = await raise(ACTORS.engineer, '400');
    await throughDirector(ready.id);
    const { pipeline } = await overviews.overview(ACTORS.director, scopes.project);
    expect(pipeline.steps).toEqual([
      { status: 'PENDING_PM', count: 1, amount: '1000.00', oldestSince: expect.any(String), mine: false },
      { status: 'PENDING_DIRECTOR', count: 1, amount: '2500.00', oldestSince: expect.any(String), mine: true },
      { status: 'PENDING_FINANCE', count: 1, amount: '400.00', oldestSince: expect.any(String), mine: false },
    ]);
  });

  it('leaves the caller’s own requests out of their step and their queue', async () => {
    const both = { id: ACTORS.pm.id, permissions: [...ACTORS.pm.permissions, 'finance_approval.director'] };
    await raise(ACTORS.pm, '700');
    const theirs = await raise(ACTORS.otherPm, '300');
    const view = await overviews.overview(both, scopes.project);
    expect(view.pipeline.steps.find((s) => s.status === 'PENDING_DIRECTOR')).toMatchObject({ count: 1, amount: '300.00', mine: true });
    expect(view.queue.map((q) => q.id)).toEqual([theirs.id]);
  });

  it('queues the five longest waiting at the caller’s step, oldest first, with flags', async () => {
    const raised = [];
    for (let i = 0; i < 6; i += 1) raised.push(await raise(ACTORS.pm, '100'));
    await setUpdatedAt(raised[3]!.id, new Date(Date.now() - 5 * DAY));
    const { queue } = await overviews.overview(ACTORS.director, scopes.project);
    expect(queue).toHaveLength(5);
    expect(queue[0]).toMatchObject({ id: raised[3]!.id, kind: 'ADVANCE', amount: '100.00', flags: [{ code: 'WAITING_LONG', tone: 'amber', days: 5 }] });
  });

  it('files spend under the month Finance closed it, in Kathmandu time', async () => {
    const october = await reimburse('600', 1); await throughDirector(october.id); await pay(october.id);
    const september = await reimburse('250', 2); await throughDirector(september.id); await pay(september.id);
    await setActionAt(october.id, 'FINANCE', 'PAID', new Date('2026-09-30T19:00:00Z'));   // 00:45 on 1 Oct in Kathmandu
    await setActionAt(september.id, 'FINANCE', 'PAID', new Date('2026-09-30T18:00:00Z')); // 23:45 on 30 Sep
    const view = await overviews.overview(ACTORS.director, scopes.project, NOW);
    expect(view.months).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(view.projects).toEqual([expect.objectContaining({ projectId: PROJECT.id, spentToDate: '850.00', spentByMonth: ['0.00', '0.00', '0.00', '0.00', '250.00', '600.00'] })]);
    expect(view.pipeline.paidThisMonth).toEqual({ count: 1, amount: '600.00' });
    expect(view.categories).toEqual([{ categoryId, name: expect.any(String), amount: '600.00' }]);
  });

  it('counts cash still with engineers, and settlements past their day with nothing under review', async () => {
    const fresh = await raise(ACTORS.engineer, '1000'); await throughDirector(fresh.id); await pay(fresh.id, new Date('2026-10-08'));
    const late = await raise(ACTORS.engineer, '500'); await throughDirector(late.id); await pay(late.id, new Date('2026-09-20'));
    const view = await overviews.overview(ACTORS.director, scopes.project, NOW);
    expect(view.projects).toEqual([expect.objectContaining({ spentToDate: '0.00', cashHeld: '1500.00', overdueSettlements: { count: 1, amount: '500.00' } })]);
    expect(view.cashHolders).toEqual([{ requesterId: ACTORS.engineer.id, outstanding: '1500.00', open: 2, overdue: 1 }]);

    const settling = await requests.create({
      kind: 'SETTLEMENT', advanceId: late.id, categoryId, purpose: 'Bills',
      invoices: [{ vendor: 'Hotel', invoiceNumber: 'H-1', invoiceDate: new Date('2026-09-22'), amount: '450' }],
    }, ACTORS.engineer, scopes.project);
    await requests.submit(settling.id, ACTORS.engineer);
    expect((await overviews.overview(ACTORS.director, scopes.project, NOW)).projects[0]!.overdueSettlements.count).toBe(0);
  });

  it('sums what the caller decided in 30 days, what they trimmed, and how long they took', async () => {
    const trimmedOne = await raise(ACTORS.engineer, '1000');
    const returnedOne = await raise(ACTORS.engineer, '200');
    const rejectedOne = await raise(ACTORS.engineer, '300');
    for (const r of [trimmedOne, returnedOne, rejectedOne]) await approvals.approve(r.id, {}, ACTORS.pm, scopes.project);
    for (const [r, hours] of [[trimmedOne, 4], [returnedOne, 2], [rejectedOne, 10]] as const) {
      await setActionAt(r.id, 'REQUESTER', 'SUBMITTED', new Date(Date.now() - 24 * HOUR));
      await setActionAt(r.id, 'PM', 'APPROVED', new Date(Date.now() - hours * HOUR));
    }
    await approvals.approve(trimmedOne.id, { amount: '800' }, ACTORS.director, scopes.project);
    await approvals.returnToRequester(returnedOne.id, 'Add the quotation', ACTORS.director, scopes.project);
    await approvals.reject(rejectedOne.id, 'Not in budget', ACTORS.director, scopes.project);
    const { decisions } = await overviews.overview(ACTORS.director, scopes.project);
    expect(decisions).toMatchObject({ approved: { count: 1, amount: '800.00' }, trimmed: { count: 1, saved: '200.00' }, returned: 1, rejected: 1 });
    expect(decisions.medianHoursToDecide).toBeCloseTo(4, 0);
  });

  it('counts nothing outside the caller’s projects', async () => {
    await raise(ACTORS.otherEngineer, '999', OTHER_PROJECT);
    const view = await overviews.overview(ACTORS.director, scopes.project);
    expect(view.pipeline.steps.every((s) => s.count === 0)).toBe(true);
    expect(view.projects).toEqual([]);
  });
});
