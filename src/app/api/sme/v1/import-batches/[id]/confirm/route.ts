import { callRpc, idempotencyKeyFrom, orgIdFrom, smeRoute, uuidParam } from '@/sme/api/route';
import { SmeError } from '@/sme/api/errors';
import { isErrorCode } from '@/lib/apiError';

type CommitResult = { batch_id: string; posted: number; committed_at: string } | { error: { code: string; details?: Record<string, unknown> } };

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const result = await callRpc<CommitResult>(db, 'sme_commit_import', {
    p_org: org, p_batch: uuidParam(params.id), p_correlation_id: correlationId, p_idem: key,
  });
  // A failed posting is returned, not raised, so the error stays recorded on the batch.
  if ('error' in result) throw new SmeError(isErrorCode(result.error.code) ? result.error.code : 'INTERNAL', result.error.details ?? undefined);
  return { body: result };
});
