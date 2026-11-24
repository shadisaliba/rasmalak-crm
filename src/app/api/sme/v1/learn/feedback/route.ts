import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { feedbackBody } from '@/sme/content/api/schemas';

export const POST = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, feedbackBody);
  const body = await callRpc(db, 'content_record_feedback', {
    p_org: org, p_version: input.version_id, p_useful: input.useful, p_comment: input.comment ?? null, p_idem: key,
  });
  return { status: 201, body };
});
