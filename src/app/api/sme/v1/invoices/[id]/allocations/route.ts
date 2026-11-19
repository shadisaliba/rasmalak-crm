import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { allocateInput } from '@/sme/receivables/api/schemas';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, allocateInput);
  const body = await callRpc(db, 'sme_allocate_receipt', {
    p_org: org, p_invoice: uuidParam(params.id), p_transaction: input.transaction_id, p_amount_minor: input.amount_minor,
    p_correlation_id: correlationId, p_idem: key,
  });
  return { status: 201, body };
});
