import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { SmeError } from '@/sme/api/errors';
import { isCalculatorCode, runCalculation } from '@/sme/calc/core/run';
import { loadCalcContext } from '@/sme/calc/server/context';
import { runCalculationBody } from '@/sme/calc/api/schemas';

// CAL-02/CAL-03: run a calculator and record the run; with save and a name it is a scenario (CAL-04).
export const POST = smeRoute<unknown, { code: string }>(async ({ request, db, params, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  if (!isCalculatorCode(params.code)) throw new SmeError('NOT_FOUND', { field: 'code' });
  const body = await parseBody(request, runCalculationBody);
  const ctx = await loadCalcContext(db, org);

  const run = runCalculation(params.code, body.input, ctx);
  if (!run.outcome.ok) throw new SmeError(run.outcome.errors[0].code, { errors: run.outcome.errors });

  const { output, trace, assumptions, warnings, ruleVersionIds } = run.outcome;
  const record = await callRpc<{ id: string; created_at: string; is_saved: boolean; name: string | null }>(db, 'sme_record_calculation', {
    p_org: org,
    p_record: {
      calculator_code: run.code, calculator_version: run.version, as_of: run.asOf, input: body.input,
      prefill_refs: body.prefill_refs ?? [], overrides: body.overrides ?? [],
      output, trace, assumptions, warnings, rule_version_ids: ruleVersionIds,
      is_saved: body.save ?? false, name: body.name ?? null,
    },
    p_correlation_id: correlationId,
    p_idem: key,
  });
  return { status: 201, body: { record, code: run.code, version: run.version, as_of: run.asOf, output, trace, assumptions, warnings } };
});
