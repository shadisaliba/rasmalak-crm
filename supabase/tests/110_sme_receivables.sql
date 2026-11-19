-- W3a-02 (FIN-S02): invoices never change cash; receipts allocate partially; over-allocation and
-- reversing an allocated receipt are refused; issued invoices and allocations are immutable.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

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
create function tests.inv(p uuid) returns sme_invoice_balances language sql stable as $$ select * from sme_invoice_balances where invoice_id = p $$;
grant execute on function tests.inv(uuid) to authenticated;

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
insert into tests.ids select 'bank', (sme_create_account('00000000-0000-4000-a000-00000000000a',
  '{"kind":"bank","name":"Receivables bank","currency":"JOD"}', '{"amount_minor":"1000000","value_date":"2026-10-01","is_estimate":false}', null, 'rcv-acc') ->> 'account_id')::uuid;
with c as (insert into crm_companies (org_id, name, created_by) values ('00000000-0000-4000-a000-00000000000a', 'Al-Noor Trading', 'a0000000-0000-4000-a000-000000000001') returning id)
insert into tests.ids select 'customer', id from c;

-- ── An invoice for JOD 800.000 does not move cash ───────────
insert into tests.ids select 'inv', (sme_create_invoice('00000000-0000-4000-a000-00000000000a', jsonb_build_object(
  'number', 'INV-77', 'customer_company_id', tests.id('customer'), 'issue_date', '2026-11-01', 'due_date', '2026-12-01', 'status', 'open',
  'lines', jsonb_build_array(jsonb_build_object('description', 'Design work', 'quantity', '2', 'unit_price_minor', '400000', 'tax_rate_bp', 0)),
  'expected', jsonb_build_object('subtotal_minor', '800000', 'tax_minor', '0', 'total_minor', '800000')), null, 'rcv-inv-1') ->> 'invoice_id')::uuid;
select is((tests.inv(tests.id('inv'))).outstanding_minor, 800000::bigint, 'the invoice is outstanding in full');
select is(tests.balance(tests.id('bank')), 1000000::bigint, 'and account balances do not change');
select is((select party_roles from crm_companies where id = tests.id('customer')), array['customer'], 'invoicing makes the party a customer');
select throws_ok($$ select sme_create_invoice('00000000-0000-4000-a000-00000000000a', jsonb_build_object(
  'customer_company_id', tests.id('customer'), 'issue_date', '2026-11-01', 'due_date', '2026-12-01',
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'quantity', '1.5', 'unit_price_minor', '333', 'tax_rate_bp', 1600)),
  'expected', jsonb_build_object('subtotal_minor', '499', 'tax_minor', '80', 'total_minor', '579')), null, 'rcv-inv-bad') $$,
  'P0001', 'VALIDATION_FAILED', 'totals that differ from the database computation are refused');
