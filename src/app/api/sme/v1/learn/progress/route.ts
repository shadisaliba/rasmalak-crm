import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { progressBody } from '@/sme/content/api/schemas';

// Opening, resuming and completing a lesson. Completion never depends on the quiz.
export const POST = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const { version_id, ...progress } = await parseBody(request, progressBody);
  const body = await callRpc(db, 'content_record_progress', { p_org: org, p_version: version_id, p_progress: progress, p_idem: key });
  return { body };
});
