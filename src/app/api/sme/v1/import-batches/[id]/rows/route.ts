import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, parseQuery, smeRoute, uuidParam } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { reviewInput, rowsQuery } from '@/sme/imports/api/schemas';

export const GET = smeRoute<unknown, { id: string }>(async ({ request, db, params }) => {
  const org = orgIdFrom(request);
  const { status, offset, limit } = parseQuery(request, rowsQuery);
  let query = db.from('sme_import_rows')
    .select('id, row_number, raw, value_date, amount_minor::text, currency, description, external_ref, suggested_category_id, category_id, channel, status, issues, override_reason, posted_transaction_id', { count: 'exact' })
    .eq('org_id', org).eq('batch_id', uuidParam(params.id)).order('row_number').range(offset, offset + limit - 1);
  if (status) query = query.in('status', status);
  const { data, error, count } = await query;
  if (error) throw fromDbError(error);
  return { body: { items: data ?? [], total: count ?? 0 } };
});

export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, correlationId, params }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, reviewInput);
  const body = await callRpc(db, 'sme_review_import_rows', {
    p_org: org, p_batch: uuidParam(params.id), p_changes: input.changes ?? null, p_bulk: input.bulk ?? null,
    p_correlation_id: correlationId, p_idem: key,
  });
  return { body };
});