select is((sme_create_invoice('00000000-0000-4000-a000-00000000000a', jsonb_build_object(
  'customer_company_id', tests.id('customer'), 'issue_date', '2026-11-01', 'due_date', '2026-12-01',
  'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'quantity', '1.5', 'unit_price_minor', '333', 'tax_rate_bp', 1600))), null, 'rcv-inv-2') ->> 'total_minor'),
  '580', 'line amounts round once, half away from zero (499.5 → 500, tax 80)');
select is((select number from sme_invoices where idempotency_key = 'rcv-inv-2'), 'INV-2026-0001', 'a missing number gets the next INV-YYYY sequence');

-- ── A JOD 300.000 receipt, allocated ────────────────────────
insert into tests.ids select 'receipt', (sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-10', 'amount_minor', '300000', 'description', 'Al-Noor partial payment'),
  null, 'rcv-tx-1') ->> 'transaction_id')::uuid;
insert into tests.ids select 'alloc', (sme_allocate_receipt('00000000-0000-4000-a000-00000000000a', tests.id('inv'), tests.id('receipt'), 300000, null, 'rcv-al-1') ->> 'allocation_id')::uuid;
select is((tests.inv(tests.id('inv'))).outstanding_minor, 500000::bigint, 'outstanding is JOD 500.000');
select is((tests.inv(tests.id('inv'))).derived_status, 'partially_paid', 'and the status is partially paid');
select is(tests.balance(tests.id('bank')), 1300000::bigint, 'bank cash rose by exactly JOD 300.000');

-- ── Over-allocation and currency ────────────────────────────
insert into tests.ids select 'big', (sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-11', 'amount_minor', '600000'), null, 'rcv-tx-2') ->> 'transaction_id')::uuid;
select throws_ok($$ select sme_allocate_receipt('00000000-0000-4000-a000-00000000000a', tests.id('inv'), tests.id('big'), 600000, null, 'rcv-al-2') $$,
  'P0001', 'OVER_ALLOCATION', 'allocating JOD 600.000 more is refused');
select throws_ok($$ select sme_allocate_receipt('00000000-0000-4000-a000-00000000000a', (select id from sme_invoices where idempotency_key = 'rcv-inv-2'), tests.id('receipt'), 1, null, 'rcv-al-3') $$,
  'P0001', 'VALIDATION_FAILED', 'a draft invoice takes no allocations');
select lives_ok($$ select sme_issue_invoice('00000000-0000-4000-a000-00000000000a', (select id from sme_invoices where idempotency_key = 'rcv-inv-2'), null, 'rcv-issue') $$,
  'a draft is issued');
select throws_ok($$ select sme_allocate_receipt('00000000-0000-4000-a000-00000000000a', (select id from sme_invoices where idempotency_key = 'rcv-inv-2'), tests.id('receipt'), 1, null, 'rcv-al-4') $$,
  'P0001', 'OVER_ALLOCATION', 'a receipt cannot be allocated beyond its own amount');
select throws_ok($$ select sme_allocate_receipt('00000000-0000-4000-a000-00000000000a', tests.id('inv'), tests.id('big'), 0, null, 'rcv-al-5') $$,
  'P0001', 'VALIDATION_FAILED', 'allocations are positive');

-- ── Reversal order ──────────────────────────────────────────
select throws_ok($$ select sme_reverse_transaction('00000000-0000-4000-a000-00000000000a', tests.id('receipt'), 'wrong customer', null, 'rcv-rev-1') $$,
  'P0001', 'ALLOCATED_REVERSE_FIRST', 'an allocated receipt cannot be reversed');
select throws_ok($$ select sme_void_invoice('00000000-0000-4000-a000-00000000000a', tests.id('inv'), 'mistake', null, 'rcv-void-1') $$,
  'P0001', 'ALLOCATED_REVERSE_FIRST', 'nor can an invoice with allocations be voided');
select lives_ok($$ select sme_reverse_allocation('00000000-0000-4000-a000-00000000000a', tests.id('alloc'), 'wrong invoice', null, 'rcv-ral-1') $$,
  'the allocation is reversed with a reason');
select is((tests.inv(tests.id('inv'))).outstanding_minor, 800000::bigint, 'restoring the outstanding amount');
select lives_ok($$ select sme_reverse_transaction('00000000-0000-4000-a000-00000000000a', tests.id('receipt'), 'wrong customer', null, 'rcv-rev-2') $$,
  'and then the receipt can be reversed');

-- ── Immutability and isolation ──────────────────────────────
reset role;
select throws_ok($$ update sme_invoices set total_minor = 1, subtotal_minor = 1 where id = tests.id('inv') $$, 'P0001', 'VALIDATION_FAILED',
  'an issued invoice cannot be edited');
select throws_ok($$ insert into sme_invoice_lines (org_id, invoice_id, position, description, quantity, unit_price_minor, line_subtotal_minor, line_tax_minor)
  values ('00000000-0000-4000-a000-00000000000a', tests.id('inv'), 9, 'extra', 1, 1, 1, 0) $$, 'P0001', 'VALIDATION_FAILED', 'nor its lines');
select throws_ok($$ delete from sme_invoice_allocations where id = tests.id('alloc') $$, 'P0001', 'LEDGER_IMMUTABLE', 'allocations are append-only');
set local role authenticated;
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select is((select count(*)::int from sme_invoice_balances where org_id = '00000000-0000-4000-a000-00000000000a'), 0, 'Org B sees no Org A invoices');
select throws_ok($$ select sme_allocate_receipt('00000000-0000-4000-a000-00000000000a', tests.id('inv'), tests.id('big'), 1, null, 'rcv-b') $$,
  'P0001', 'ACCESS_DENIED', 'nor allocates to them');

select * from finish();
rollback;
