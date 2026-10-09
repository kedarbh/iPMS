import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { uuidv7, type CreateRequestDto } from '@ipms/contracts';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS, PROJECT, aCategory, resetDb, scopes } from '../../prisma/fixtures.js';
import { RequestService } from './request.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: RequestService;
let categoryId: string;

beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; service = new RequestService(prisma); categoryId = await aCategory(prisma); }, 180_000);
afterAll(async () => { await db?.stop(); });
beforeEach(async () => { await resetDb(prisma); });

const invoice = (amount: string) => ({ vendor: 'Himal Fuel', invoiceNumber: `INV-${amount}`, invoiceDate: new Date('2026-10-01'), amount, mediaId: uuidv7() });
const advanceDto = (amount = '50000'): CreateRequestDto => ({ kind: 'ADVANCE', projectId: PROJECT.id, categoryId, purpose: 'Site travel', amount });

/** Makes a PAID advance for the engineer, without going through the whole chain. */
async function paidAdvance(approved = '50000.00') {
  const created = await service.create(advanceDto(approved), ACTORS.engineer, scopes.project, PROJECT);
  await prisma.financeRequest.update({ where: { id: created.id }, data: { status: 'PAID', approvedAmount: approved } });
  return created.id;
}

describe('create', () => {
  it('creates a draft advance with a number, the project snapshot and the requested amount', async () => {
    const created = await service.create(advanceDto('50000'), ACTORS.engineer, scopes.project, PROJECT);
    expect(created).toMatchObject({
      kind: 'ADVANCE', status: 'DRAFT', requesterId: ACTORS.engineer.id, projectCode: 'KOS', projectName: 'Koshi Rollout',
      requestedAmount: '50000.00', approvedAmount: null,
    });
    expect(created.number).toMatch(/^ADV-\d{4}-0001$/);
  });

  it('stores an invoice that has no file attached', async () => {
    const { mediaId: _omitted, ...bare } = invoice('120');
    const r = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [bare] }, ACTORS.engineer, scopes.project, PROJECT);
    expect(r.invoices?.[0]).toMatchObject({ vendor: 'Himal Fuel', mediaId: null });
  });

  it('numbers each kind and year independently and in sequence', async () => {
    const a = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    const b = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    expect(a.number.endsWith('-0001')).toBe(true);
    expect(b.number.endsWith('-0002')).toBe(true);
    const r = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [invoice('100')] }, ACTORS.engineer, scopes.project, PROJECT);
    expect(r.number).toMatch(/^REI-\d{4}-0001$/);
  });

  it('sums invoices into the requested amount of a reimbursement', async () => {
    const r = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [invoice('100.10'), invoice('250.25')] }, ACTORS.engineer, scopes.project, PROJECT);
    expect(r.requestedAmount).toBe('350.35');
    expect(r.invoices).toHaveLength(2);
  });

  it('refuses a project outside the caller\'s scope', async () => {
    await expect(service.create(advanceDto(), ACTORS.engineer, scopes.otherProject, PROJECT)).rejects.toThrow(/access to this project/);
  });

  it('refuses without the create permission', async () => {
    const viewer = { id: uuidv7(), permissions: ['finance_request.view'] };
    await expect(service.create(advanceDto(), viewer, scopes.project, PROJECT)).rejects.toThrow(/finance_request\.create/);
  });

  it('refuses a disabled or unknown category', async () => {
    await expect(service.create({ ...advanceDto(), categoryId: uuidv7() }, ACTORS.engineer, scopes.project, PROJECT)).rejects.toThrow(/active expense category/);
  });

  it('settles only a paid advance that belongs to the caller', async () => {
    const advanceId = await paidAdvance();
    const dto: CreateRequestDto = { kind: 'SETTLEMENT', advanceId, categoryId, purpose: 'Fuel bills', invoices: [invoice('4000')] };

    const settlement = await service.create(dto, ACTORS.engineer, scopes.project);
    expect(settlement).toMatchObject({ kind: 'SETTLEMENT', projectId: PROJECT.id, advanceId, requestedAmount: '4000.00' });
    expect(settlement.number).toMatch(/^SET-/);

    await expect(service.create(dto, ACTORS.otherEngineer, scopes.project)).rejects.toThrow(/Advance not found/);
    const draftAdvance = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.create({ ...dto, advanceId: draftAdvance.id }, ACTORS.engineer, scopes.project)).rejects.toThrow(/paid advance/);
  });

  it('needs the settlement permission to settle', async () => {
    const advanceId = await paidAdvance();
    const noSettle = { id: ACTORS.engineer.id, permissions: ['finance_request.view', 'finance_request.create'] };
    await expect(service.create({ kind: 'SETTLEMENT', advanceId, categoryId, purpose: 'x', invoices: [invoice('1')] }, noSettle, scopes.project)).rejects.toThrow(/finance_settlement\.submit/);
  });
});

