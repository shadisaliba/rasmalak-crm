import { orgIdFrom, smeRoute } from '@/sme/api/route';
import { SmeError } from '@/sme/api/errors';
import { getCalculator, isCalculatorCode } from '@/sme/calc/core/run';
import { loadCalcContext } from '@/sme/calc/server/context';
import { loadPrefill } from '@/sme/calc/server/prefill';

// CAL-02: suggestions from the organization's records. Never runs a calculation.
export const GET = smeRoute<unknown, { code: string }>(async ({ request, db, params }) => {
  const org = orgIdFrom(request);
  if (!isCalculatorCode(params.code)) throw new SmeError('NOT_FOUND', { field: 'code' });
  const calc = getCalculator(params.code);
  if (!calc) throw new SmeError('NOT_FOUND', { field: 'code' });
  const ctx = await loadCalcContext(db, org);
  return { body: await loadPrefill(db, org, calc.fields, ctx.asOf) };
});
