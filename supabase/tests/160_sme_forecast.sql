-- W3a-07: forecast inputs, scenarios and runs are permissioned, idempotent and isolated; runs are immutable.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

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
create function tests.run(p_digest text, p_scenario uuid default null) returns jsonb language sql as $$
  select jsonb_build_object(
    'scenario_id', p_scenario, 'engine_version', '1.0.0', 'as_of', '2026-11-24', 'input_digest', p_digest,
    'assumptions', '[]'::jsonb, 'result', '{"weeks":[]}'::jsonb, 'data_quality', '{"grade":"B"}'::jsonb);
$$;
grant execute on function tests.run(text, uuid) to authenticated;

select tests.add_user('a4000000-0000-4000-a000-000000000001', 'adviser.forecast@org-a.example.test');
select tests.add_user('a4000000-0000-4000-a000-000000000002', 'manager.forecast@org-a.example.test');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-4000-a000-00000000000a', 'a4000000-0000-4000-a000-000000000001', 'adviser'),
  ('00000000-0000-4000-a000-00000000000a', 'a4000000-0000-4000-a000-000000000002', 'manager');
insert into crm_companies (id, org_id, name, created_by)
  values ('b4000000-0000-4000-b000-0000000000c1', '00000000-0000-4000-b000-00000000000b', 'Org B customer', 'b0000000-0000-4000-b000-000000000001');

set local role authenticated;

-- ── Scheduled items ─────────────────────────────────────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
create temp table item as select sme_save_scheduled_item('00000000-0000-4000-a000-00000000000a', null,
  '{"label":"Shop rent","direction":"out","amount_minor":"450000","start_date":"2026-12-01","recurrence":"monthly"}', null, 'item-1') as res;
