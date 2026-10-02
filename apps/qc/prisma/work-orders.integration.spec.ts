import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma-clients/qc';
import type { AuthzScope } from '@ipms/authz';
import { uuidv7, type AssignableUser, type SiteRefs } from '@ipms/contracts';
import { SubmissionService } from '../src/submissions/submission.service.js';
import type { MediaClient } from '../src/submissions/media.client.js';
import type { SiteGeofenceClient } from '../src/submissions/site-geofence.client.js';
import { TemplateQueries } from '../src/templates/template.queries.js';
import type { ProjectDirectoryClient } from '../src/work-orders/project-directory.client.js';
import { WorkOrderService } from '../src/work-orders/work-order.service.js';
import { ACTOR, resetDb, seedPublishedTemplate } from './fixtures.js';
import { startTestDb } from './test-db.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: WorkOrderService;
let submissions: SubmissionService;
const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const ENGINEER = uuidv7();

// The same site code in two projects: an antenna upgrade and a power upgrade.
const ANTENNA = uuidv7();
const POWER = uuidv7();
const ANTENNA_SITE = uuidv7();
const POWER_SITE = uuidv7();
const PROJECTS: Record<string, SiteRefs> = {
  [ANTENNA]: { project: { id: ANTENNA, code: 'TI-L2100', name: 'Antenna upgrade', status: 'ACTIVE' }, sites: [{ id: ANTENNA_SITE, siteCode: 'KOS102X', name: 'SAKUWA GACHHI', city: 'Biratnagar', area: null }] },
  [POWER]: { project: { id: POWER, code: 'PWR-2026', name: 'Power upgrade', status: 'ACTIVE' }, sites: [{ id: POWER_SITE, siteCode: 'KOS102X', name: 'KOS102X', city: 'Biratnagar', area: null }] },
};
/** project's answer to "who can be given work here": the engineer holds the antenna project only, unless a test grants more. */
let reach: Record<string, AssignableUser[]>;

const directory = {
  siteRefs: async (projectId: string, siteIds: string[]) => {
    const refs = PROJECTS[projectId];
    return refs ? { state: 'found', value: { ...refs, sites: refs.sites.filter((site) => siteIds.includes(site.id)) } } : { state: 'not_found' };
  },
  assignable: async (projectId: string) => ({ state: 'found', value: reach[projectId] ?? [] }),
  scope: async () => ({ state: 'found', value: GLOBAL }),
} as unknown as ProjectDirectoryClient;

// Finds every file usable; these specs carry none.
const fakeMedia = {
  check: async (body: { mediaIds: string[] }) => body.mediaIds.map((id) => ({ id, kind: 'PHOTO' as const, usable: true })),
  attach: async () => 'attached' as const,
} as unknown as MediaClient;

let templateId: string;
let versionId: string;
let itemId: string;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  service = new WorkOrderService(prisma, new TemplateQueries(prisma), directory);
  submissions = new SubmissionService(prisma, { fetch: async () => null } as unknown as SiteGeofenceClient, fakeMedia, 7);
}, 180_000);
afterAll(async () => { await db?.stop(); });

beforeEach(async () => {
  await resetDb(prisma);
  ({ templateId, versionId, itemId } = await seedPublishedTemplate(prisma));
  reach = { [ANTENNA]: [{ userId: ENGINEER, wholeProject: true, siteIds: [] }] };
});

const create = (projectId: string, siteId: string) => service.create({
  projectId, workOrderType: 'QUALITY_SELF_CHECK', templateId, siteIds: [siteId], assigneeId: ENGINEER,
  plannedCompletionAt: new Date('2026-09-30T18:14:59Z'),
}, ACTOR, 'Bearer t');

const submit = (order: { id: string; projectId: string; siteId: string }) => submissions.createSubmission({
  taskId: order.id, projectId: order.projectId, siteId: order.siteId, templateVersionId: versionId,
  idempotencyKey: `key-${uuidv7()}`, responses: [{ itemId, selfCheckResult: 'PASS', mediaIds: [] }],
}, ENGINEER, 'Bearer t');

