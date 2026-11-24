import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.uuid();
const minor = z.string().regex(/^\d{1,16}$/);
const signedMinor = z.string().regex(/^-?\d{1,16}$/);
const recurrence = z.enum(['none', 'weekly', 'monthly', 'quarterly', 'annually']);

export const scenarioOverride = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shift_receipts_days'), days: z.number().int().min(-180).max(180) }),
  z.object({ type: z.literal('move_bill'), bill_id: uuid, new_date: isoDate }),
  z.object({
    type: z.literal('add_item'), label: z.string().trim().min(1).max(120), direction: z.enum(['in', 'out']),
    amount_minor: minor.refine(v => BigInt(v) > 0n), date: isoDate, recurrence: recurrence.optional(), end_date: isoDate.nullable().optional(),
  }),
  // A scheduled item id, or `series:<key>` for a detected series.
  z.object({ type: z.literal('remove_item'), item_id: z.string().min(1).max(220) }),
  z.object({ type: z.literal('include_uncertain_receivables') }),
  z.object({ type: z.literal('revenue_delta_pct'), pct: z.string().regex(/^-?\d{1,3}(\.\d{1,2})?$/).refine(v => Number(v) >= -100 && Number(v) <= 500) }),
  z.object({ type: z.literal('payroll_delta_minor'), amount_minor: signedMinor }),
]);

export const scenarioOverrides = z.array(scenarioOverride).max(50);

export const scenarioBody = z.object({
  name: z.string().trim().min(1).max(80),
  overrides: scenarioOverrides,
});

export const scheduledItemBody = z.object({
  label: z.string().trim().min(1).max(120),
  direction: z.enum(['in', 'out']),
  amount_minor: minor.refine(v => BigInt(v) > 0n),
  start_date: isoDate,
  recurrence: recurrence.default('none'),
  end_date: isoDate.nullable().optional(),
  category_id: uuid.nullable().optional(),
  counterparty_company_id: uuid.nullable().optional(),
  counterparty_contact_id: uuid.nullable().optional(),
  is_estimate: z.boolean().default(false),
  source: z.enum(['owner_entered', 'detected_confirmed']).default('owner_entered'),
  series_key: z.string().min(1).max(200).nullable().optional(),
}).refine(v => !v.end_date || v.end_date >= v.start_date, { path: ['end_date'], message: 'before_start' })
  .refine(v => v.source !== 'detected_confirmed' || !!v.series_key, { path: ['series_key'], message: 'required' });

export const settingsBody = z.object({
  buffer_minor: minor.optional(),
  dismissed_series: z.array(z.string().min(1).max(200)).max(500).optional(),
}).refine(v => v.buffer_minor !== undefined || v.dismissed_series !== undefined, { message: 'empty' });

export const forecastRunBody = z.object({ scenario_id: uuid.nullable().optional() });
export const latestQuery = z.object({ scenario_id: uuid.optional() });
