import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { uuidv7 } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { RequestService } from '../requests/request.service.js';
import { ReminderService } from './reminder.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let requests: RequestService;
let categoryId: string;
let clock = new Date('2026-10-20T06:00:00Z');
let reminders: ReminderService;

beforeAll(async () => {
  db = await startTestDb(); prisma = db.prisma;
  requests = new RequestService(prisma);
  reminders = new ReminderService(prisma, () => clock);
  categoryId = await aCategory(prisma);
}, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); clock = new Date('2026-10-20T06:00:00Z'); });

/** A PAID advance for the engineer, paid out on [paidOn] (so due a week later). */
async function paidAdvance(paidOn = '2026-10-05') {
  const r = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Travel', amount: '10000' }, ACTORS.engineer, scopes.project, PROJECT);
  await prisma.financeRequest.update({ where: { id: r.id }, data: { status: 'PAID', approvedAmount: '10000' } });
  await prisma.payment.create({ data: { id: uuidv7(), requestId: r.id, kind: 'PAYOUT', mode: 'CASH', reference: 'V-1', paidOn: new Date(paidOn), amount: '10000', recordedBy: ACTORS.finance.id } });
  return r.id;
}
const queued = () => prisma.outboxEvent.findMany({ where: { subject: 'finance.advance.settlement_reminder' } });

describe('remind', () => {
  it('queues a reminder for an overdue advance and records who sent it', async () => {
    const id = await paidAdvance();
    expect(await reminders.remind(id, ACTORS.finance, scopes.global)).toMatchObject({ reminded: true });
    const [event] = await queued();
    expect(event!.payload).toMatchObject({ requestId: id, requesterId: ACTORS.engineer.id, dueOn: '2026-10-12', daysLate: 8, outstanding: '10000.00' });
    expect(await prisma.approvalAction.findFirst({ where: { requestId: id, action: 'REMINDED' } })).toMatchObject({ step: 'FINANCE', actorId: ACTORS.finance.id });
  });

  it('sends at most one reminder a day for an advance, whoever asks', async () => {
    const id = await paidAdvance();
    await reminders.remind(id, ACTORS.finance, scopes.global);
    expect(await reminders.remind(id, ACTORS.director, scopes.global)).toMatchObject({ reminded: false });
    expect(await queued()).toHaveLength(1);
    clock = new Date('2026-10-21T07:00:00Z');
    expect(await reminders.remind(id, ACTORS.director, scopes.global)).toMatchObject({ reminded: true });
    expect(await queued()).toHaveLength(2);
  });

  it('refuses an advance that is not overdue yet, including its last day', async () => {
    const id = await paidAdvance('2026-10-13');
    await expect(reminders.remind(id, ACTORS.finance, scopes.global)).rejects.toThrow(/not overdue/);
    clock = new Date('2026-10-20T23:00:00Z');
    await expect(reminders.remind(id, ACTORS.finance, scopes.global)).rejects.toThrow(/not overdue/);
  });

  it('refuses while a settlement is under review, and when nothing is outstanding', async () => {
    const id = await paidAdvance();
    await prisma.financeRequest.update({ where: { id }, data: {} });
    const s = await requests.create({ kind: 'SETTLEMENT', advanceId: id, categoryId, purpose: 'Bills', invoices: [{ vendor: 'V', invoiceNumber: 'A-1', invoiceDate: new Date('2026-10-02'), amount: '4000' }] }, ACTORS.engineer, scopes.project);
    await prisma.financeRequest.update({ where: { id: s.id }, data: { status: 'PENDING_PM' } });
    await expect(reminders.remind(id, ACTORS.finance, scopes.global)).rejects.toThrow(/under review/);

    await prisma.financeRequest.update({ where: { id: s.id }, data: { status: 'SETTLED', appliedAmount: '10000' } });
    await expect(reminders.remind(id, ACTORS.finance, scopes.global)).rejects.toThrow(/nothing outstanding/);
  });

  it('is for approvers and Finance within their scope, never for the engineer themselves', async () => {
    const id = await paidAdvance();
    await expect(reminders.remind(id, ACTORS.engineer, scopes.project)).rejects.toThrow(/cannot send/);
    await expect(reminders.remind(id, ACTORS.pm, scopes.otherProject)).rejects.toThrow(/not found/);
    expect(await reminders.remind(id, ACTORS.pm, scopes.project)).toMatchObject({ reminded: true });
    const own = await requests.create({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Mine', amount: '500' }, ACTORS.pm, scopes.project, PROJECT);
    await prisma.financeRequest.update({ where: { id: own.id }, data: { status: 'PAID', approvedAmount: '500' } });
    await prisma.payment.create({ data: { id: uuidv7(), requestId: own.id, kind: 'PAYOUT', mode: 'CASH', reference: 'V-2', paidOn: new Date('2026-10-05'), amount: '500', recordedBy: ACTORS.finance.id } });
    await expect(reminders.remind(own.id, ACTORS.pm, scopes.project)).rejects.toThrow(/yourself/);
  });
});
