import { orgIdFrom, parseQuery, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { listCalculationsQuery } from '@/sme/calc/api/schemas';

// CAL-04: saved scenarios (or one record by id), read through RLS with sme.calc.run.
export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const q = parseQuery(request, listCalculationsQuery);
  let query = db.from('sme_calculation_records')
    .select('id, calculator_code, calculator_version, as_of, input_snapshot, prefill_refs, overrides, output, assumptions, warnings, rule_version_ids, name, is_saved, created_at')
    .eq('org_id', org).order('created_at', { ascending: false }).limit(100);
  if (q.id) query = query.eq('id', q.id);
  if (q.saved) query = query.eq('is_saved', q.saved === 'true');
  if (q.code) query = query.eq('calculator_code', q.code);
  const { data, error } = await query;
  if (error) throw fromDbError(error);
  return { body: { items: data ?? [] } };
});
