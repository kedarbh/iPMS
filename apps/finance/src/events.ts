import { uuidv7 } from '@ipms/contracts';
import type { FinanceEventBase } from '@ipms/events';
import { getCorrelationId } from '@ipms/observability';
import { buildOutboxRecord } from '@ipms/persistence';
import type { FinanceRequest } from '@prisma-clients/finance';
import { asJson } from './audit.js';
import type { Tx } from './common.js';
import type { Step } from './workflow.js';

/** What every finance event says about the request; see FinanceEventBase. */
export function factsOf(row: FinanceRequest, actorId: string, comment: string | null, at: Date = new Date()): FinanceEventBase {
  return {
    requestId: row.id,
    number: row.number,
    kind: row.kind as FinanceEventBase['kind'],
    projectId: row.projectId,
    projectName: row.projectName,
    requesterId: row.requesterId,
    requestedAmount: row.requestedAmount.toFixed(2),
    approvedAmount: row.approvedAmount?.toFixed(2) ?? null,
    actorId,
    at: at.toISOString(),
    comment,
  };
}

/** Queues a finance event in the caller's transaction; the drainer publishes it after commit. */
export async function emit(tx: Tx, subject: string, payload: object, actorId: string): Promise<void> {
  await tx.outboxEvent.create({ data: buildOutboxRecord(subject, asJson(payload), getCorrelationId() ?? 'unknown', actorId) });
}

/** One line of the request's append-only history. */
export async function recordAction(
  tx: Tx,
  input: { requestId: string; revision: number; step: 'REQUESTER' | Step; action: string; actorId: string; amount?: string | null; comment?: string | null; at?: Date },
): Promise<void> {
  await tx.approvalAction.create({
    data: {
      id: uuidv7(), requestId: input.requestId, revision: input.revision, step: input.step, action: input.action,
      actorId: input.actorId, amount: input.amount ?? null, comment: input.comment ?? null, ...(input.at ? { at: input.at } : {}),
    },
  });
}
