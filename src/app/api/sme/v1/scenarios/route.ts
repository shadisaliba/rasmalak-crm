import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { scenarioBody } from '@/sme/forecast/api/schemas';

export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const { data, error } = await db.from('sme_scenarios').select('id, name, overrides, created_at, updated_at')
    .eq('org_id', org).eq('status', 'active').order('created_at');
  if (error) throw fromDbError(error);
  return { body: { scenarios: data ?? [] } };
});

export const POST = smeRoute(async ({ request, db, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const body = await parseBody(request, scenarioBody);
  const res = await callRpc(db, 'sme_save_scenario', { p_org: org, p_id: null, p_name: body.name, p_overrides: body.overrides, p_correlation_id: correlationId, p_idem: key });
  return { status: 201, body: res };
});