describe('update', () => {
  it('edits a draft, replacing invoices and recomputing the amount', async () => {
    const r = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [invoice('100')] }, ACTORS.engineer, scopes.project, PROJECT);
    const updated = await service.update(r.id, { purpose: 'Fuel and tolls', invoices: [invoice('300'), invoice('50.50')] }, ACTORS.engineer);
    expect(updated).toMatchObject({ purpose: 'Fuel and tolls', requestedAmount: '350.50' });
    expect(updated.invoices).toHaveLength(2);
  });

  it('refuses someone else\'s request, and a request already submitted', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.update(r.id, { purpose: 'x' }, ACTORS.otherEngineer)).rejects.toThrow(/not found/);
    await service.submit(r.id, ACTORS.engineer);
    await expect(service.update(r.id, { purpose: 'y' }, ACTORS.engineer)).rejects.toThrow(/draft or returned/);
  });

  it('refuses to edit a request that was submitted while the edit was in flight', async () => {
    for (let round = 0; round < 5; round++) {
      const r = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [invoice('100')] }, ACTORS.engineer, scopes.project, PROJECT);
      const [, edit] = await Promise.allSettled([
        service.submit(r.id, ACTORS.engineer),
        service.update(r.id, { purpose: 'late edit', invoices: [invoice('999')] }, ACTORS.engineer),
      ]);
      const row = await prisma.financeRequest.findUniqueOrThrow({ where: { id: r.id }, include: { invoices: true } });
      const invoiceAmounts = row.invoices.map((i) => i.amount.toFixed(2));
      if (row.status === 'DRAFT') {
        // submit lost the race (conflict); the edit must have been applied whole
        expect(edit.status).toBe('fulfilled');
        continue;
      }
      expect(row.status).toBe('PENDING_PM');
      expect(row.invoices).toHaveLength(1);
      if (edit.status === 'fulfilled') {
        expect([row.purpose, row.requestedAmount.toFixed(2), invoiceAmounts]).toEqual(['late edit', '999.00', ['999.00']]);
      } else {
        expect(String(edit.reason)).toMatch(/draft or returned|changed/);
        expect([row.purpose, row.requestedAmount.toFixed(2), invoiceAmounts]).toEqual(['Fuel', '100.00', ['100.00']]);
      }
    }
  });

  it('re-checks the creation permission: a requester who lost it cannot edit their draft', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    const revoked = { id: ACTORS.engineer.id, permissions: ['finance_request.view'] };
    await expect(service.update(r.id, { purpose: 'x' }, revoked)).rejects.toThrow(expect.objectContaining({ status: 403, message: expect.stringMatching(/finance_request\.create/) }));
    expect((await prisma.financeRequest.findUniqueOrThrow({ where: { id: r.id } })).purpose).toBe('Site travel');
  });

  it('refuses an amount on a request that has invoices, and invoices on an advance', async () => {
    const adv = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.update(adv.id, { invoices: [invoice('1')] }, ACTORS.engineer)).rejects.toThrow(/advance has no invoices/i);
    const rei = await service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices: [invoice('100')] }, ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.update(rei.id, { amount: '5' }, ACTORS.engineer)).rejects.toThrow(/total of its invoices/i);
  });
});

