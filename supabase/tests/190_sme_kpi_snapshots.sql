-- W3a-08: snapshots are read by ledger readers of their own organization and written by the worker only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act_as(p_user uuid) returns void language sql security definer as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;

select lives_ok($$ select sme_store_kpi_snapshot_worker('00000000-0000-4000-a000-00000000000a', '2026-11-01_2026-11-30', 'kpi-v1-proposed', repeat('a', 64), '{"metrics":[]}') $$,
  'the worker stores a snapshot');

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select is((select count(*)::int from sme_kpi_snapshots where org_id = '00000000-0000-4000-a000-00000000000a'), 1, 'the Org A owner reads it');
select throws_ok($$ select sme_store_kpi_snapshot_worker('00000000-0000-4000-a000-00000000000a', '2026-11-01_2026-11-30', 'kpi-v1-proposed', repeat('b', 64), '{}') $$,
  '42501', null, 'signed-in users cannot write snapshots');
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select is((select count(*)::int from sme_kpi_snapshots where org_id = '00000000-0000-4000-a000-00000000000a'), 0, 'Org B cannot read Org A snapshots');

select * from finish();
rollback;
