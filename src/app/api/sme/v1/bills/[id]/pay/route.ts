import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { payBillInput } from '@/sme/payables/api/schemas';

// Records a payment that already happened and matches it; it never initiates one (§12).
export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, payBillInput);
  const body = await callRpc(db, 'sme_pay_bill', { p_org: org, p_bill: uuidParam(params.id), p_payment: input, p_correlation_id: correlationId, p_idem: key });
  return { status: 201, body };
});
