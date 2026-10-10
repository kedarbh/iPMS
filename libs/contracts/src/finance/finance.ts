import { z } from 'zod';
import { UuidSchema } from '../common/ids.js';
import { PaginationSchema } from '../common/pagination.js';

/** Finance deals in one currency. It is a constant, not a column, so a second currency is a deliberate change. */
export const FINANCE_CURRENCY = 'NPR';

/** The VAT rate in Nepal. A bill marked VAT carries it inside its amount, not on top. */
export const VAT_RATE_PERCENT = 13;

/** An advance is to be settled within this many days of the day it was paid. */
export const SETTLEMENT_WINDOW_DAYS = 7;

export const RequestKindSchema = z.enum(['ADVANCE', 'SETTLEMENT', 'REIMBURSEMENT']);
export type RequestKind = z.infer<typeof RequestKindSchema>;

export const RequestStatusSchema = z.enum([
  'DRAFT', 'PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE', 'PAID', 'SETTLED', 'RETURNED', 'REJECTED', 'CANCELLED',
]);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const PaymentModeSchema = z.enum(['BANK_TRANSFER', 'CASH', 'CHEQUE', 'MOBILE_WALLET']);

/**
 * An amount as a string, at most two decimals, greater than zero. A string and
 * not a number so that "1500.50" survives JSON untouched and no arithmetic is
 * ever done on a float; the service converts to integer paisa.
 */
export const MoneySchema = z.string().trim()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, 'Enter an amount in NPR with at most two decimals')
  .refine((value) => Number(value) > 0, 'Amount must be greater than zero');

const TextSchema = (max: number) => z.string().trim().min(1).max(max);

export const InvoiceInputSchema = z.object({
  /** Who was paid, or what for. */
  vendor: TextSchema(200),
  /** A bill without VAT often has no number, so it is optional. */
  invoiceNumber: TextSchema(100).optional(),
  invoiceDate: z.coerce.date(),
  amount: MoneySchema,
  /** A VAT bill: [VAT_RATE_PERCENT] is included in `amount`. */
  vat: z.boolean().optional(),
  /** The supplier's PAN or VAT number, from a VAT bill. */
  supplierTaxNo: TextSchema(50).optional(),
  /** The uploaded invoice scan or photo, held by the media service. Optional until finance documents can be uploaded. */
  mediaId: UuidSchema.optional(),
});
export type InvoiceInput = z.infer<typeof InvoiceInputSchema>;

const InvoicesSchema = z.array(InvoiceInputSchema).min(1).max(100);

/** The requester's own detail on the expense or advance. */
const RemarksSchema = TextSchema(1000);

const Common = {
  categoryId: UuidSchema,
  purpose: TextSchema(500),
  remarks: RemarksSchema.optional(),
  workOrderId: UuidSchema.optional(),
};

export const CreateRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ADVANCE'), projectId: UuidSchema, amount: MoneySchema, ...Common }),
  z.object({ kind: z.literal('REIMBURSEMENT'), projectId: UuidSchema, invoices: InvoicesSchema, ...Common }),
  // A settlement belongs to its advance's project; it names no project of its own.
  z.object({ kind: z.literal('SETTLEMENT'), advanceId: UuidSchema, invoices: InvoicesSchema, ...Common }),
]);
export type CreateRequestDto = z.infer<typeof CreateRequestSchema>;

/** Edits to a draft or returned request. The kind and project never change. */
export const UpdateRequestSchema = z.object({
  categoryId: UuidSchema.optional(),
  purpose: TextSchema(500).optional(),
  /** `null` clears the remarks. */
  remarks: RemarksSchema.nullable().optional(),
  workOrderId: UuidSchema.nullable().optional(),
  amount: MoneySchema.optional(),
  invoices: InvoicesSchema.optional(),
}).strict();
export type UpdateRequestDto = z.infer<typeof UpdateRequestSchema>;

const CommentText = z.string().trim().min(1, 'A comment is required').max(1000);

/** Approve: the Director may set an amount; the PM may not (the service enforces which). */
export const ApproveSchema = z.object({ amount: MoneySchema.optional(), comment: CommentText.optional() }).strict();
export type ApproveDto = z.infer<typeof ApproveSchema>;

/** Return and reject say why. */
export const CommentSchema = z.object({ comment: CommentText }).strict();
export const OptionalCommentSchema = z.object({ comment: CommentText.optional() }).strict();

export const PaymentDetailsSchema = z.object({
  mode: PaymentModeSchema,
  reference: TextSchema(100),
  paidOn: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
  proofMediaId: UuidSchema.optional(),
});
export type PaymentDetailsDto = z.infer<typeof PaymentDetailsSchema>;

/**
 * Every field optional: a settlement with no payout needs none. The service demands them when money moves.
 * `balanceReceived` on a settlement also records the unspent balance the engineer handed over, closing the advance.
 */
export const PayRequestSchema = PaymentDetailsSchema.partial().extend({ balanceReceived: z.boolean().optional() });

export const CashReturnSchema = PaymentDetailsSchema.extend({ amount: MoneySchema });
export type CashReturnDto = z.infer<typeof CashReturnSchema>;

export const CategoryCreateSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]{2,30}$/, 'Use 2-30 capitals, digits or underscores'),
  name: TextSchema(100),
});
export const CategoryUpdateSchema = z.object({ name: TextSchema(100).optional(), disabled: z.boolean().optional() }).strict();

export const ListRequestsQuerySchema = PaginationSchema.extend({
  /** mine: my own. awaiting: waiting for my approval or payment. all: everything in my project scope. handled: others' requests I have already acted on, latest first. */
  view: z.enum(['mine', 'awaiting', 'all', 'handled']).default('mine'),
  status: RequestStatusSchema.optional(),
  kind: RequestKindSchema.optional(),
  projectId: UuidSchema.optional(),
});
export type ListRequestsQuery = z.infer<typeof ListRequestsQuerySchema>;

export const ReportQuerySchema = z.object({
  groupBy: z.enum(['project', 'category', 'requester']).default('project'),
  projectId: UuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'xlsx']).default('json'),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;
