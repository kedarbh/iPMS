import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/qc';
import type { AuthzScope } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { summarizeWorkOrders } from '../src/work-orders/work-order-summary.js';
import { ACTOR, resetDb, seedPublishedTemplate, seedWorkOrder } from './fixtures.js';
import { startTestDb } from './test-db.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let templateId: string;
const NOW = new Date('2026-10-10T06:00:00Z');
const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const P1 = uuidv7();
const P2 = uuidv7();

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => {
  await resetDb(prisma);
  ({ templateId } = await seedPublishedTemplate(prisma));
});

const order = (projectId: string, over: Parameters<typeof seedWorkOrder>[2] = {}) => seedWorkOrder(prisma, templateId, { projectId, ...over });
const event = (workOrderId: string, kind: string, at: Date) =>
  prisma.workOrderEvent.create({ data: { id: uuidv7(), workOrderId, kind, at, actorId: ACTOR } });

describe('summarizeWorkOrders', () => {
  it('counts work orders by status per project, and open ones past their date as overdue', async () => {
    await order(P1, { status: 'ONGOING', plannedCompletionAt: days(1) });
    await order(P1, { status: 'COMPLETED', plannedCompletionAt: days(3), actualCompletionAt: days(2) });
    await order(P2, { status: 'NOT_STARTED', plannedCompletionAt: days(-5) });
    const result = await summarizeWorkOrders(prisma, GLOBAL, NOW);
    const p1 = result.find((s) => s.projectId === P1)!;
    expect(p1.byStatus).toMatchObject({ ONGOING: 1, COMPLETED: 1, NOT_STARTED: 0 });
    expect(p1.overdue).toBe(1);
    expect(result.find((s) => s.projectId === P2)!.overdue).toBe(0);
  });

  it('measures first-time approval over 90 days: approved work orders never rejected', async () => {
    const clean = await order(P1, { status: 'COMPLETED' });
    const reworked = await order(P1, { status: 'COMPLETED' });
    const old = await order(P1, { status: 'COMPLETED' });
    await event(clean.id, 'APPROVED', days(5));
    await event(reworked.id, 'REJECTED', days(12));
    await event(reworked.id, 'APPROVED', days(6));
    await event(old.id, 'APPROVED', days(100));
    const [p1] = await summarizeWorkOrders(prisma, GLOBAL, NOW);
    expect(p1).toMatchObject({ approved90: 2, firstTime90: 1 });
  });

  it('reports how many wait for review, and since when the oldest by its latest submission', async () => {
    const a = await order(P1, { status: 'REVIEWING' });
    const b = await order(P1, { status: 'REVIEWING' });
    await event(a.id, 'SUBMITTED', days(9));
    await event(a.id, 'SUBMITTED', days(4));
    await event(b.id, 'SUBMITTED', days(6));
    const [p1] = await summarizeWorkOrders(prisma, GLOBAL, NOW);
    expect(p1!.reviewing).toEqual({ count: 2, oldestSubmittedAt: days(6).toISOString() });
  });

  it('counts completions per rolling week', async () => {
    for (const ago of [1, 9, 70]) await order(P1, { status: 'COMPLETED', actualCompletionAt: days(ago) });
    const [p1] = await summarizeWorkOrders(prisma, GLOBAL, NOW);
    expect(p1!.completedByWeek).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('reads only what the caller may: their projects, and their own work without task.view_all', async () => {
    await order(P1, { status: 'ONGOING' });
    await order(P2, { status: 'ONGOING' });
    const mine = await order(P1, { status: 'NOT_STARTED', assigneeId: uuidv7() });
    const scoped = await summarizeWorkOrders(prisma, { global: false, projectIds: [P1], siteIds: [] }, NOW);
    expect(scoped.map((s) => s.projectId)).toEqual([P1]);
    const own = await summarizeWorkOrders(prisma, { global: false, projectIds: [P1], siteIds: [], onlyAssignee: mine.assigneeId }, NOW);
    expect(own[0]!.byStatus).toMatchObject({ ONGOING: 0, NOT_STARTED: 1 });
  });
});
