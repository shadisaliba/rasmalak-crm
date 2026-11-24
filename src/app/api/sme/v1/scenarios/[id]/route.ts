import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { scenarioBody } from '@/sme/forecast/api/schemas';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, params, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const body = await parseBody(request, scenarioBody);
  const res = await callRpc(db, 'sme_save_scenario', { p_org: org, p_id: uuidParam(params.id), p_name: body.name, p_overrides: body.overrides, p_correlation_id: correlationId, p_idem: key });
  return { body: res };
});
