import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { reasonInput } from '@/sme/receivables/api/schemas';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const { reason } = await parseBody(request, reasonInput);
  const body = await callRpc(db, 'sme_reverse_allocation', { p_org: org, p_allocation: uuidParam(params.id), p_reason: reason, p_correlation_id: correlationId, p_idem: key });
  return { status: 201, body };
});
