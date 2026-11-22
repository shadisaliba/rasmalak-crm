import { z } from 'zod';

const prefillRef = z.object({
  field: z.string().min(1).max(60),
  source: z.enum(['cash_total', 'receivables_outstanding', 'payables_outstanding']),
  value_minor: z.string().regex(/^-?\d{1,19}$/),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** POST /api/sme/v1/calculations/{code}. The input itself is validated by the calculator. */
export const runCalculationBody = z.object({
  input: z.record(z.string(), z.unknown()),
  save: z.boolean().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  /** Inputs that came from a prefill suggestion, and those the user then changed (CAL-02). */
  prefill_refs: z.array(prefillRef).max(20).optional(),
  overrides: z.array(z.string().min(1).max(60)).max(40).optional(),
}).refine(b => !b.save || !!b.name, { path: ['name'], message: 'required' });

export const listCalculationsQuery = z.object({
  saved: z.enum(['true', 'false']).optional(),
  code: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  id: z.string().uuid().optional(),
});
