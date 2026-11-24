import { orgIdFrom, parseQuery, smeRoute } from '@/sme/api/route';
import { latestForecast } from '@/sme/forecast/server/forecast';
import { latestQuery } from '@/sme/forecast/api/schemas';

// The latest stored run; `stale` says today's inputs differ and POST /forecasts should recompute.
export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const query = parseQuery(request, latestQuery);
  return { body: await latestForecast(db, org, query.scenario_id ?? null) };
});
