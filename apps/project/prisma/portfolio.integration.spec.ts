import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/project';
import type { AuthzScope } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { summarizePortfolio } from '../src/project/portfolio.js';
import { startTestDb } from './test-db.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
const NOW = new Date('2026-10-10T06:00:00Z');
const ACTOR = '01a0d000-0000-7000-8000-00000000ac70';
const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => {
  await prisma.task.deleteMany({});
  await prisma.milestoneRequirement.deleteMany({});
  await prisma.milestone.deleteMany({});
  await prisma.taskType.deleteMany({});
  await prisma.site.deleteMany({});
  await prisma.project.deleteMany({});
});

async function aProject(code: string, status = 'ACTIVE'): Promise<string> {
  const id = uuidv7();
  await prisma.project.create({ data: { id, code, name: `Project ${code}`, status, startDate: new Date('2026-01-01'), targetDate: new Date('2026-12-31') } });
  return id;
}
async function aSite(projectId: string, siteCode: string, status = 'PLANNED'): Promise<string> {
  const id = uuidv7();
  await prisma.site.create({ data: { id, projectId, siteCode, name: siteCode, status } });
  return id;
}
async function aType(projectId: string, code: string): Promise<string> {
  const id = uuidv7();
  await prisma.taskType.create({ data: { id, projectId, code, name: code, category: 'CIVIL' } });
  return id;
}
async function aMilestone(projectId: string, code: string, sequence: number, taskTypeIds: string[], targetDate: Date | null = null): Promise<void> {
  const id = uuidv7();
  await prisma.milestone.create({ data: { id, projectId, code, name: `Milestone ${code}`, kind: 'PROJECT', sequence, targetDate } });
  if (taskTypeIds.length > 0) await prisma.milestoneRequirement.createMany({ data: taskTypeIds.map((taskTypeId) => ({ milestoneId: id, taskTypeId })) });
}
async function aTask(projectId: string, siteId: string, taskTypeId: string, over: { status?: string; plannedCompletionAt?: Date; actualCompletionAt?: Date } = {}): Promise<void> {
  await prisma.task.create({
    data: {
      id: uuidv7(), projectId, siteId, taskTypeId, title: 'Work', origin: 'AD_HOC', createdBy: ACTOR,
      status: over.status ?? 'NOT_STARTED', plannedCompletionAt: over.plannedCompletionAt ?? null, actualCompletionAt: over.actualCompletionAt ?? null,
    },
  });
}

