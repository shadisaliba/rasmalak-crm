import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { decisionBody } from '@/sme/actions/api/schemas';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, params, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const body = await parseBody(request, decisionBody);
  const res = await callRpc(db, 'sme_decide_action', {
    p_org: org, p_action: uuidParam(params.id), p_decision: body.decision, p_snooze_until: body.snooze_until ?? null,
    p_reason: body.reason ?? null, p_correlation_id: correlationId, p_idem: key,
  });
  return { body: res };
});