describe('submit', () => {
  it('sends an engineer\'s request to the PM and records it', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    const submitted = await service.submit(r.id, ACTORS.engineer);
    expect(submitted).toMatchObject({ status: 'PENDING_PM', entryStatus: 'PENDING_PM', revision: 1 });
    expect(submitted.submittedAt).not.toBeNull();
    expect((await prisma.approvalAction.findMany({ where: { requestId: r.id } })).map((a) => [a.step, a.action])).toEqual([['REQUESTER', 'SUBMITTED']]);
    const events = await prisma.outboxEvent.findMany({ where: { subject: 'finance.request.submitted' } });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ requestId: r.id, nextStep: 'PM', requesterId: ACTORS.engineer.id, projectName: 'Koshi Rollout' });
  });

  it('sends a PM\'s request straight to the Director', async () => {
    const r = await service.create(advanceDto(), ACTORS.pm, scopes.project, PROJECT);
    const submitted = await service.submit(r.id, ACTORS.pm);
    expect(submitted.status).toBe('PENDING_DIRECTOR');
    expect((await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.submitted' } })).payload).toMatchObject({ nextStep: 'DIRECTOR' });
  });

  it('also writes an audit event', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await service.submit(r.id, ACTORS.engineer);
    const audits = await prisma.outboxEvent.findMany({ where: { subject: 'audit.event.recorded' } });
    expect(audits.map((a) => (a.payload as { action: string }).action)).toEqual(expect.arrayContaining(['finance.request.created', 'finance.request.submitted']));
  });

  it('re-checks the creation permission at submit time', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    const revoked = { id: ACTORS.engineer.id, permissions: ['finance_request.view', 'finance_settlement.submit'] };
    await expect(service.submit(r.id, revoked)).rejects.toThrow(expect.objectContaining({ status: 403, message: expect.stringMatching(/finance_request\.create/) }));
    expect((await prisma.financeRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('DRAFT');
  });

  it('re-checks the settlement permission when submitting a settlement', async () => {
    const advanceId = await paidAdvance();
    const s = await service.create({ kind: 'SETTLEMENT', advanceId, categoryId, purpose: 'x', invoices: [invoice('10')] }, ACTORS.engineer, scopes.project);
    const revoked = { id: ACTORS.engineer.id, permissions: ['finance_request.view', 'finance_request.create'] };
    await expect(service.submit(s.id, revoked)).rejects.toThrow(expect.objectContaining({ status: 403, message: expect.stringMatching(/finance_settlement\.submit/) }));
  });

  it('refuses to submit someone else\'s request', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.submit(r.id, ACTORS.otherEngineer)).rejects.toThrow(/not found/);
  });

  it('re-enters at the original step with a bumped revision after a return', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await service.submit(r.id, ACTORS.engineer);
    await prisma.financeRequest.update({ where: { id: r.id }, data: { status: 'RETURNED' } });
    const again = await service.submit(r.id, ACTORS.engineer);
    expect(again).toMatchObject({ status: 'PENDING_PM', revision: 2 });
  });

  it('refuses to settle an advance that is already fully settled', async () => {
    const advanceId = await paidAdvance('1000.00');
    const dto: CreateRequestDto = { kind: 'SETTLEMENT', advanceId, categoryId, purpose: 'x', invoices: [invoice('1000')] };
    const s = await service.create(dto, ACTORS.engineer, scopes.project);
    await prisma.financeRequest.create({ data: {
      id: uuidv7(), number: 'SET-2026-9999', kind: 'SETTLEMENT', status: 'SETTLED', advanceId, projectId: PROJECT.id, projectCode: 'KOS', projectName: 'K',
      categoryId, requesterId: ACTORS.engineer.id, purpose: 'x', requestedAmount: '1000.00', approvedAmount: '1000.00', appliedAmount: '1000.00',
    } });
    await expect(service.submit(s.id, ACTORS.engineer)).rejects.toThrow(/nothing outstanding/);
  });
});

