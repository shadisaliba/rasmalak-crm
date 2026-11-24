import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { taskBody } from '@/sme/actions/api/schemas';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, params, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const body = await parseBody(request, taskBody);
  const res = await callRpc(db, 'sme_action_create_task', {
    p_org: org, p_action: uuidParam(params.id), p_title: body.title, p_due: body.due_date ?? null, p_correlation_id: correlationId, p_idem: key,
  });
  return { status: 201, body: res };
});
