import { idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { forecastRunBody } from '@/sme/forecast/api/schemas';
import { recordForecast } from '@/sme/forecast/server/forecast';

// FIN-05: compute the baseline or a scenario and store the run (once per input digest).
export const POST = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  idempotencyKeyFrom(request);
  const body = await parseBody(request, forecastRunBody);
  return { status: 201, body: await recordForecast(db, org, body.scenario_id ?? null) };
});
