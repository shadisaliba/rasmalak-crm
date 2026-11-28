-- Sample business activity: registers, planned payments and a buffer, seeded once, demo organizations only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.add_user(p_id uuid, p_email text) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '', now(), '{}', '{}', now(), now(), '', '', '', '');
$$;
create function tests.act_as(p_user uuid) returns void language sql security definer as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;
create table tests.demo (id uuid);
grant all on tests.demo to authenticated;
select tests.add_user('a8000000-0000-4000-a000-000000000001', 'demo.activity@example.test');

set local role authenticated;
select tests.act_as('a8000000-0000-4000-a000-000000000001');
insert into tests.demo select (sme_create_demo_org() ->> 'org_id')::uuid;
select is((select count(*)::int from sme_invoice_balances where org_id = (select id from tests.demo)), 6, 'a new sample business has six invoice records');
select is((select count(*)::int from sme_invoice_balances where org_id = (select id from tests.demo) and derived_status = 'paid'), 3,
  'three of them paid, so the forecast learns how late that customer pays');
select is((select count(*)::int from sme_bill_balances where org_id = (select id from tests.demo) and derived_status in ('open', 'overdue', 'partially_paid')), 2, 'and two open bills');
select is((select count(*)::int from sme_scheduled_items where org_id = (select id from tests.demo)), 2, 'rent and salaries are planned payments');
select is((select count(*)::int from crm_contacts where org_id = (select id from tests.demo) and (phone is not null or whatsapp_number is not null)), 0,
  'sample contacts have no phone number, so a public demo cannot message anyone');
select throws_ok($$ select sme_seed_demo_activity((select id from tests.demo)) $$, '42501', null, 'signed-in users cannot run the seeding directly');

reset role;
select is(sme_seed_demo_activity((select id from tests.demo)) ->> 'seeded', 'false', 'seeding twice adds nothing');
select throws_ok($$ select sme_seed_demo_activity('00000000-0000-4000-a000-00000000000a') $$, 'P0001', 'VALIDATION_FAILED', 'a live organization is never seeded');

select * from finish();
rollback;
