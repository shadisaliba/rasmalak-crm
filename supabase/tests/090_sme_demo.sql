-- W2-07: demo data lives in its own organization, never mixes with live data, and cannot be
-- switched to live.
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
-- The user with no organization explores the demo; Org A is the live organization.
create function tests.no_org() returns uuid language sql stable security definer as $$ select id from auth.users where email = 'no.org@example.test' $$;
grant execute on function tests.no_org() to authenticated;

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
insert into tests.ids select 'live_acct', (sme_create_account('00000000-0000-4000-a000-00000000000a',
  '{"kind":"bank","name":"Live bank","currency":"JOD"}', '{"amount_minor":"1000","value_date":"2026-11-01","is_estimate":false}', null, 'demo-live-acc') ->> 'account_id')::uuid;

select tests.act_as(tests.no_org());
insert into tests.ids select 'demo', (sme_create_demo_org() ->> 'org_id')::uuid;
select is((sme_create_demo_org() ->> 'org_id')::uuid, tests.id('demo'), 'a user has one demo organization');
select ok((select is_demo from organizations where id = tests.id('demo')), 'it is flagged as demo');
select is((select role from org_members where org_id = tests.id('demo') and user_id = tests.no_org()), 'owner', 'and owned by the user');
select ok(sme_enabled(tests.id('demo')), 'with the SME suite enabled for sample data');
select cmp_ok((select count(*)::int from sme_transactions where org_id = tests.id('demo')), '>', 50, 'it is seeded with synthetic activity');
select is((select count(*)::int from sme_transactions where org_id = tests.id('demo') and source_kind = 'import'
           and import_batch_id is not null and import_row_id is not null) > 0, true, 'including an imported statement with provenance');
select is((select count(*)::int from sme_transactions where org_id = tests.id('demo') and value_date > current_date), 0, 'with no future dates');

-- ── Isolation both ways ─────────────────────────────────────
select is((select count(*)::int from sme_transactions where org_id = '00000000-0000-4000-a000-00000000000a'), 0,
  'a demo-only member cannot read the live organization');
select throws_ok($$ select sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('live_acct'), 'value_date', '2026-11-02', 'amount_minor', '5'), null, 'demo-x1') $$,
  'P0001', 'ACCESS_DENIED', 'or write to it');
select throws_ok($$ select sme_post_transaction(tests.id('demo'),
  jsonb_build_object('account_id', tests.id('live_acct'), 'value_date', '2026-11-02', 'amount_minor', '5'), null, 'demo-x2') $$,
  'P0001', 'NOT_FOUND', 'a demo posting cannot reference a live account');
insert into tests.ids select 'demo_acct', id from sme_accounts where org_id = tests.id('demo') order by created_at limit 1;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select is((select count(*)::int from sme_transactions where org_id = tests.id('demo')), 0, 'a live member cannot read the demo organization');
select is((select count(*)::int from sme_accounts where org_id = tests.id('demo')), 0, 'nor its accounts');
select throws_ok($$ select sme_post_transaction('00000000-0000-4000-a000-00000000000a',
  jsonb_build_object('account_id', tests.id('demo_acct'), 'value_date', '2026-11-02', 'amount_minor', '5'), null, 'demo-x3') $$,
  'P0001', 'NOT_FOUND', 'a live posting cannot reference a demo account');

-- ── Never live, never forged ────────────────────────────────
select tests.act_as(tests.no_org());
select throws_ok($$ update organizations set is_demo = false where id = tests.id('demo') $$, 'P0001', 'VALIDATION_FAILED',
  'the owner cannot switch the demo to live');
select throws_ok($$ insert into organizations (name, country, is_demo, created_by) values ('Fake demo', 'JO', true, tests.no_org()) $$,
  'P0001', 'VALIDATION_FAILED', 'a demo organization cannot be created directly');
select throws_ok($$ select sme_seed_demo('00000000-0000-4000-a000-00000000000a') $$, '42501', null, 'seeding is internal');
reset role;
select throws_ok($$ update organizations set is_demo = true where id = '00000000-0000-4000-a000-00000000000a' $$, 'P0001', 'VALIDATION_FAILED',
  'nor can a live organization become a demo');

select * from finish();
rollback;
