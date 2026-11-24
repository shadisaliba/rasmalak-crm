import { orgIdFrom, smeRoute } from '@/sme/api/route';
import { catalogueEntry, listCalculators } from '@/sme/calc/core/run';
import { loadCalcContext } from '@/sme/calc/server/context';

// CAL-01: the catalogue, with each calculator's availability for this organization today.
export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const ctx = await loadCalcContext(db, org);
  return { body: { as_of: ctx.asOf, items: listCalculators().map(c => catalogueEntry(c, ctx)) } };
});
