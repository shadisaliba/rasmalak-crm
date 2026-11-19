-- W3a-04: ageing totals equal the outstanding amounts; channel totals exclude own transfers.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act_as(p_user uuid) returns void language sql security definer as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
create temp table c as with x as (insert into crm_companies (org_id, name, created_by) values ('00000000-0000-4000-a000-00000000000a', 'Ageing customer', 'a0000000-0000-4000-a000-000000000001') returning id) select id from x;
-- Not due, 10, 45 and 120 days past due.
select sme_create_invoice('00000000-0000-4000-a000-00000000000a', jsonb_build_object(
  'customer_company_id', (select id from c), 'issue_date', (current_date - d - 5)::text, 'due_date', (current_date - d)::text, 'status', 'open',
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'quantity', '1', 'unit_price_minor', amt::text))), null, 'age-' || d)
from (values (-10, 1000), (10, 2000), (45, 3000), (120, 4000)) v(d, amt);

select results_eq($$ select current_minor, d1_30_minor, d31_60_minor, d61_90_minor, d90_plus_minor, total_minor from sme_receivables_ageing
                     where customer_company_id = (select id from c) and not is_total $$,
  $$ values (1000::bigint, 2000::bigint, 3000::bigint, 0::bigint, 4000::bigint, 10000::bigint) $$, 'outstanding falls into the right buckets');
select is((select total_minor from sme_receivables_ageing where is_total and org_id = '00000000-0000-4000-a000-00000000000a' and currency = 'JOD'),
  (select sum(outstanding_minor)::bigint from sme_invoice_balances where org_id = '00000000-0000-4000-a000-00000000000a' and currency = 'JOD'
     and derived_status in ('open', 'partially_paid', 'overdue')),
  'the receivables ageing total equals the outstanding balances');
select is(coalesce((select total_minor from sme_payables_ageing where is_total and org_id = '00000000-0000-4000-a000-00000000000a' and currency = 'JOD'), 0),
  coalesce((select sum(outstanding_minor)::bigint from sme_bill_balances where org_id = '00000000-0000-4000-a000-00000000000a' and currency = 'JOD'
     and derived_status in ('open', 'partially_paid', 'overdue')), 0),
  'and so does the payables ageing total');

-- ── Channels ────────────────────────────────────────────────
create temp table a as select (sme_create_account('00000000-0000-4000-a000-00000000000a', '{"kind":"bank","name":"Channel bank","currency":"JOD"}',
  '{"amount_minor":"100000","value_date":"2026-11-01","is_estimate":false}', null, 'ch-a1') ->> 'account_id')::uuid as bank,
  (sme_create_account('00000000-0000-4000-a000-00000000000a', '{"kind":"cash","name":"Channel cash","currency":"JOD"}', null, null, 'ch-a2') ->> 'account_id')::uuid as cash;
select sme_post_transaction('00000000-0000-4000-a000-00000000000a', jsonb_build_object('account_id', (select bank from a), 'value_date', '2026-11-03',
  'amount_minor', '5000', 'classification', jsonb_build_object('channel', 'cliq')), null, 'ch-1');
select sme_post_transaction('00000000-0000-4000-a000-00000000000a', jsonb_build_object('account_id', (select bank from a), 'value_date', '2026-11-04',
  'amount_minor', '-2000', 'classification', jsonb_build_object('channel', 'cliq')), null, 'ch-2');
create temp table before_transfer as select * from sme_cash_by_channel('00000000-0000-4000-a000-00000000000a', '2026-11-05', '2026-11-05');
select sme_post_transfer('00000000-0000-4000-a000-00000000000a', (select bank from a), (select cash from a), '{"amount_minor":"1000","value_date":"2026-11-05"}', null, 'ch-3');
select results_eq($$ select inflow_minor, outflow_minor, count from sme_cash_by_channel('00000000-0000-4000-a000-00000000000a', '2026-11-03', '2026-11-05')
                     where channel = 'cliq' and currency = 'JOD' $$,
  $$ values ('5000'::text, '2000'::text, 2) $$, 'CliQ shows money in and out separately');
select results_eq($$ select * from sme_cash_by_channel('00000000-0000-4000-a000-00000000000a', '2026-11-05', '2026-11-05') $$,
  $$ select * from before_transfer $$, 'own-account transfers are not counted as payments');
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select is((select count(*)::int from sme_receivables_ageing where org_id = '00000000-0000-4000-a000-00000000000a'), 0, 'Org B sees no Org A ageing');

select * from finish();
rollback;
