import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { billStatusInput } from '@/sme/payables/api/schemas';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const { to, reason } = await parseBody(request, billStatusInput);
  const args: Record<string, unknown> = { p_org: org, p_bill: uuidParam(params.id), p_correlation_id: correlationId, p_idem: key };
  if (to === 'void') args.p_reason = reason ?? null;
  return { body: await callRpc(db, to === 'open' ? 'sme_approve_bill' : 'sme_void_bill', args) };
});
