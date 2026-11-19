-- W2-04: the ledger is append-only for every role, tenant-isolated in tables and views, and
-- transfers never change total cash or create income or expense.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act_as(p_user uuid) returns void language sql security definer as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;

-- Org A: two JOD accounts with an opening balance and a sale.
insert into sme_accounts (id, org_id, kind, name, currency, created_by) values
  ('a1000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-00000000000a', 'bank', 'Main bank', 'JOD', 'a0000000-0000-4000-a000-000000000001'),
  ('a1000000-0000-4000-a000-0000000000a2', '00000000-0000-4000-a000-00000000000a', 'cash', 'Cash box', 'JOD', 'a0000000-0000-4000-a000-000000000001');
insert into sme_transactions (id, org_id, account_id, value_date, amount_minor, currency, base_amount_minor, source_kind, fingerprint, idempotency_key, created_by, is_estimate) values
  ('a1000000-0000-4000-a000-0000000000f1', '00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-0000000000a1', '2026-11-01', 5000000, 'JOD', 5000000, 'opening_balance', 'fp-1', 'k-1', 'a0000000-0000-4000-a000-000000000001', true),
  ('a1000000-0000-4000-a000-0000000000f2', '00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-0000000000a1', '2026-11-02', 300000, 'JOD', 300000, 'manual', 'fp-2', 'k-2', 'a0000000-0000-4000-a000-000000000001', false);
insert into sme_transaction_classifications (org_id, transaction_id, category_id, classified_by) values
  ('00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-0000000000f1', (select id from sme_categories where org_id is null and code = 'opening_balance'), 'a0000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-0000000000f2', (select id from sme_categories where org_id is null and code = 'sales'), 'a0000000-0000-4000-a000-000000000001');

-- ── Append-only for every role ──────────────────────────────
select throws_ok($$ update sme_transactions set amount_minor = 1 where id = 'a1000000-0000-4000-a000-0000000000f2' $$,
  'P0001', 'LEDGER_IMMUTABLE', 'the owner role cannot update a posted transaction');
select throws_ok($$ delete from sme_transactions where id = 'a1000000-0000-4000-a000-0000000000f2' $$,
  'P0001', 'LEDGER_IMMUTABLE', 'the owner role cannot delete a posted transaction');
set constraints sme_transactions_transfer_balanced immediate;
select throws_ok($$ truncate sme_transactions cascade $$, 'P0001', 'LEDGER_IMMUTABLE', 'the ledger cannot be truncated');
set constraints sme_transactions_transfer_balanced deferred;
select throws_ok($$ update sme_transaction_classifications set note = 'x' $$, 'P0001', 'LEDGER_IMMUTABLE', 'classifications are append-only too');

set local role service_role;
select throws_ok($$ update sme_transactions set description = 'x' where id = 'a1000000-0000-4000-a000-0000000000f2' $$,
  'P0001', 'LEDGER_IMMUTABLE', 'the service role cannot update a posted transaction');
select throws_ok($$ delete from sme_transactions where id = 'a1000000-0000-4000-a000-0000000000f2' $$,
  'P0001', 'LEDGER_IMMUTABLE', 'the service role cannot delete a posted transaction');
reset role;

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select results_eq($$ with u as (update sme_transactions set amount_minor = 1 returning 1) select count(*)::int from u $$, $$ values (0) $$,
  'members cannot update ledger rows');
select results_eq($$ with d as (delete from sme_transactions returning 1) select count(*)::int from d $$, $$ values (0) $$,
  'members cannot delete ledger rows');
select throws_ok($$ insert into sme_transactions (org_id, account_id, value_date, amount_minor, currency, base_amount_minor, source_kind, fingerprint, idempotency_key, created_by)
  values ('00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-0000000000a1', current_date, 1, 'JOD', 1, 'manual', 'x', 'k-x', 'a0000000-0000-4000-a000-000000000001') $$,
  '42501', null, 'members cannot insert ledger rows directly');

-- ── Views are tenant-isolated ───────────────────────────────
select is((select balance_minor from sme_account_balances where account_id = 'a1000000-0000-4000-a000-0000000000a1'), 5300000::bigint, 'balances sum posted rows');
select ok((select has_estimated_opening from sme_account_balances where account_id = 'a1000000-0000-4000-a000-0000000000a1'), 'an estimated opening balance is flagged');
select is((select count(*)::int from sme_transactions_current where org_id = '00000000-0000-4000-b000-00000000000b'), 0, 'Org B transactions are invisible through the current view');
select is((select count(*)::int from sme_account_balances where org_id = '00000000-0000-4000-b000-00000000000b'), 0, 'Org B balances are invisible');
select is((select count(*)::int from sme_categories where org_id = '00000000-0000-4000-b000-00000000000b'), 0, 'Org B custom categories are invisible');
reset role;

-- ── Transfers ───────────────────────────────────────────────
create temp table cash_before as select sum(amount_minor) as total from sme_transactions where org_id = '00000000-0000-4000-a000-00000000000a';
insert into sme_transactions (id, org_id, account_id, value_date, amount_minor, currency, base_amount_minor, source_kind, transfer_group_id, fingerprint, idempotency_key, created_by) values
  ('a1000000-0000-4000-a000-0000000000f3', '00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-0000000000a1', '2026-11-03', -200000, 'JOD', -200000, 'transfer', 'a1000000-0000-4000-a000-00000000099a', 'fp-3', 'k-3a', 'a0000000-0000-4000-a000-000000000001'),
  ('a1000000-0000-4000-a000-0000000000f4', '00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-0000000000a2', '2026-11-03', 200000, 'JOD', 200000, 'transfer', 'a1000000-0000-4000-a000-00000000099a', 'fp-4', 'k-3b', 'a0000000-0000-4000-a000-000000000001');
insert into sme_transaction_classifications (org_id, transaction_id, category_id, classified_by)
select '00000000-0000-4000-a000-00000000000a', id, (select id from sme_categories where org_id is null and code = 'transfer'), 'a0000000-0000-4000-a000-000000000001'
from sme_transactions where transfer_group_id = 'a1000000-0000-4000-a000-00000000099a';
select lives_ok($$ set constraints sme_transactions_transfer_balanced immediate $$, 'a balanced transfer is accepted');
select is((select sum(amount_minor) from sme_transactions where org_id = '00000000-0000-4000-a000-00000000000a'), (select total from cash_before),
  'a transfer between own accounts leaves total cash unchanged');
select is((select coalesce(sum(t.amount_minor), 0)::bigint from sme_transactions_current t join sme_categories c on c.id = t.category_id
           where t.transfer_group_id = 'a1000000-0000-4000-a000-00000000099a' and c.kind in ('income', 'expense')), 0::bigint,
  'and creates no income or expense');

set constraints sme_transactions_transfer_balanced deferred;
insert into sme_transactions (org_id, account_id, value_date, amount_minor, currency, base_amount_minor, source_kind, transfer_group_id, fingerprint, idempotency_key, created_by) values
  ('00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-0000000000a1', '2026-11-04', -100, 'JOD', -100, 'transfer', 'a1000000-0000-4000-a000-00000000099b', 'fp-5', 'k-5a', 'a0000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-0000000000a2', '2026-11-04', 99, 'JOD', 99, 'transfer', 'a1000000-0000-4000-a000-00000000099b', 'fp-6', 'k-5b', 'a0000000-0000-4000-a000-000000000001');
select throws_ok($$ set constraints sme_transactions_transfer_balanced immediate $$, 'P0001', 'VALIDATION_FAILED', 'an unbalanced transfer is rejected');

select * from finish();
rollback;