describe('work orders against a real database', () => {
  it('tells the same site code apart by project', async () => {
    const { created } = await create(ANTENNA, ANTENNA_SITE);
    expect(created[0]).toMatchObject({
      // Named by the site ID, not the site's name.
      title: '[Quality Self-check]KOS102X',
      project: { code: 'TI-L2100' }, site: { siteCode: 'KOS102X', name: 'SAKUWA GACHHI', city: 'Biratnagar' }, templateName: 'Antenna + RRU',
    });
    const page = await service.list(GLOBAL, { page: 1, limit: 20, q: 'PWR' });
    expect(page.total).toBe(0);
  });

  it('refuses an engineer with no scope on the other project', async () => {
    await expect(create(POWER, POWER_SITE)).rejects.toThrow(/no access to site KOS102X/);
  });

  it('refuses a site project does not return', async () => {
    await expect(create(ANTENNA, POWER_SITE)).rejects.toThrow('Every site must belong to this project');
  });

  it('lists across projects with counts and the overdue view, within scope', async () => {
    reach[POWER] = [{ userId: ENGINEER, wholeProject: false, siteIds: [POWER_SITE] }];
    await create(ANTENNA, ANTENNA_SITE);
    await create(POWER, POWER_SITE);
    const all = await service.list(GLOBAL, { page: 1, limit: 20 }, new Date('2026-10-05T00:00:00Z'));
    expect(all.total).toBe(2);
    expect(all.counts).toMatchObject({ ALL: 2, NOT_STARTED: 2, OVERDUE: 2 });
    const one = await service.list(GLOBAL, { page: 1, limit: 20, projectId: POWER });
    expect(one.items.map((item) => item.project.code)).toEqual(['PWR-2026']);
    const siteOnly = await service.list({ global: false, projectIds: [], siteIds: [POWER_SITE] }, { page: 1, limit: 20 });
    expect(siteOnly.items.map((item) => item.project.code)).toEqual(['PWR-2026']);
    expect((await service.brief(GLOBAL, ANTENNA)).map((row) => row.siteCode)).toEqual(['KOS102X']);
  });

  it('moves with its submissions and reviews, and records each on the timeline', async () => {
    const { created } = await create(ANTENNA, ANTENNA_SITE);
    const order = created[0]!;

    const first = await submit(order);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REVIEWING');
    await submissions.reviewSubmission(first.id, { decision: 'REJECT_REWORK', comment: 'Blurred', itemReviews: [{ itemId, result: 'REJECTED' }] }, ACTOR, GLOBAL);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RECTIFYING');

    const second = await submit(order);
    await submissions.reviewSubmission(second.id, { decision: 'APPROVE', itemReviews: [{ itemId, result: 'APPROVED' }] }, ACTOR, GLOBAL);
    const done = await prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(done).toMatchObject({ status: 'COMPLETED', currentAttemptNo: 2, currentSubmissionId: second.id });
    expect(done.actualCompletionAt).not.toBeNull();

    const detail = await service.get(GLOBAL, order.id);
    expect(detail.events.map((event) => event.kind)).toEqual(['CREATED', 'SUBMITTED', 'REJECTED', 'SUBMITTED', 'APPROVED']);
  });

  it('never moves a cancelled work order, and cannot change a closed one', async () => {
    const { created } = await create(ANTENNA, ANTENNA_SITE);
    const order = created[0]!;
    await service.cancel(GLOBAL, order.id, { reason: 'Site handed back' }, ACTOR);
    const published = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'qc.work_order.cancelled' } });
    expect(published.payload).toMatchObject({ workOrderId: order.id, projectId: ANTENNA, siteId: ANTENNA_SITE });
    expect(typeof (published.payload as { cancelledAt: unknown }).cancelledAt).toBe('string');
    await expect(submit(order)).rejects.toThrow('cancelled');
    expect(await prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'CANCELLED', cancelReason: 'Site handed back' });
    await expect(service.update(GLOBAL, order.id, { assigneeId: ENGINEER }, ACTOR, 'Bearer t')).rejects.toThrow('cancelled');
  });

  it('renames work orders raised under the site-name rule, keeping the note', async () => {
    const { created } = await create(ANTENNA, ANTENNA_SITE);
    await prisma.workOrder.update({ where: { id: created[0]!.id }, data: { title: '[Quality Self-check]SAKUWA GACHHI sector B' } });
    const sql = readFileSync(fileURLToPath(new URL('./migrations/20260926000200_work_order_title_site_code/migration.sql', import.meta.url)), 'utf8');
    await prisma.$executeRawUnsafe(sql.split('\n').filter((line) => !line.startsWith('--')).join('\n'));
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: created[0]!.id } })).title).toBe('[Quality Self-check]KOS102X sector B');
  });

  it('counts what a project or site still has, for project’s delete guard', async () => {
    await create(ANTENNA, ANTENNA_SITE);
    expect(await service.usage({ projectId: ANTENNA })).toEqual({ count: 1 });
    expect(await service.usage({ siteId: POWER_SITE })).toEqual({ count: 0 });
  });

  it('deletes the draft when the work order is reassigned or cancelled', async () => {
    const OTHER = uuidv7();
    reach = { [ANTENNA]: [{ userId: ENGINEER, wholeProject: true, siteIds: [] }, { userId: OTHER, wholeProject: true, siteIds: [] }] };
    const addDraft = (workOrderId: string) => prisma.workOrderDraft.create({ data: { workOrderId, holderId: ENGINEER, deviceId: 'd', deviceLabel: 'P', version: 1, responses: [] } });

    const reassigned = (await create(ANTENNA, ANTENNA_SITE)).created[0]!;
    await addDraft(reassigned.id);
    await service.update(GLOBAL, reassigned.id, { assigneeId: OTHER }, ACTOR, 'Bearer t');
    expect(await prisma.workOrderDraft.count({ where: { workOrderId: reassigned.id } })).toBe(0);

    const cancelled = (await create(ANTENNA, ANTENNA_SITE)).created[0]!;
    await addDraft(cancelled.id);
    await service.cancel(GLOBAL, cancelled.id, { reason: 'Site dropped' }, ACTOR);
    expect(await prisma.workOrderDraft.count({ where: { workOrderId: cancelled.id } })).toBe(0);
  });

  it('keeps the draft when only the date moves', async () => {
    const order = (await create(ANTENNA, ANTENNA_SITE)).created[0]!;
    await prisma.workOrderDraft.create({ data: { workOrderId: order.id, holderId: ENGINEER, deviceId: 'd', deviceLabel: 'P', version: 1, responses: [] } });
    await service.update(GLOBAL, order.id, { plannedCompletionAt: new Date('2026-10-15T18:14:59Z') }, ACTOR, 'Bearer t');
    expect(await prisma.workOrderDraft.count({ where: { workOrderId: order.id } })).toBe(1);
  });
});