select is((select res #>> '{item,recurrence}' from item), 'monthly', 'the owner enters a monthly rent payment');
select is(sme_save_scheduled_item('00000000-0000-4000-a000-00000000000a', null,
  '{"label":"Shop rent","direction":"out","amount_minor":"450000","start_date":"2026-12-01","recurrence":"monthly"}', null, 'item-1') #>> '{item,id}',
  (select res #>> '{item,id}' from item), 'a replay with the same key returns the same item');
select is(sme_save_scheduled_item('00000000-0000-4000-a000-00000000000a', (select (res #>> '{item,id}')::uuid from item),
  '{"label":"Shop rent","direction":"out","amount_minor":"475000","start_date":"2026-12-01","recurrence":"monthly"}', null, 'item-2') #>> '{item,amount_minor}',
  '475000', 'the owner can change it');
select throws_ok($$ select sme_save_scheduled_item('00000000-0000-4000-a000-00000000000a', null,
  '{"label":"Bad","direction":"sideways","amount_minor":"1","start_date":"2026-12-01"}', null, 'item-3') $$,
  'P0001', 'VALIDATION_FAILED', 'an item needs a direction in or out');
select throws_ok($$ select sme_save_scheduled_item('00000000-0000-4000-a000-00000000000a', null,
  '{"label":"Ends early","direction":"out","amount_minor":"1","start_date":"2026-12-01","end_date":"2026-11-01"}', null, 'item-4') $$,
  'P0001', 'VALIDATION_FAILED', 'an end date cannot come before the start date');
select throws_ok($$ select sme_save_scheduled_item('00000000-0000-4000-a000-00000000000a', null,
  '{"label":"Org B party","direction":"in","amount_minor":"1","start_date":"2026-12-01","counterparty_company_id":"b4000000-0000-4000-b000-0000000000c1"}', null, 'item-5') $$,
  'P0001', 'NOT_FOUND', 'a counterparty must belong to the organization');

select tests.act_as('a4000000-0000-4000-a000-000000000001');
select ok((select count(*) from sme_scheduled_items where org_id = '00000000-0000-4000-a000-00000000000a') >= 1,
  'an adviser reads the scheduled items');
select throws_ok($$ select sme_save_scheduled_item('00000000-0000-4000-a000-00000000000a', null,
  '{"label":"Adviser","direction":"out","amount_minor":"1","start_date":"2026-12-01"}', null, 'item-6') $$,
  'P0001', 'ACCESS_DENIED', 'but cannot change forecast inputs');

-- ── Scenarios and settings ──────────────────────────────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
create temp table scen as select sme_save_scenario('00000000-0000-4000-a000-00000000000a', null, 'Pay the supplier later',
  '[{"type":"shift_receipts_days","days":7}]', null, 'scen-1') as res;
select is((select res #>> '{scenario,name}' from scen), 'Pay the supplier later', 'the owner saves a scenario');
select throws_ok($$ select sme_save_scenario('00000000-0000-4000-a000-00000000000a', null, 'Not a list', '{"type":"x"}', null, 'scen-2') $$,
  'P0001', 'VALIDATION_FAILED', 'overrides must be a list');
select is(sme_set_forecast_settings('00000000-0000-4000-a000-00000000000a', '{"buffer_minor":"2000000","dismissed_series":["expense:rent:x"]}', null, 'set-1') #>> '{settings,buffer_minor}',
  '2000000', 'the owner sets a cash buffer');
select is(sme_set_forecast_settings('00000000-0000-4000-a000-00000000000a', '{"dismissed_series":[]}', null, 'set-2') #>> '{settings,buffer_minor}',
  '2000000', 'changing removed series keeps the buffer');

-- ── Runs ────────────────────────────────────────────────────
create temp table run1 as select sme_record_forecast_run('00000000-0000-4000-a000-00000000000a', tests.run(repeat('a', 64))) as res;
select is((select (res ->> 'created')::boolean from run1), true, 'a baseline run is stored');
select is(sme_record_forecast_run('00000000-0000-4000-a000-00000000000a', tests.run(repeat('a', 64))) ->> 'id',
  (select res ->> 'id' from run1), 'the same inputs are stored once');
select is((sme_record_forecast_run('00000000-0000-4000-a000-00000000000a', tests.run(repeat('a', 64), (select (res #>> '{scenario,id}')::uuid from scen))) ->> 'created')::boolean,
  true, 'a scenario run is stored apart from the baseline');

select tests.act_as('a4000000-0000-4000-a000-000000000002');
select throws_ok($$ select sme_record_forecast_run('00000000-0000-4000-a000-00000000000a', tests.run(repeat('b', 64))) $$,
  'P0001', 'ACCESS_DENIED', 'a manager without forecast rights cannot run one');
select is((select count(*)::int from sme_forecast_runs), 0, 'and reads no runs');
select throws_ok($$ select sme_record_forecast_run_worker('00000000-0000-4000-a000-00000000000a', tests.run(repeat('c', 64))) $$,
  '42501', null, 'the worker path is closed to signed-in users');

-- ── Isolation and immutability ──────────────────────────────
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select is((select count(*)::int from sme_scheduled_items where org_id = '00000000-0000-4000-a000-00000000000a')
        + (select count(*)::int from sme_scenarios where org_id = '00000000-0000-4000-a000-00000000000a')
        + (select count(*)::int from sme_forecast_runs where org_id = '00000000-0000-4000-a000-00000000000a'), 0,
  'Org B reads none of Org A''s forecast rows');

reset role;
-- The outbox is only readable by the database owner and the worker.
select ok(exists (select 1 from sme_outbox where event_type = 'ScheduledItemChanged' and payload ->> 'itemId' = (select res #>> '{item,id}' from item)),
  'saving emits ScheduledItemChanged');
select ok(exists (select 1 from sme_outbox where event_type = 'ForecastRecalculated' and payload ->> 'runId' = (select res ->> 'id' from run1)),
  'a new baseline run emits ForecastRecalculated');
select throws_ok($$ update sme_forecast_runs set as_of = '2026-01-01' where id = (select (res ->> 'id')::uuid from run1) $$,
  'P0001', 'LEDGER_IMMUTABLE', 'runs cannot be changed, even by the database owner');

select * from finish();
rollback;
