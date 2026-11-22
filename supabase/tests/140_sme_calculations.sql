-- W3a-05: calculation records are permissioned, immutable, idempotent and isolated per organization.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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
create function tests.record(p_saved boolean, p_name text default null) returns jsonb language sql as $$
  select jsonb_build_object(
    'calculator_code', 'service_hourly_rate', 'calculator_version', '1.0.0', 'as_of', '2026-11-22',
    'input', '{"currency":"JOD","target_annual_pay":"24000000"}'::jsonb,
    'output', '{"figures":[{"key":"hourly_rate","value":{"kind":"money","minor":"27174","currency":"JOD"}}],"tables":[]}'::jsonb,
    'trace', '[]'::jsonb, 'assumptions', '[]'::jsonb, 'is_saved', p_saved, 'name', p_name);
$$;
grant execute on function tests.record(boolean, text) to authenticated;

select tests.add_user('a3000000-0000-4000-a000-000000000001', 'adviser.calc@org-a.example.test');
select tests.add_user('a3000000-0000-4000-a000-000000000002', 'manager.calc@org-a.example.test');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-4000-a000-00000000000a', 'a3000000-0000-4000-a000-000000000001', 'adviser'),
  ('00000000-0000-4000-a000-00000000000a', 'a3000000-0000-4000-a000-000000000002', 'manager');

set local role authenticated;

-- ── Context ─────────────────────────────────────────────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select is(sme_calc_context('00000000-0000-4000-a000-00000000000a') -> 'params', '[]'::jsonb,
  'no published rule versions yet, so no regulated parameter is offered');
select tests.act_as('a3000000-0000-4000-a000-000000000002');
select throws_ok($$ select sme_calc_context('00000000-0000-4000-a000-00000000000a') $$, 'P0001', 'ACCESS_DENIED',
  'a manager without calculator rights gets no context');

-- ── Recording ───────────────────────────────────────────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
create temp table r1 as select sme_record_calculation('00000000-0000-4000-a000-00000000000a', tests.record(true, 'Consulting 2027'), null, 'calc-1') as res;
select is((select (res ->> 'is_saved')::boolean from r1), true, 'the owner saves a named scenario');
select is(sme_record_calculation('00000000-0000-4000-a000-00000000000a', tests.record(true, 'Consulting 2027'), null, 'calc-1') ->> 'id',
  (select res ->> 'id' from r1), 'a replay with the same key returns the same record');
select ok(exists (select 1 from sme_audit_events where action = 'calc.saved' and subject_id = (select (res ->> 'id')::uuid from r1)),
  'saving is audited');
select throws_ok($$ select sme_record_calculation('00000000-0000-4000-a000-00000000000a', tests.record(true), null, 'calc-2') $$,
  'P0001', 'VALIDATION_FAILED', 'a saved scenario needs a name');
select throws_ok($$ select sme_record_calculation('00000000-0000-4000-a000-00000000000a', tests.record(false) - 'input', null, 'calc-3') $$,
  'P0001', 'VALIDATION_FAILED', 'a record needs its input snapshot');

select tests.act_as('a3000000-0000-4000-a000-000000000001');
select lives_ok($$ select sme_record_calculation('00000000-0000-4000-a000-00000000000a', tests.record(false), null, 'calc-4') $$,
  'an adviser can run calculators');
select throws_ok($$ select sme_record_calculation('00000000-0000-4000-a000-00000000000a', tests.record(true, 'Adviser copy'), null, 'calc-5') $$,
  'P0001', 'ACCESS_DENIED', 'but cannot save scenarios');
select ok((select count(*) from sme_calculation_records where org_id = '00000000-0000-4000-a000-00000000000a') >= 2,
  'members with calculator rights read the organization''s records');

select tests.act_as('a3000000-0000-4000-a000-000000000002');
select is((select count(*)::int from sme_calculation_records), 0, 'a manager without calculator rights reads none');

-- ── Isolation and immutability ──────────────────────────────
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select is((select count(*)::int from sme_calculation_records where org_id = '00000000-0000-4000-a000-00000000000a'), 0,
  'Org B cannot read Org A records');
select throws_ok($$ select sme_record_calculation('00000000-0000-4000-a000-00000000000a', tests.record(false), null, 'calc-6') $$,
  'P0001', 'ACCESS_DENIED', 'and cannot record into Org A');

reset role;
select throws_ok($$ update sme_calculation_records set name = 'changed' where id = (select (res ->> 'id')::uuid from r1) $$,
  'P0001', 'LEDGER_IMMUTABLE', 'records cannot be changed, even by the database owner');

select * from finish();
rollback;
