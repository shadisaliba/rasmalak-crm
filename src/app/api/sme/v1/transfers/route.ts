import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { transferInput } from '@/sme/ledger/api/schemas';

export const POST = smeRoute(async ({ request, db, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const { from_account_id, to_account_id, ...transfer } = await parseBody(request, transferInput);
  const body = await callRpc(db, 'sme_post_transfer', {
    p_org: org, p_from: from_account_id, p_to: to_account_id, p_transfer: transfer, p_correlation_id: correlationId, p_idem: key,
  });
  return { status: 201, body };
});
