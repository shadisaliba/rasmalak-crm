import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, parseQuery, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { createInvoiceInput, listInvoicesQuery } from '@/sme/receivables/api/schemas';

export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const q = parseQuery(request, listInvoicesQuery);
  let query = db.from('sme_invoice_balances')
    .select('invoice_id, number, customer_company_id, customer_contact_id, issue_date, due_date, currency, total_minor::text, allocated_minor::text, outstanding_minor::text, status, derived_status, days_overdue')
    .eq('org_id', org).order('due_date', { ascending: true }).limit(500);
  if (q.status) query = query.eq('derived_status', q.status);
  if (q.customer_company_id) query = query.eq('customer_company_id', q.customer_company_id);
  if (q.customer_contact_id) query = query.eq('customer_contact_id', q.customer_contact_id);
  const { data, error } = await query;
  if (error) throw fromDbError(error);
  return { body: { items: data ?? [] } };
});

// Records of invoices issued elsewhere: creating one never changes cash.
export const POST = smeRoute(async ({ request, db, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, createInvoiceInput);
  const body = await callRpc(db, 'sme_create_invoice', { p_org: org, p_invoice: input, p_correlation_id: correlationId, p_idem: key });
  return { status: 201, body };
});
