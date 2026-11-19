import { z } from 'zod';
import { CURRENCY_CODES } from '@/sme/money';

// Minor units travel as strings: bigint does not survive JSON, and 16 digits stay within both
// the ledger bound (±9e15) and JavaScript's safe integer range.
export const minorAmount = z.string().regex(/^-?[0-9]{1,16}$/);
export const positiveMinorAmount = z.string().regex(/^[0-9]{1,16}$/).refine(v => BigInt(v) > 0n);
export const isoDate = z.iso.date();
const uuid = z.uuid();
const text = (max: number) => z.string().trim().max(max);

export const ACCOUNT_KINDS = ['bank', 'cash', 'wallet', 'card', 'other'] as const;
export const CHANNELS = ['cash', 'bank_transfer', 'cliq', 'wallet', 'pos_card', 'cheque', 'efawateercom', 'direct_debit', 'other', 'unknown'] as const;

export const fxInput = z.object({
  rate: z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,12})?$/),
  rate_date: isoDate,
  source: z.enum(['aggregator:open.er-api.com', 'manual']),
  reason: text(500).optional(),
}).refine(fx => fx.source !== 'manual' || !!fx.reason, { path: ['reason'], message: 'required' });

export const classificationInput = z.object({
  category_id: uuid.nullable().optional(),
  channel: z.enum(CHANNELS).optional(),
  counterparty_company_id: uuid.nullable().optional(),
  counterparty_contact_id: uuid.nullable().optional(),
  note: text(1000).optional(),
});

export const createAccountInput = z.object({
  account: z.object({
    kind: z.enum(ACCOUNT_KINDS),
    name: text(120).min(1),
    name_ar: text(120).optional(),
    institution: text(120).optional(),
    currency: z.enum(CURRENCY_CODES as [string, ...string[]]),
  }),
  opening: z.object({
    amount_minor: minorAmount,
    value_date: isoDate,
    is_estimate: z.boolean(),
    fx: fxInput.optional(),
  }).optional(),
});

export const postTransactionInput = z.object({
  account_id: uuid,
  value_date: isoDate,
  amount_minor: minorAmount.refine(v => BigInt(v) !== 0n),
  currency: z.string().length(3).optional(),
  description: text(500).optional(),
  external_ref: text(120).optional(),
  fx: fxInput.optional(),
  classification: classificationInput.optional(),
});

export const reverseInput = z.object({ reason: text(500).min(1) });

export const transferInput = z.object({
  from_account_id: uuid,
  to_account_id: uuid,
  amount_minor: positiveMinorAmount,
  to_amount_minor: positiveMinorAmount.optional(),
  value_date: isoDate,
  description: text(500).optional(),
  channel: z.enum(CHANNELS).optional(),
  fx: fxInput.optional(),
}).refine(t => t.from_account_id !== t.to_account_id, { path: ['to_account_id'], message: 'same_account' });

const cursor = z.object({ value_date: isoDate, created_at: z.string().min(1).max(40), id: uuid });

export const listTransactionsQuery = z.object({
  account: uuid.optional(),
  category: uuid.optional(),
  channel: z.enum(CHANNELS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: text(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(400).optional(),
});

export function encodeCursor(row: { value_date: string; created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ value_date: row.value_date, created_at: row.created_at, id: row.id })).toString('base64url');
}

export function decodeCursor(value: string): z.infer<typeof cursor> | null {
  try {
    const parsed = cursor.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
