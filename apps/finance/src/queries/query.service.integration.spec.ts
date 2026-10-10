import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, OTHER_PROJECT, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
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

const make = async (requester = ACTORS.engineer, project = PROJECT) => {
  const scope = project.id === PROJECT.id ? scopes.project : scopes.otherProject;
  const r = await requests.create({ kind: 'ADVANCE', projectId: project.id, categoryId, purpose: 'Travel', amount: '1000' }, requester, scope, project);
  return requests.submit(r.id, requester);
};

describe('list', () => {
  it('shows an engineer only their own requests', async () => {
    await make(ACTORS.engineer); await make(ACTORS.otherEngineer);
    const page = await queries.list(ACTORS.engineer, scopes.project, { view: 'mine', page: 1, limit: 20 });
    expect(page.items.map((i) => i.requesterId)).toEqual([ACTORS.engineer.id]);
    expect(page.total).toBe(1);
  });

  it('refuses the "all" view without view_all', async () => {
    await expect(queries.list(ACTORS.engineer, scopes.project, { view: 'all', page: 1, limit: 20 })).rejects.toThrow(/finance_request\.view_all/);
  });

  it('shows a PM everything in their project scope and nothing from other projects', async () => {
    await make(ACTORS.engineer); await make(ACTORS.otherEngineer, OTHER_PROJECT);
    const page = await queries.list(ACTORS.pm, scopes.project, { view: 'all', page: 1, limit: 20 });
    expect(page.items.map((i) => i.projectId)).toEqual([PROJECT.id]);
  });

  it('shows Finance, with global scope, every project', async () => {
    await make(ACTORS.engineer); await make(ACTORS.otherEngineer, OTHER_PROJECT);
    expect((await queries.list(ACTORS.finance, scopes.global, { view: 'all', page: 1, limit: 20 })).total).toBe(2);
  });

  it('lists what awaits the caller, excluding their own requests', async () => {
    const mine = await make(ACTORS.pm);          // PM-raised: waits for the Director
    const theirs = await make(ACTORS.engineer);  // waits for a PM
    const forPm = await queries.list(ACTORS.otherPm, scopes.project, { view: 'awaiting', page: 1, limit: 20 });
    expect(forPm.items.map((i) => i.id)).toEqual([theirs.id]);
    const forDirector = await queries.list(ACTORS.director, scopes.project, { view: 'awaiting', page: 1, limit: 20 });
    expect(forDirector.items.map((i) => i.id)).toEqual([mine.id]);
    expect((await queries.list(ACTORS.engineer, scopes.project, { view: 'awaiting', page: 1, limit: 20 })).items).toEqual([]);
  });

  it('lists what awaits the caller oldest-waiting first, with flags', async () => {
    const older = await make();
    const newer = await make();
    await prisma.$executeRaw`UPDATE "finance_request" SET "updatedAt" = ${new Date(Date.now() - 5 * 86_400_000)} WHERE "id" = ${older.id}::uuid`;
    const page = await queries.list(ACTORS.pm, scopes.project, { view: 'awaiting', page: 1, limit: 20 });
    expect(page.items.map((i) => i.id)).toEqual([older.id, newer.id]);
    expect(page.items[0]!.flags).toEqual([{ code: 'WAITING_LONG', tone: 'amber', days: 5 }]);
    expect(page.items[1]!.flags).toEqual([]);
  });

  it('carries no flags outside the awaiting view', async () => {
    await make();
    const page = await queries.list(ACTORS.pm, scopes.project, { view: 'all', page: 1, limit: 20 });
    expect(page.items[0]).not.toHaveProperty('flags');
  });

  it('lists what the caller has already acted on, not their own and not others\' untouched ones', async () => {
    const acted = await make(ACTORS.engineer);
    await make(ACTORS.otherEngineer);                        // never touched by the PM
    const own = await make(ACTORS.pm);                       // the PM's own request
    await approvals.approve(acted.id, {}, ACTORS.otherPm, scopes.project);
    const page = await queries.list(ACTORS.otherPm, scopes.project, { view: 'handled', page: 1, limit: 20 });
    expect(page.items.map((i) => i.id)).toEqual([acted.id]);
    expect(page.items.map((i) => i.id)).not.toContain(own.id);
    expect((await queries.list(ACTORS.engineer, scopes.project, { view: 'handled', page: 1, limit: 20 })).items).toEqual([]);
  });

  it('returns nothing for awaiting when the caller lacks view_all, even with an approval permission', async () => {
    await make(ACTORS.engineer);
    const noViewAll = { ...ACTORS.pm, permissions: ACTORS.pm.permissions.filter((p) => p !== 'finance_request.view_all') };
    expect(noViewAll.permissions).toContain('finance_approval.pm');
    const page = await queries.list(noViewAll, scopes.project, { view: 'awaiting', page: 1, limit: 20 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('filters by status, kind and project, and paginates newest first', async () => {
    await make(); await make(); await make();
    const page = await queries.list(ACTORS.pm, scopes.project, { view: 'all', page: 2, limit: 2, status: 'PENDING_PM', kind: 'ADVANCE', projectId: PROJECT.id });
    expect(page).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(page.items).toHaveLength(1);
  });
});

describe('get', () => {
  it('returns the request with invoices, history and payments to its requester', async () => {
    const r = await make();
    const detail = await queries.get(r.id, ACTORS.engineer, scopes.project);
    expect(detail.actions?.map((a) => a.action)).toEqual(['SUBMITTED']);
    expect(detail.category).toMatchObject({ code: expect.any(String) });
  });

  it('hides it from another engineer and from a PM outside the project', async () => {
    const r = await make();
    await expect(queries.get(r.id, ACTORS.otherEngineer, scopes.project)).rejects.toThrow(/not found/);
    await expect(queries.get(r.id, ACTORS.pm, scopes.otherProject)).rejects.toThrow(/not found/);
    expect((await queries.get(r.id, ACTORS.pm, scopes.project)).id).toBe(r.id);
  });
});

describe('advance', () => {
  it('shows the balance and the settlements against a paid advance', async () => {
    const a = await make();
    await approvals.approve(a.id, {}, ACTORS.pm, scopes.project);
    await approvals.approve(a.id, {}, ACTORS.director, scopes.project);
    await payments.pay(a.id, { mode: 'CASH', reference: 'V1', paidOn: new Date('2026-10-05') }, ACTORS.finance, scopes.global);
    const view = await queries.advance(a.id, ACTORS.engineer, scopes.project);
    expect(view.balance).toMatchObject({ paid: '1000.00', outstanding: '1000.00', status: 'PAID' });
    expect(view.settlements).toEqual([]);
  });

  it('refuses something that is not an advance', async () => {
    const r = await requests.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'x', invoices: [{ vendor: 'V', invoiceNumber: '1', invoiceDate: new Date('2026-10-01'), amount: '5', mediaId: ACTORS.engineer.id }] }, ACTORS.engineer, scopes.project, PROJECT);
    await expect(queries.advance(r.id, ACTORS.engineer, scopes.project)).rejects.toThrow(/Advance not found/);
  });
});
