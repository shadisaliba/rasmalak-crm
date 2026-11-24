import { orgIdFrom, parseQuery, smeRoute } from '@/sme/api/route';
import { periodQuery } from '@/sme/kpi/api/schemas';
import { currentMonth, getFinancialSummary } from '@/sme/kpi/server/summary';

// W3a-08: every metric with its basis, period, as-of date, coverage and status. Defaults to this month.
export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const q = parseQuery(request, periodQuery);
  const period = q.from && q.to ? { from: q.from, to: q.to } : currentMonth();
  return { body: await getFinancialSummary(db, org, period) };
});
