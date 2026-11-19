-- W2-05: ledger RPCs are idempotent, audited, cash-consistent and tenant-isolated.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

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

insert into fx_rates (date, from_currency, to_currency, rate, source)
values ('2026-11-02', 'USD', 'JOD', 0.709, 'aggregator:open.er-api.com');

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');

-- ── Accounts and opening balances ───────────────────────────
insert into tests.ids select 'bank', (sme_create_account('00000000-0000-4000-a000-00000000000a',
  '{"kind":"bank","name":"Main bank","currency":"JOD"}', '{"amount_minor":"5000000","value_date":"2026-11-01"}', null, 'acc-1') ->> 'account_id')::uuid;
insert into tests.ids select 'cash', (sme_create_account('00000000-0000-4000-a000-00000000000a',
  '{"kind":"cash","name":"Cash box","currency":"JOD"}', null, null, 'acc-2') ->> 'account_id')::uuid;
insert into tests.ids select 'usd', (sme_create_account('00000000-0000-4000-a000-00000000000a',
  '{"kind":"bank","name":"USD account","currency":"USD"}', null, null, 'acc-3') ->> 'account_id')::uuid;

select is((select balance_minor from sme_account_balances where account_id = tests.id('bank')), 5000000::bigint, 'the opening balance counts toward cash');
select ok((select has_estimated_opening from sme_account_balances where account_id = tests.id('bank')), 'an opening balance is an estimate unless the user says otherwise');
select is((select c.kind from sme_transactions_current t join sme_categories c on c.id = t.category_id where t.account_id = tests.id('bank')), 'opening_balance',
  'and is classified as an opening balance, never income');
select throws_ok($$ select sme_create_account('00000000-0000-4000-a000-00000000000a', '{"kind":"bank","name":"Main bank","currency":"JOD"}', null, null, 'acc-dup') $$,
  'P0001', 'VALIDATION_FAILED', 'account names are unique per organization');

-- ── Idempotent posting ──────────────────────────────────────
insert into tests.ids select 'sale', (sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-02', 'amount_minor', '250000', 'description', 'Invoice 17 paid',
                     'classification', jsonb_build_object('category_id', sme_system_category('sales'), 'channel', 'cliq')), null, 'post-1') ->> 'transaction_id')::uuid;
select is((sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-02', 'amount_minor', '250000', 'description', 'Invoice 17 paid',
                     'classification', jsonb_build_object('category_id', sme_system_category('sales'), 'channel', 'cliq')), null, 'post-1') ->> 'transaction_id')::uuid,
  tests.id('sale'), 'replaying a request with the same key returns the same transaction');
select is((select count(*)::int from sme_transactions where org_id = '00000000-0000-4000-a000-00000000000a' and idempotency_key = 'post-1'), 1,
  'and creates one row');
select throws_ok($$ select sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-02', 'amount_minor', '1'), null, 'post-1') $$,
  'P0001', 'IDEMPOTENCY_CONFLICT', 'the same key with a different body is a conflict');
select ok((sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-02', 'amount_minor', '250000', 'description', 'INVOICE 17  paid'), null, 'post-2') ->> 'possible_duplicate')::boolean,
  'a matching fingerprint is reported as a possible duplicate');
select throws_ok($$ select sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-02', 'amount_minor', '0'), null, 'post-zero') $$,
  'P0001', 'VALIDATION_FAILED', 'zero amounts are rejected');
select throws_ok($$ select sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-02-30', 'amount_minor', '5'), null, 'post-date') $$,
  'P0001', 'VALIDATION_FAILED', 'impossible dates are rejected');
select throws_ok($$ select sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-02', 'amount_minor', '5', 'currency', 'USD'), null, 'post-cur') $$,
  'P0001', 'CURRENCY_MISMATCH', 'the currency must be the account currency');

-- ── Foreign currency ────────────────────────────────────────
select throws_ok($$ select sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('usd'), 'value_date', '2026-11-02', 'amount_minor', '1000'), null, 'fx-1') $$,
  'P0001', 'FX_RATE_REQUIRED', 'a foreign-currency entry needs a rate');
select throws_ok($$ select sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('usd'), 'value_date', '2026-11-02', 'amount_minor', '1000',
                     'fx', '{"rate":"0.8","rate_date":"2026-11-02","source":"aggregator:open.er-api.com"}'::jsonb), null, 'fx-2') $$,
  'P0001', 'VALIDATION_FAILED', 'a sourced rate must match the stored rate');
select throws_ok($$ select sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('usd'), 'value_date', '2026-11-02', 'amount_minor', '1000',
                     'fx', '{"rate":"0.8","rate_date":"2026-11-02","source":"manual"}'::jsonb), null, 'fx-3') $$,
  'P0001', 'VALIDATION_FAILED', 'a manual rate needs a reason');
select is((sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('usd'), 'value_date', '2026-11-02', 'amount_minor', '1000',
                     'fx', '{"rate":"0.709","rate_date":"2026-11-02","source":"aggregator:open.er-api.com"}'::jsonb), null, 'fx-4') ->> 'base_amount_minor'),
  '7090', '10.00 USD at the stored rate is 7.090 JOD');
select is((sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('usd'), 'value_date', '2026-11-03', 'amount_minor', '1',
                     'fx', '{"rate":"0.05","rate_date":"2026-11-03","source":"manual","reason":"bank advice"}'::jsonb), null, 'fx-5') ->> 'base_amount_minor'),
  '1', 'a half minor unit rounds away from zero');
