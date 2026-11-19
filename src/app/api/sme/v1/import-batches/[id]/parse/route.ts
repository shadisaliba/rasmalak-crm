import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { runOutboxSoon } from '@/sme/events/server/runSoon';
import { parseInput } from '@/sme/imports/api/schemas';

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, parseInput);
  const body = await callRpc(db, 'sme_request_import_parse', {
    p_org: org, p_batch: uuidParam(params.id), p_mapping: input.column_mapping, p_options: input.parse_options,
    p_correlation_id: correlationId, p_idem: key,
  });
  runOutboxSoon();
  return { status: 202, body };
});
