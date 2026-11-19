-- ============================================================
-- SME AGEING AND PAYMENT CHANNELS (W3a-04)
-- ============================================================
-- Ageing buckets by days past due (current = not yet due), per party and in total, over the same
-- outstanding amounts as sme_invoice_balances / sme_bill_balances, so the totals always agree.

create view sme_receivables_ageing with (security_invoker = true) as
select
  org_id, currency, customer_company_id, customer_contact_id,
  grouping(customer_company_id, customer_contact_id) = 3 as is_total,
  coalesce(sum(outstanding_minor) filter (where days <= 0), 0)::bigint as current_minor,
  coalesce(sum(outstanding_minor) filter (where days between 1 and 30), 0)::bigint as d1_30_minor,
  coalesce(sum(outstanding_minor) filter (where days between 31 and 60), 0)::bigint as d31_60_minor,
  coalesce(sum(outstanding_minor) filter (where days between 61 and 90), 0)::bigint as d61_90_minor,
  coalesce(sum(outstanding_minor) filter (where days > 90), 0)::bigint as d90_plus_minor,
  sum(outstanding_minor)::bigint as total_minor
from (
  select org_id, currency, customer_company_id, customer_contact_id, outstanding_minor, current_date - due_date as days
  from sme_invoice_balances where derived_status in ('open', 'partially_paid', 'overdue')
) x
group by grouping sets ((org_id, currency, customer_company_id, customer_contact_id), (org_id, currency));

create view sme_payables_ageing with (security_invoker = true) as
select
  org_id, currency, supplier_company_id, supplier_contact_id,
  grouping(supplier_company_id, supplier_contact_id) = 3 as is_total,
  coalesce(sum(outstanding_minor) filter (where days <= 0), 0)::bigint as current_minor,
  coalesce(sum(outstanding_minor) filter (where days between 1 and 30), 0)::bigint as d1_30_minor,
  coalesce(sum(outstanding_minor) filter (where days between 31 and 60), 0)::bigint as d31_60_minor,
  coalesce(sum(outstanding_minor) filter (where days between 61 and 90), 0)::bigint as d61_90_minor,
  coalesce(sum(outstanding_minor) filter (where days > 90), 0)::bigint as d90_plus_minor,
  sum(outstanding_minor)::bigint as total_minor
from (
  select org_id, currency, supplier_company_id, supplier_contact_id, outstanding_minor, current_date - due_date as days
  from sme_bill_balances where derived_status in ('open', 'partially_paid', 'overdue')
) x
group by grouping sets ((org_id, currency, supplier_company_id, supplier_contact_id), (org_id, currency));

-- Money in and out by payment channel for a period, from current classifications. Own-account
-- transfers and opening balances are not payments to or from anyone and are left out; reversed
-- pairs cancel and are left out too. Channels are labels only: no integration is implied.
create or replace function sme_cash_by_channel(p_org uuid, p_from date, p_to date)
returns table (channel text, currency text, inflow_minor text, outflow_minor text, count int)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(t.channel, 'unknown'), t.currency,
         coalesce(sum(t.amount_minor) filter (where t.amount_minor > 0), 0)::text,
         coalesce(-sum(t.amount_minor) filter (where t.amount_minor < 0), 0)::text,
         count(*)::int
  from sme_transactions_current t
  where t.org_id = p_org and t.value_date between p_from and p_to
    and t.source_kind not in ('transfer', 'opening_balance') and not t.is_reversal and not t.is_reversed
  group by 1, 2
  order by 2, 3 desc;
$$;

revoke all on function sme_cash_by_channel(uuid, date, date) from public, anon;
grant execute on function sme_cash_by_channel(uuid, date, date) to authenticated;
