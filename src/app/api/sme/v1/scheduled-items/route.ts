import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { scheduledItemBody } from '@/sme/forecast/api/schemas';

export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const { data, error } = await db.from('sme_scheduled_items')
    .select('id, label, direction, amount_minor::text, currency, start_date, recurrence, end_date, category_id, counterparty_company_id, counterparty_contact_id, source, series_key, is_estimate, created_at')
    .eq('org_id', org).eq('status', 'active').order('start_date');
  if (error) throw fromDbError(error);
  return { body: { items: data ?? [] } };
});

export const POST = smeRoute(async ({ request, db, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const body = await parseBody(request, scheduledItemBody);
  const res = await callRpc(db, 'sme_save_scheduled_item', { p_org: org, p_id: null, p_item: body, p_correlation_id: correlationId, p_idem: key });
  return { status: 201, body: res };
});
