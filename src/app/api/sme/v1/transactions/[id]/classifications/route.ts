import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { classificationInput } from '@/sme/ledger/api/schemas';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, classificationInput);
  const body = await callRpc(db, 'sme_classify_transaction', {
    p_org: org, p_tx_id: uuidParam(params.id), p_classification: input, p_correlation_id: correlationId, p_idem: key,
  });
  return { status: 201, body };
});
