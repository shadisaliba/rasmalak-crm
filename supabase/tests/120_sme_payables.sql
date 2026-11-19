-- W3a-03: bills mirror invoices for outflows; a bill paid in two parts shows the right
-- outstanding after each part; matching never initiates or double-counts a payment.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act_as(p_user uuid) returns void language sql security definer as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;
create table tests.ids (k text primary key, v uuid);
grant all on tests.ids to authenticated;
create function tests.id(p text) returns uuid language sql stable as $$ select v from tests.ids where k = p $$;
grant execute on function tests.id(text) to authenticated;
create function tests.balance(p uuid) returns bigint language sql stable as $$ select balance_minor from sme_account_balances where account_id = p $$;
grant execute on function tests.balance(uuid) to authenticated;
create function tests.bill(p uuid) returns sme_bill_balances language sql stable as $$ select * from sme_bill_balances where bill_id = p $$;
grant execute on function tests.bill(uuid) to authenticated;

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
insert into tests.ids select 'bank', (sme_create_account('00000000-0000-4000-a000-00000000000a',
  '{"kind":"bank","name":"Payables bank","currency":"JOD"}', '{"amount_minor":"2000000","value_date":"2026-10-01","is_estimate":false}', null, 'pay-acc') ->> 'account_id')::uuid;
with c as (insert into crm_companies (org_id, name, created_by) values ('00000000-0000-4000-a000-00000000000a', 'Al-Quds Packaging', 'a0000000-0000-4000-a000-000000000001') returning id)
insert into tests.ids select 'supplier', id from c;

insert into tests.ids select 'bill', (sme_create_bill('00000000-0000-4000-a000-00000000000a', jsonb_build_object(
  'supplier_company_id', tests.id('supplier'), 'supplier_reference', 'AQ-5521', 'issue_date', '2026-11-01', 'due_date', (current_date + 14)::text, 'status', 'open',
  'lines', jsonb_build_array(jsonb_build_object('description', 'Boxes', 'quantity', '100', 'unit_price_minor', '8000', 'tax_rate_bp', 0))), null, 'pay-bill-1') ->> 'bill_id')::uuid;
select is((tests.bill(tests.id('bill'))).outstanding_minor, 800000::bigint, 'a JOD 800.000 bill is owed in full');
select is(tests.balance(tests.id('bank')), 2000000::bigint, 'and cash does not change');
select is((select party_roles from crm_companies where id = tests.id('supplier')), array['supplier'], 'billing makes the party a supplier');
select throws_ok($$ select sme_create_bill('00000000-0000-4000-a000-00000000000a', jsonb_build_object(
  'supplier_company_id', tests.id('supplier'), 'supplier_reference', 'AQ-5521', 'issue_date', '2026-11-01', 'due_date', '2026-11-15',
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'quantity', '1', 'unit_price_minor', '1'))), null, 'pay-bill-dup') $$,
  'P0001', 'VALIDATION_FAILED', 'a supplier reference is unique per supplier');

-- ── Paid in two parts ───────────────────────────────────────
select is((sme_pay_bill('00000000-0000-4000-a000-00000000000a', tests.id('bill'), jsonb_build_object(
  'account_id', tests.id('bank'), 'value_date', '2026-11-05', 'amount_minor', '300000', 'description', 'First part', 'channel', 'cliq'), null, 'pay-1') ->> 'outstanding_minor'),
  '500000', 'after the first part JOD 500.000 is owed');
select is((tests.bill(tests.id('bill'))).derived_status, 'partially_paid', 'and the bill is partly paid');
select is(tests.balance(tests.id('bank')), 1700000::bigint, 'the payment left the bank once');
insert into tests.ids select 'out2', (sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-12', 'amount_minor', '-600000', 'description', 'Second part'), null, 'pay-tx-2') ->> 'transaction_id')::uuid;
select throws_ok($$ select sme_allocate_payment('00000000-0000-4000-a000-00000000000a', tests.id('bill'), tests.id('out2'), 600000, null, 'pay-al-over') $$,
  'P0001', 'OVER_ALLOCATION', 'matching more than is owed is refused');
select is((sme_allocate_payment('00000000-0000-4000-a000-00000000000a', tests.id('bill'), tests.id('out2'), 500000, null, 'pay-al-2') ->> 'outstanding_minor'),
  '0', 'after the second part nothing is owed');
select is((tests.bill(tests.id('bill'))).derived_status, 'paid', 'and the bill is paid');
select is(tests.balance(tests.id('bank')), 1100000::bigint, 'cash moved only by the two payments');

-- ── Rules shared with receivables ───────────────────────────
insert into tests.ids select 'inflow', (sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-12', 'amount_minor', '1000'), null, 'pay-tx-in') ->> 'transaction_id')::uuid;
insert into tests.ids select 'bill2', (sme_create_bill('00000000-0000-4000-a000-00000000000a', jsonb_build_object(
  'supplier_company_id', tests.id('supplier'), 'issue_date', '2026-11-01', 'due_date', '2026-12-01', 'status', 'open',
  'lines', jsonb_build_array(jsonb_build_object('description', 'Tape', 'quantity', '1', 'unit_price_minor', '5000'))), null, 'pay-bill-2') ->> 'bill_id')::uuid;
select throws_ok($$ select sme_allocate_payment('00000000-0000-4000-a000-00000000000a', tests.id('bill2'), tests.id('inflow'), 1000, null, 'pay-al-in') $$,
  'P0001', 'VALIDATION_FAILED', 'a bill is matched only to outflows');
select throws_ok($$ select sme_reverse_transaction('00000000-0000-4000-a000-00000000000a', tests.id('out2'), 'duplicate', null, 'pay-rev') $$,
  'P0001', 'ALLOCATED_REVERSE_FIRST', 'a matched payment cannot be reversed');
select throws_ok($$ select sme_void_bill('00000000-0000-4000-a000-00000000000a', tests.id('bill'), 'mistake', null, 'pay-void') $$,
  'P0001', 'ALLOCATED_REVERSE_FIRST', 'nor can a bill with matched payments be voided');
select ok((select jsonb_array_length(sme_payables_overview('00000000-0000-4000-a000-00000000000a') -> 'concentration') > 0),
  'the overview shows supplier concentration');
reset role;
select throws_ok($$ delete from sme_bill_allocations where bill_id = tests.id('bill') $$, 'P0001', 'LEDGER_IMMUTABLE', 'bill allocations are append-only');
set local role authenticated;
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select is((select count(*)::int from sme_bill_balances where org_id = '00000000-0000-4000-a000-00000000000a'), 0, 'Org B sees no Org A bills');

select * from finish();
rollback;
