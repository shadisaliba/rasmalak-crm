import { z } from 'zod';

// Regulatory facts the owner states about the business. Compliance rules (W3b-05) read these;
// nothing in the product infers them from revenue or transactions (blueprint §4).
// Mirrors sme_fact_keys() and sme_fact_value_valid() in the profile migration.

export const JOFOTARA_STATUSES = ['unknown', 'not_registered', 'registered_unsure', 'registered_active'] as const;

export const FACTS = {
  'legal.form': { input: 'legal_form', schema: z.string().min(1) },
  'income_tax.registered': { input: 'boolean', schema: z.boolean() },
  'income_tax.number_known': { input: 'boolean', schema: z.boolean() },
  'sales_tax.registered': { input: 'boolean', schema: z.boolean() },
  'jofotara.status': { input: 'jofotara', schema: z.enum(JOFOTARA_STATUSES) },
  'employees.count': { input: 'count', schema: z.number().int().min(0) },
  'ssc.registered': { input: 'boolean', schema: z.boolean() },
  'premises.licensed': { input: 'boolean', schema: z.boolean() },
  'activity.regulated': { input: 'boolean', schema: z.boolean() },
} as const;

export type FactKey = keyof typeof FACTS;
export const FACT_KEYS = Object.keys(FACTS) as FactKey[];
export type FactStatus = 'known' | 'unknown' | 'needs_confirmation';

/** Facts set on the facts screen; legal form is set with the business identity. */
export const OWNER_FACT_KEYS = FACT_KEYS.filter(k => k !== 'legal.form');

export const factLabelKey = (key: FactKey) => `sme.fact.${key}.label`;

export function isValidFactValue(key: FactKey, value: unknown): boolean {
  return FACTS[key].schema.safeParse(value).success;
}