describe('summarizePortfolio', () => {
  it('covers ACTIVE and ON_HOLD projects in scope, and nothing else', async () => {
    const active = await aProject('A1');
    const held = await aProject('A2', 'ON_HOLD');
    const draft = await aProject('A3', 'DRAFT');
    const done = await aProject('A4', 'COMPLETED');
    await aProject('B1');
    const scope: AuthzScope = { global: false, projectIds: [active, held, draft, done], siteIds: [] };
    expect((await summarizePortfolio(prisma, scope, NOW)).map((p) => p.code)).toEqual(['A1', 'A2']);
  });

  it('counts sites and tasks by status, and open tasks past their date as overdue', async () => {
    const p = await aProject('A1');
    const s1 = await aSite(p, 'S1', 'IN_DELIVERY');
    await aSite(p, 'S2');
    const t = await aType(p, 'FDN');
    await aTask(p, s1, t, { status: 'ONGOING', plannedCompletionAt: days(2) });
    await aTask(p, s1, t, { status: 'COMPLETED', plannedCompletionAt: days(5), actualCompletionAt: days(4) });
    await aTask(p, s1, t, { status: 'CANCELLED' });
    const [entry] = await summarizePortfolio(prisma, GLOBAL, NOW);
    expect(entry!.sites).toEqual({ total: 2, byStatus: { IN_DELIVERY: 1, PLANNED: 1 } });
    expect(entry!.tasks).toEqual({ live: 2, completed: 1, overdue: 1, byStatus: { ONGOING: 1, COMPLETED: 1, CANCELLED: 1 } });
    expect(entry!.sitesComplete).toBeNull();
    expect(entry!.startDate).toBe('2026-01-01T00:00:00.000Z');
  });

  it('counts a site complete once it has every required task type, dated by the last of them', async () => {
    const p = await aProject('A1');
    const s1 = await aSite(p, 'S1');
    const s2 = await aSite(p, 'S2');
    const fdn = await aType(p, 'FDN');
    const twr = await aType(p, 'TWR');
    await aMilestone(p, 'M1', 1, [fdn, twr]);
    await aTask(p, s1, fdn, { status: 'COMPLETED', actualCompletionAt: days(20) });
    await aTask(p, s1, twr, { status: 'COMPLETED', actualCompletionAt: days(3) });
    await aTask(p, s2, fdn, { status: 'COMPLETED', actualCompletionAt: days(2) });
    const [entry] = await summarizePortfolio(prisma, GLOBAL, NOW);
    expect(entry!.sitesComplete).toBe(1);
    expect(entry!.completedByWeek).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('counts completed tasks per rolling week when no milestone declares requirements', async () => {
    const p = await aProject('A1');
    const s = await aSite(p, 'S1');
    const t = await aType(p, 'FDN');
    await aMilestone(p, 'M0', 1, []);
    for (const ago of [1, 8, 9, 60]) await aTask(p, s, t, { status: 'COMPLETED', actualCompletionAt: days(ago) });
    const [entry] = await summarizePortfolio(prisma, GLOBAL, NOW);
    expect(entry!.sitesComplete).toBeNull();
    expect(entry!.completedByWeek).toEqual([0, 0, 0, 0, 0, 0, 2, 1]);
  });

  it('names the first milestone some site has not met as next', async () => {
    const p = await aProject('A1');
    const s1 = await aSite(p, 'S1');
    const s2 = await aSite(p, 'S2');
    const fdn = await aType(p, 'FDN');
    const pwr = await aType(p, 'PWR');
    await aMilestone(p, 'M1', 1, [fdn]);
    await aMilestone(p, 'M2', 2, [pwr], new Date('2026-10-20'));
    for (const s of [s1, s2]) await aTask(p, s, fdn, { status: 'COMPLETED', actualCompletionAt: days(10) });
    await aTask(p, s1, pwr, { status: 'COMPLETED', actualCompletionAt: days(1) });
    const [entry] = await summarizePortfolio(prisma, GLOBAL, NOW);
    expect(entry!.nextMilestone).toEqual({ name: 'Milestone M2', targetDate: '2026-10-20T00:00:00.000Z', percent: 50 });
  });

  it('counts only the sites a site-scoped caller holds', async () => {
    const p = await aProject('A1');
    const s1 = await aSite(p, 'S1');
    const s2 = await aSite(p, 'S2');
    const t = await aType(p, 'FDN');
    await aTask(p, s1, t, { status: 'ONGOING' });
    await aTask(p, s2, t, { status: 'ONGOING' });
    const [entry] = await summarizePortfolio(prisma, { global: false, projectIds: [], siteIds: [s1] }, NOW);
    expect(entry!.sites.total).toBe(1);
    expect(entry!.tasks.live).toBe(1);
  });

  it('counts sites for a project with milestone requirements and tasks for one without, side by side', async () => {
    const measured = await aProject('A1');
    const plain = await aProject('A2');
    const ms = await aSite(measured, 'S1');
    const ps = await aSite(plain, 'S1');
    const mt = await aType(measured, 'FDN');
    const pt = await aType(plain, 'FDN');
    await aMilestone(measured, 'M1', 1, [mt]);
    await aTask(measured, ms, mt, { status: 'COMPLETED', actualCompletionAt: days(1) });
    await aTask(plain, ps, pt, { status: 'COMPLETED', actualCompletionAt: days(1) });
    await aTask(plain, ps, pt, { status: 'COMPLETED', actualCompletionAt: days(9) });
    const [a1, a2] = await summarizePortfolio(prisma, GLOBAL, NOW);
    expect(a1).toMatchObject({ code: 'A1', sitesComplete: 1, completedByWeek: [0, 0, 0, 0, 0, 0, 0, 1] });
    expect(a2).toMatchObject({ code: 'A2', sitesComplete: null, completedByWeek: [0, 0, 0, 0, 0, 0, 1, 1], tasks: { live: 2, completed: 2 } });
  });
});
