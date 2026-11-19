import { z } from 'zod';
import { CHANNELS, fxInput, isoDate, minorAmount } from '@/sme/ledger/api/schemas';
import { QUANTITY_PATTERN } from '@/sme/receivables/domain/totals';

const uuid = z.uuid();

export const createBillInput = z.object({
  supplier_reference: z.string().trim().max(60).optional(),
  supplier_company_id: uuid.optional(),
  supplier_contact_id: uuid.optional(),
  issue_date: isoDate,
  due_date: isoDate,
  currency: z.string().length(3).optional(),
  status: z.enum(['draft', 'open']),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(z.object({
    description: z.string().trim().min(1).max(500),
    quantity: z.string().regex(QUANTITY_PATTERN),
    unit_price_minor: minorAmount,
    tax_rate_bp: z.number().int().min(0).max(10000),
  })).min(1).max(200),
  expected: z.object({ subtotal_minor: minorAmount, tax_minor: minorAmount, total_minor: minorAmount }),
}).refine(v => !!v.supplier_company_id !== !!v.supplier_contact_id, { path: ['supplier_company_id'], message: 'exactly_one' })
  .refine(v => v.due_date >= v.issue_date, { path: ['due_date'], message: 'before_issue_date' });

export const billStatusInput = z.object({ to: z.enum(['open', 'void']), reason: z.string().trim().max(500).optional() });

export const payBillInput = z.object({
  account_id: uuid,
  value_date: isoDate,
  amount_minor: minorAmount,
  description: z.string().trim().max(500).optional(),
  channel: z.enum(CHANNELS).optional(),
  category_id: uuid.nullable().optional(),
  fx: fxInput.optional(),
});

export const listBillsQuery = z.object({
  status: z.enum(['draft', 'open', 'partially_paid', 'paid', 'overdue', 'void']).optional(),
});
