import type { PrismaClient } from '@prisma-clients/qc';
import { uuidv7 } from '@ipms/contracts';

export const ACTOR = '0192f7a0-0000-7000-8000-00000000a001';

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.submission.deleteMany({});
  await prisma.workOrder.deleteMany({});
  await prisma.outboxEvent.deleteMany({});
  await prisma.checklistTemplate.updateMany({ data: { currentVersionId: null } });
  await prisma.checklistTemplate.deleteMany({});
}

/** One template with one version holding one section and one item, written without the service. */
export async function seedPublishedTemplate(
  prisma: PrismaClient,
  opts: { code?: string; status?: 'PUBLISHED' | 'RETIRED'; retiredAt?: Date | null; disabled?: boolean } = {},
): Promise<{ templateId: string; versionId: string; itemId: string }> {
  const templateId = uuidv7();
  const versionId = uuidv7();
  const sectionId = uuidv7();
  const itemId = uuidv7();
  const status = opts.status ?? 'PUBLISHED';
  await prisma.checklistTemplate.create({
    data: {
      id: templateId, code: opts.code ?? 'AI-RRU', name: 'Antenna + RRU', category: 'QUALITY',
      createdBy: ACTOR, disabledAt: opts.disabled ? new Date() : null,
    },
  });
  await prisma.templateVersion.create({
    data: {
      id: versionId, templateId, version: 1, status, source: 'WEB', createdBy: ACTOR,
      publishedAt: new Date(), publishedBy: ACTOR, retiredAt: opts.retiredAt ?? null,
    },
  });
  await prisma.checklistSection.create({ data: { id: sectionId, versionId, number: '1', title: 'EHS', order: 0 } });
  await prisma.checklistItem.create({
    data: { id: itemId, sectionId, number: '1.1', requirementText: 'PPE worn', severity: 'NORMAL', responseType: 'RESULT_ONLY', order: 0 },
  });
  if (status === 'PUBLISHED') {
    await prisma.checklistTemplate.update({ where: { id: templateId }, data: { currentVersionId: versionId } });
  }
  return { templateId, versionId, itemId };
}

export interface SeededWorkOrder { id: string; projectId: string; siteId: string; assigneeId: string; templateId: string; status: string }

/** A work order on a fresh project and site (unless given one), written without the service. */
export async function seedWorkOrder(
  prisma: PrismaClient,
  templateId: string,
  overrides: Partial<Pick<SeededWorkOrder, 'assigneeId' | 'status' | 'projectId'>> & { plannedCompletionAt?: Date; actualCompletionAt?: Date } = {},
): Promise<SeededWorkOrder> {
  const { plannedCompletionAt = new Date('2026-09-30T18:14:59Z'), actualCompletionAt = null, ...rest } = overrides;
  const row = {
    id: uuidv7(), projectId: uuidv7(), siteId: uuidv7(), assigneeId: ACTOR, templateId, status: 'NOT_STARTED', ...rest,
  };
  await prisma.workOrder.create({
    data: {
      ...row, projectCode: 'TI-L2100', projectName: 'Antenna upgrade', siteCode: 'KOS102X', siteName: 'KOS102X',
      templateName: 'Antenna + RRU', workOrderType: 'QUALITY_SELF_CHECK', title: '[Quality Self-check]KOS102X',
      plannedCompletionAt, actualCompletionAt, createdBy: ACTOR,
    },
  });
  return row;
}
