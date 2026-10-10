import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma-clients/project';
import type { AuthzScope } from '@ipms/authz';
import type { WorkOrderUsageClient } from './work-order-usage.client.js';
import { ProjectService } from './project.service.js';

/**
 * Every mutating method must leave a ledger entry, with the right action and in
 * the same transaction as the change.
 *
 * `project` was the only service that mutated state without writing to the
 * audit ledger, so every project, site, task type, milestone and task change
 * was invisible to it — while `qc` recorded everything. This suite is what
 * stops that returning one method at a time: a new mutation added without an
 * audit row fails the completeness test at the bottom.
 */
const ACTOR = '01a0d000-0000-7000-8000-00000000ac70';
const GLOBAL: AuthzScope = { global: true, projectIds: [], siteIds: [] };
const ROW = { id: 'row-1' };

function makePrisma() {
  const db = {
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: 'p-1', code: 'NP', name: 'N', status: 'DRAFT' }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(ROW), update: vi.fn().mockResolvedValue(ROW), delete: vi.fn(),
    },
    site: {
      findFirst: vi.fn().mockResolvedValue({ id: 's-1', projectId: 'p-1', siteCode: 'K1', name: 'K', status: 'PLANNED', geofenceMode: 'INHERIT' }),
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue(ROW), update: vi.fn().mockResolvedValue(ROW), delete: vi.fn(),
    },
    taskType: {
      findFirst: vi.fn().mockResolvedValue({ id: 'tt-1', projectId: 'p-1', code: 'T', name: 'T', isActive: true, templateId: null }),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(ROW), update: vi.fn().mockResolvedValue(ROW), delete: vi.fn(),
    },
    milestone: {
      findFirst: vi.fn().mockResolvedValue({ id: 'm-1', projectId: 'p-1', code: 'M', name: 'M', kind: 'PROJECT', sequence: 1 }),
      create: vi.fn().mockResolvedValue(ROW), update: vi.fn().mockResolvedValue(ROW), delete: vi.fn(),
    },
    milestoneRequirement: { deleteMany: vi.fn(), createMany: vi.fn() },
    task: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 't-1', projectId: 'p-1', siteId: 's-1', title: 'T', status: 'NOT_STARTED', assigneeId: null, currentSubmissionId: null }),
      findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(ROW), update: vi.fn().mockResolvedValue(ROW), delete: vi.fn(),
    },
    region: { upsert: vi.fn().mockResolvedValue({ id: 'r-1' }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  return db;
}
type Prisma = ReturnType<typeof makePrisma>;

let prisma: Prisma;
let service: ProjectService;
beforeEach(() => {
  prisma = makePrisma();
  service = new ProjectService(prisma as unknown as PrismaClient, { count: async () => 0 } as unknown as WorkOrderUsageClient);
});

/** The audit actions written during one call. */
function actions(): string[] {
  return prisma.outboxEvent.create.mock.calls.map(
    (c) => (c[0] as { data: { payload: { action: string } } }).data.payload.action,
  );
}

const MUTATIONS: Array<[string, () => Promise<unknown>]> = [
  ['project.created', () => service.createProject({ code: 'NP', name: 'N' } as never, ACTOR)],
  ['project.updated', () => service.updateProject(GLOBAL, 'p-1', { name: 'N2' } as never, ACTOR)],
  ['project.archived', () => service.archiveProject(GLOBAL, 'p-1', ACTOR)],
  ['project.deleted', () => service.deleteProject(GLOBAL, 'p-1', ACTOR, 'Bearer t')],
  ['site.created', () => service.createSite(GLOBAL, 'p-1', { siteCode: 'K1', name: 'K', geofenceMode: 'INHERIT' } as never, ACTOR)],
  ['site.updated', () => service.updateSite(GLOBAL, 's-1', { name: 'K2' } as never, ACTOR)],
  ['site.deleted', () => service.deleteSite(GLOBAL, 's-1', ACTOR, 'Bearer t')],
  ['task_type.created', () => service.createTaskType(GLOBAL, 'p-1', { code: 'T', name: 'T', category: 'QUALITY' } as never, ACTOR)],
  ['task_type.updated', () => service.updateTaskType(GLOBAL, 'tt-1', { name: 'T2' } as never, ACTOR)],
  ['task_type.deleted', () => service.deleteTaskType(GLOBAL, 'tt-1', ACTOR)],
  ['milestone.created', () => service.createMilestone(GLOBAL, 'p-1', { code: 'M', name: 'M', kind: 'PROJECT', sequence: 1, taskTypeIds: [] } as never, ACTOR)],
  ['milestone.updated', () => service.updateMilestone(GLOBAL, 'm-1', { name: 'M2' } as never, ACTOR)],
  ['milestone.deleted', () => service.deleteMilestone(GLOBAL, 'm-1', ACTOR)],
  ['task.created', () => service.createTask(GLOBAL, 'p-1', { siteId: 's-1', taskTypeId: 'tt-1', title: 'T', origin: 'AD_HOC' } as never, ACTOR)],
  ['task.updated', () => service.updateTask(GLOBAL, 't-1', { title: 'T2' } as never, ACTOR)],
  ['task.assigned', () => service.assignTask(GLOBAL, 't-1', { assigneeId: 'u-1' } as never, ACTOR)],
  ['task.deleted', () => service.deleteTask(GLOBAL, 't-1', ACTOR)],
];

describe('every mutation writes a ledger entry', () => {
  it.each(MUTATIONS)('%s', async (action, call) => {
    await call();
    expect(actions()).toContain(action);
  });

  it.each(MUTATIONS)('%s attributes the acting user', async (_action, call) => {
    await call();
    const entry = prisma.outboxEvent.create.mock.calls[0]![0] as { data: { actorId: string; payload: { actorId: string } } };
    // Both the envelope and the payload: the drainer reads the column, the
    // ledger reads the payload, and an entry nobody is accountable for is
    // worth very little.
    expect(entry.data.actorId).toBe(ACTOR);
    expect(entry.data.payload.actorId).toBe(ACTOR);
  });

  it.each(MUTATIONS)('%s writes exactly one entry, inside one transaction', async (_action, call) => {
    await call();
    expect(actions()).toHaveLength(1);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});

describe('ledger completeness', () => {
  it('covers every mutating method on the service', () => {
    // The guard against this regressing one method at a time. A new mutation
    // that is not in MUTATIONS above fails here rather than silently going
    // unaudited — which is exactly how project drifted out of the ledger.
    const READS = new Set([
      'listProjects', 'getProject', 'listTasks', 'siteGeofence', 'siteRefs', 'assignable', 'dashboard', 'portfolio',
    ]);
    const mutating = Object.getOwnPropertyNames(ProjectService.prototype)
      .filter((name) => name !== 'constructor' && !name.startsWith('require') && !READS.has(name))
      .filter((name) => !['audited', 'auditedDelete'].includes(name));

    const covered = new Set(MUTATIONS.map(([action]) => action));
    expect(mutating.length, `mutating methods: ${mutating.join(', ')}`).toBe(covered.size);
  });
});
