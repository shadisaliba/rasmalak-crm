import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, parseQuery, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { createBillInput, listBillsQuery } from '@/sme/payables/api/schemas';

export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const q = parseQuery(request, listBillsQuery);
  let query = db.from('sme_bill_balances')
    .select('bill_id, supplier_reference, supplier_company_id, supplier_contact_id, issue_date, due_date, currency, total_minor::text, allocated_minor::text, outstanding_minor::text, status, derived_status, days_overdue')
    .eq('org_id', org).order('due_date', { ascending: true }).limit(500);
  if (q.status) query = query.eq('derived_status', q.status);
  const { data, error } = await query;
  if (error) throw fromDbError(error);
  return { body: { items: data ?? [] } };
});

// Supplier bills: recording one never changes cash, and nothing here initiates a payment.
export const POST = smeRoute(async ({ request, db, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, createBillInput);
  const body = await callRpc(db, 'sme_create_bill', { p_org: org, p_bill: input, p_correlation_id: correlationId, p_idem: key });
  return { status: 201, body };
});
