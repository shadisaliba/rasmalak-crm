import { z } from 'zod';
import { isoDate, minorAmount } from '@/sme/ledger/api/schemas';
import { QUANTITY_PATTERN } from '../domain/totals';

const uuid = z.uuid();

export const createInvoiceInput = z.object({
  number: z.string().trim().max(60).optional(),
  customer_company_id: uuid.optional(),
  customer_contact_id: uuid.optional(),
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
}).refine(v => !!v.customer_company_id !== !!v.customer_contact_id, { path: ['customer_company_id'], message: 'exactly_one' })
  .refine(v => v.due_date >= v.issue_date, { path: ['due_date'], message: 'before_issue_date' });

export const statusInput = z.object({ to: z.enum(['open', 'void', 'written_off']), reason: z.string().trim().max(500).optional() });
export const allocateInput = z.object({ transaction_id: uuid, amount_minor: minorAmount });
export const reasonInput = z.object({ reason: z.string().trim().min(1).max(500) });
export const listInvoicesQuery = z.object({
  status: z.enum(['draft', 'open', 'partially_paid', 'paid', 'overdue', 'void', 'written_off']).optional(),
  customer_company_id: uuid.optional(),
  customer_contact_id: uuid.optional(),
});
