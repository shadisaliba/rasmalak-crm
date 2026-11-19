import { orgIdFrom, smeRoute, uuidParam } from '@/sme/api/route';
import { SmeError, fromDbError } from '@/sme/api/errors';

export const GET = smeRoute<unknown, { id: string }>(async ({ request, db, params }) => {
  const org = orgIdFrom(request);
  const id = uuidParam(params.id);
  const [invoice, balance, lines, allocations] = await Promise.all([
    db.from('sme_invoices').select('id, number, customer_company_id, customer_contact_id, issue_date, due_date, currency, subtotal_minor::text, tax_minor::text, total_minor::text, status, notes, status_reason, status_changed_at, created_at, created_by')
      .eq('org_id', org).eq('id', id).maybeSingle(),
    db.from('sme_invoice_balances').select('allocated_minor::text, outstanding_minor::text, derived_status, days_overdue').eq('org_id', org).eq('invoice_id', id).maybeSingle(),
    db.from('sme_invoice_lines').select('position, description, quantity::text, unit_price_minor::text, tax_rate_bp, line_subtotal_minor::text, line_tax_minor::text').eq('org_id', org).eq('invoice_id', id).order('position'),
    db.from('sme_invoice_allocations').select('id, transaction_id, amount_minor::text, reversal_of, reason, created_at, created_by').eq('org_id', org).eq('invoice_id', id).order('created_at'),
  ]);
  for (const r of [invoice, balance, lines, allocations]) if (r.error) throw fromDbError(r.error);
  if (!invoice.data) throw new SmeError('NOT_FOUND', { entity: 'invoice' });
  const txIds = [...new Set((allocations.data ?? []).map(a => a.transaction_id))];
  const { data: txs, error } = txIds.length
    ? await db.from('sme_transactions').select('id, value_date, description, account_id').eq('org_id', org).in('id', txIds)
    : { data: [], error: null };
  if (error) throw fromDbError(error);
  return { body: { invoice: invoice.data, balance: balance.data, lines: lines.data ?? [], allocations: allocations.data ?? [], transactions: txs ?? [] } };
});
