import { callRpc, idempotencyKeyFrom, orgIdFrom, smeRoute, uuidParam } from '@/sme/api/route';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const body = await callRpc(db, 'sme_cancel_import', { p_org: org, p_batch: uuidParam(params.id), p_correlation_id: correlationId, p_idem: key });
  return { body };
});