describe('bills claimed twice', () => {
  const bill = (over: object = {}) => ({ vendor: 'Himal Fuel', invoiceNumber: '17', invoiceDate: new Date('2026-10-01'), amount: '900', ...over });
  const reimburse = (invoices: object[]) =>
    service.create({ kind: 'REIMBURSEMENT', projectId: PROJECT.id, categoryId, purpose: 'Fuel', invoices } as CreateRequestDto, ACTORS.engineer, scopes.project, PROJECT);

  it('refuses a vendor\'s invoice number that is already on another live request that fiscal year', async () => {
    const first = await reimburse([bill()]);
    await service.submit(first.id, ACTORS.engineer);
    const again = await reimburse([bill({ vendor: ' himal  fuel', invoiceDate: new Date('2026-10-20') })]);
    await expect(service.submit(again.id, ACTORS.engineer)).rejects.toThrow(/Invoice 17 from .* already claimed on REI-/);
  });

  it('lets the number be used again once the other request is cancelled, or in a new fiscal year, or by another vendor', async () => {
    const first = await reimburse([bill()]);
    await service.submit(first.id, ACTORS.engineer);
    await expect(service.submit((await reimburse([bill({ vendor: 'Everest Hardware' })])).id, ACTORS.engineer)).resolves.toMatchObject({ status: 'PENDING_PM' });
    await expect(service.submit((await reimburse([bill({ invoiceDate: new Date('2027-10-01') })])).id, ACTORS.engineer)).resolves.toMatchObject({ status: 'PENDING_PM' });
    await service.cancel(first.id, undefined, ACTORS.engineer);
    await expect(service.submit((await reimburse([bill()])).id, ACTORS.engineer)).resolves.toMatchObject({ status: 'PENDING_PM' });
  });

  it('refuses the number across New Year within one fiscal year, but not before the fiscal year turned over', async () => {
    const first = await reimburse([bill({ invoiceDate: new Date('2026-09-01') })]);
    await service.submit(first.id, ACTORS.engineer);
    const sameYear = await reimburse([bill({ invoiceDate: new Date('2027-02-01') })]);
    await expect(service.submit(sameYear.id, ACTORS.engineer)).rejects.toThrow(/already claimed/);
    const earlier = await reimburse([bill({ invoiceDate: new Date('2026-06-01') })]);
    await expect(service.submit(earlier.id, ACTORS.engineer)).resolves.toMatchObject({ status: 'PENDING_PM' });
  });

  it('refuses the same number listed twice on one request', async () => {
    const r = await reimburse([bill(), bill({ amount: '50' })]);
    await expect(service.submit(r.id, ACTORS.engineer)).rejects.toThrow(/more than once/);
  });

  it('does not count a request against itself when it is resubmitted', async () => {
    const r = await reimburse([bill()]);
    await service.submit(r.id, ACTORS.engineer);
    await expect(service.submit(r.id, ACTORS.engineer)).rejects.toThrow(/draft or returned/);
  });
});

describe('cancel', () => {
  it('lets the requester cancel while pending, recording who was holding it', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await service.submit(r.id, ACTORS.engineer);
    const cancelled = await service.cancel(r.id, 'No longer needed', ACTORS.engineer);
    expect(cancelled.status).toBe('CANCELLED');
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { subject: 'finance.request.cancelled' } });
    expect(event.payload).toMatchObject({ heldBy: 'PM', comment: 'No longer needed' });
  });

  it('refuses anyone but the requester, and a request that is not pending', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await expect(service.cancel(r.id, undefined, ACTORS.engineer)).rejects.toThrow(/pending/);
    await service.submit(r.id, ACTORS.engineer);
    await expect(service.cancel(r.id, undefined, ACTORS.otherEngineer)).rejects.toThrow(/not found/);
  });

  it('needs the cancel permission', async () => {
    const r = await service.create(advanceDto(), ACTORS.engineer, scopes.project, PROJECT);
    await service.submit(r.id, ACTORS.engineer);
    await expect(service.cancel(r.id, undefined, { id: ACTORS.engineer.id, permissions: ['finance_request.view'] })).rejects.toThrow(/finance_request\.cancel/);
  });
});
