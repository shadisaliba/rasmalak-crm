import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { settingsBody } from '@/sme/forecast/api/schemas';

export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const { data, error } = await db.from('sme_forecast_settings').select('buffer_minor::text, dismissed_series').eq('org_id', org).maybeSingle();
  if (error) throw fromDbError(error);
  return { body: { settings: data ?? { buffer_minor: '0', dismissed_series: [] } } };
});

// The cash buffer, and detected series removed from (or restored to) the baseline.
export const POST = smeRoute(async ({ request, db, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const body = await parseBody(request, settingsBody);
  const res = await callRpc(db, 'sme_set_forecast_settings', { p_org: org, p_settings: body, p_correlation_id: correlationId, p_idem: key });
  return { body: res };
});
