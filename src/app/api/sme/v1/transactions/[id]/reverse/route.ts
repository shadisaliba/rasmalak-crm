import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { reverseInput } from '@/sme/ledger/api/schemas';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, reverseInput);
  const body = await callRpc(db, 'sme_reverse_transaction', {
    p_org: org, p_tx_id: uuidParam(params.id), p_reason: input.reason, p_correlation_id: correlationId, p_idem: key,
  });
  return { status: 201, body };
});