select is((sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('usd'), 'value_date', '2026-11-03', 'amount_minor', '-1',
                     'fx', '{"rate":"0.05","rate_date":"2026-11-03","source":"manual","reason":"bank advice"}'::jsonb), null, 'fx-6') ->> 'base_amount_minor'),
  '-1', 'symmetrically for outflows');

-- ── Reversal ────────────────────────────────────────────────
create temp table balance_before as select balance_minor from sme_account_balances where account_id = tests.id('bank');
select throws_ok($$ select sme_reverse_transaction('00000000-0000-4000-a000-00000000000a', tests.id('sale'), '  ', null, 'rev-0') $$,
  'P0001', 'VALIDATION_FAILED', 'a reversal needs a reason');
insert into tests.ids select 'sale_rev', ((sme_reverse_transaction('00000000-0000-4000-a000-00000000000a', tests.id('sale'), 'Entered twice', null, 'rev-1') -> 'reversal_ids') ->> 0)::uuid;
select is((select balance_minor from sme_account_balances where account_id = tests.id('bank')), (select balance_minor - 250000 from balance_before),
  'the balance reads as if the transaction never happened');
select results_eq($$ select is_reversed, is_reversal from sme_transactions_current where id in (tests.id('sale'), tests.id('sale_rev')) order by is_reversal $$,
  $$ values (true, false), (false, true) $$, 'both rows remain visible and marked');
select throws_ok($$ select sme_reverse_transaction('00000000-0000-4000-a000-00000000000a', tests.id('sale'), 'again', null, 'rev-2') $$,
  'P0001', 'ALREADY_REVERSED', 'a transaction is reversed once');
select throws_ok($$ select sme_reverse_transaction('00000000-0000-4000-a000-00000000000a', tests.id('sale_rev'), 'undo', null, 'rev-3') $$,
  'P0001', 'VALIDATION_FAILED', 'a reversal is not itself reversed');

-- ── Classification ──────────────────────────────────────────
select lives_ok($$ select sme_classify_transaction('00000000-0000-4000-a000-00000000000a', tests.id('sale'),
  jsonb_build_object('category_id', sme_system_category('service_income'), 'channel', 'bank_transfer'), null, 'cls-1') $$, 'a posted transaction can be reclassified');
select is((select count(distinct category_id)::int from sme_transactions_current where id in (tests.id('sale'), tests.id('sale_rev'))), 1,
  'its reversal follows the new category');
select is((select sum(t.amount_minor)::bigint from sme_transactions_current t where t.category_id = sme_system_category('service_income')), 0::bigint,
  'so the category nets to zero');
select is((select count(*)::int from sme_transaction_classifications where transaction_id = tests.id('sale')), 2, 'classification history is kept');

-- ── Transfers ───────────────────────────────────────────────
create temp table cash_before as select sum(base_amount_minor) as total from sme_transactions where org_id = '00000000-0000-4000-a000-00000000000a';
insert into tests.ids select 'tr', (sme_post_transfer('00000000-0000-4000-a000-00000000000a', tests.id('bank'), tests.id('cash'),
  '{"amount_minor":"100000","value_date":"2026-11-04"}', null, 'tr-1') ->> 'transfer_group_id')::uuid;
select lives_ok($$ select sme_post_transfer('00000000-0000-4000-a000-00000000000a', tests.id('bank'), tests.id('usd'),
  '{"amount_minor":"709000","to_amount_minor":"100000","value_date":"2026-11-04"}', null, 'tr-2') $$, 'a cross-currency transfer is accepted');
select lives_ok($$ set constraints sme_transactions_transfer_balanced immediate $$, 'every transfer group is balanced');
select is((select sum(base_amount_minor) from sme_transactions where org_id = '00000000-0000-4000-a000-00000000000a'), (select total from cash_before),
  'transfers leave total cash in JOD unchanged');
select is((select count(*)::int from sme_transactions_current t join sme_categories c on c.id = t.category_id
           where t.transfer_group_id is not null and c.kind <> 'transfer'), 0, 'and are never income or expense');
select throws_ok($$ select sme_classify_transaction('00000000-0000-4000-a000-00000000000a',
  (select id from sme_transactions where transfer_group_id = tests.id('tr') limit 1),
  jsonb_build_object('category_id', sme_system_category('sales')), null, 'cls-2') $$,
  'P0001', 'VALIDATION_FAILED', 'a transfer cannot be reclassified as income');
select lives_ok($$ select sme_reverse_transaction('00000000-0000-4000-a000-00000000000a',
  (select id from sme_transactions where transfer_group_id = tests.id('tr') limit 1), 'wrong account', null, 'rev-tr') $$, 'reversing a transfer leg reverses the pair');
select is((select balance_minor from sme_account_balances where account_id = tests.id('cash')), 0::bigint, 'so both accounts return to their prior balance');

-- ── Audit, isolation and listing ────────────────────────────
reset role;
select ok((select payload -> 'base' ->> 'rounding' from sme_audit_events where action = 'ledger.transaction.posted' and payload -> 'base' ->> 'currency' = 'USD' limit 1) = 'half_away_from_zero',
  'postings record their base-amount computation');
set local role authenticated;
select is((select count(*)::int from sme_transactions_page('00000000-0000-4000-a000-00000000000a', jsonb_build_object('account_id', tests.id('bank')), 1)), 2,
  'listing returns one extra row to signal another page');
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select is((select count(*)::int from sme_transactions_page('00000000-0000-4000-a000-00000000000a', '{}', 200)), 0, 'Org B sees none of Org A''s transactions');
select throws_ok($$ select sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('bank'), 'value_date', '2026-11-02', 'amount_minor', '5'), null, 'b-1') $$,
  'P0001', 'ACCESS_DENIED', 'and cannot post to it');

select * from finish();
rollback;
