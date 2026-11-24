import { callRpc, idempotencyKeyFrom, orgIdFrom, smeRoute, uuidParam } from '@/sme/api/route';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, params, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const res = await callRpc(db, 'sme_archive_scenario', { p_org: org, p_id: uuidParam(params.id), p_correlation_id: correlationId, p_idem: key });
  return { body: res };
});
