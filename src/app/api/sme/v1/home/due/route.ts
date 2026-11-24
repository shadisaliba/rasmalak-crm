import { orgIdFrom, parseQuery, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { todayInAmman } from '@/sme/ledger/domain/dates';
import { isoAddDays } from '@/sme/forecast/engine-core/dates';
import { dueQuery } from '@/sme/home/api/schemas';

const OPEN = ['open', 'partially_paid', 'overdue'];
type Row = { due_date: string; currency: string; outstanding_minor: string };

function summarize(rows: Row[], today: string) {
  const jod = rows.filter(r => r.currency === 'JOD');
  return {
    due_minor: jod.reduce((s, r) => s + BigInt(r.outstanding_minor), 0n).toString(),
    overdue_minor: jod.filter(r => r.due_date < today).reduce((s, r) => s + BigInt(r.outstanding_minor), 0n).toString(),
    count: jod.length,
    // Other currencies are counted, not converted: the home shows JOD figures only.
    other_currency: rows.length - jod.length,
  };
}

// FIN-01: money expected in and out over the next days, overdue items included. Reads through RLS.
export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const { days } = parseQuery(request, dueQuery);
  const today = todayInAmman();
  const until = isoAddDays(today, days);
  const [invoices, bills] = await Promise.all([
    db.from('sme_invoice_balances').select('due_date, currency, outstanding_minor::text').eq('org_id', org).in('derived_status', OPEN).lte('due_date', until),
    db.from('sme_bill_balances').select('due_date, currency, outstanding_minor::text').eq('org_id', org).in('derived_status', OPEN).lte('due_date', until),
  ]);
  if (invoices.error) throw fromDbError(invoices.error);
  if (bills.error) throw fromDbError(bills.error);
  return { body: { today, until, days, collections: summarize((invoices.data ?? []) as Row[], today), payments: summarize((bills.data ?? []) as Row[], today) } };
});
