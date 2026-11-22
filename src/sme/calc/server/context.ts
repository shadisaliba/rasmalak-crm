import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { callRpc } from '@/sme/api/route';
import type { ApprovedParam, CalcContext } from '../core/types';

const contextRow = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  params: z.array(z.object({
    key: z.string(),
    value: z.string(),
    unit: z.enum(['percent', 'money_minor', 'number']),
    rule_version_id: z.string().uuid(),
    source_url: z.string(),
    valid_from: z.string(),
    valid_to: z.string().nullable(),
  })),
});

/**
 * The date and the published rule parameters for a run, as the database decides them. Calls
 * sme_calc_context with the user's JWT, so it also enforces sme.calc.run.
 */
export async function loadCalcContext(db: SupabaseClient, org: string): Promise<CalcContext> {
  const row = contextRow.parse(await callRpc<unknown>(db, 'sme_calc_context', { p_org: org }));
  const params: ApprovedParam[] = row.params.map(p => ({
    key: p.key, value: p.value, unit: p.unit, ruleVersionId: p.rule_version_id, sourceUrl: p.source_url,
    validFrom: p.valid_from, validTo: p.valid_to,
  }));
  return {
    asOf: row.as_of,
    getRuleParam: (ref, onDate) =>
      params.find(p => p.key === ref.key && p.validFrom <= onDate && (p.validTo === null || onDate <= p.validTo)) ?? null,
  };
}
