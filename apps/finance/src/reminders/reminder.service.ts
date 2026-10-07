import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthzScope } from '@ipms/authz';
import { SUBJECTS, type FinanceAdvanceSettlementReminder } from '@ipms/events';
import type { PrismaClient } from '@prisma-clients/finance';
import { recordAudit } from '../audit.js';
import { inScope, notFound, type Actor } from '../common.js';
import { emit, factsOf, recordAction } from '../events.js';
import { loadBalance } from '../ledger.js';
import { compareMoney } from '../money.js';
import { advanceSettlementDue } from '../settlement.js';
import { isPending, type Step } from '../workflow.js';

const VIEW_ALL = 'finance_request.view_all';
/** The step each approving permission acts at; whoever reminds is recorded at theirs. */
const STEP_BY_PERMISSION: ReadonlyArray<[string, Step]> = [['finance_payment.record', 'FINANCE'], ['finance_approval.director', 'DIRECTOR'], ['finance_approval.pm', 'PM']];
/** One reminder per advance in this long, whoever sends it, so a request is never nagged from three desks at once. */
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Nudges an engineer to settle an advance that is past its settle-by day.
 * Only people who see the project's requests and approve or pay in it may
 * send one, and only for an advance that is overdue with nothing under review.
 */
export class ReminderService {
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {}

  async remind(id: string, actor: Actor, scope: AuthzScope): Promise<{ reminded: boolean; lastRemindedAt: string | null }> {
    const step = STEP_BY_PERMISSION.find(([permission]) => actor.permissions.includes(permission))?.[1];
    if (!step || !actor.permissions.includes(VIEW_ALL)) throw new ForbiddenException('You cannot send settlement reminders');

    const now = this.now();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.financeRequest.findUnique({ where: { id }, include: { payments: true, settlements: { select: { status: true } } } });
      if (!row || row.kind !== 'ADVANCE' || !inScope(scope, row.projectId)) throw notFound('Advance');
      if (row.requesterId === actor.id) throw new ForbiddenException('You cannot remind yourself');
      if (row.status !== 'PAID') throw new ConflictException('Only a paid advance can be settled');
      if (row.settlements.some((s) => isPending(s.status))) throw new ConflictException('A settlement for this advance is already under review');

      const balance = await loadBalance(tx, id);
      if (compareMoney(balance.outstanding, '0') <= 0) throw new ConflictException('This advance has nothing outstanding to settle');
      const dueOn = advanceSettlementDue(row, row.payments);
      if (!dueOn || dueOn >= dayOf(now)) throw new ConflictException('This advance is not overdue yet');

      const last = await tx.approvalAction.findFirst({ where: { requestId: id, action: 'REMINDED' }, orderBy: { at: 'desc' } });
      if (last && now.getTime() - last.at.getTime() < REMINDER_INTERVAL_MS) return { reminded: false, lastRemindedAt: last.at.toISOString() };

      const daysLate = Math.round((Date.parse(dayOf(now)) - Date.parse(dueOn)) / 86_400_000);
      await recordAction(tx, { requestId: id, revision: row.revision, step, action: 'REMINDED', actorId: actor.id, at: now });
      const payload: FinanceAdvanceSettlementReminder = { ...factsOf(row, actor.id, null, now), dueOn, daysLate, outstanding: balance.outstanding };
      await emit(tx, SUBJECTS.FINANCE_ADVANCE_SETTLEMENT_REMINDER, payload, actor.id);
      await recordAudit(tx, { actorId: actor.id, action: 'finance.advance.settlement_reminded', objectId: id, previousState: {}, newState: { dueOn, daysLate } });
      return { reminded: true, lastRemindedAt: now.toISOString() };
    });
  }
}
