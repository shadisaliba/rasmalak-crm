-- W3a-11: product events accept only blueprint names and code-like props, skip demo organizations,
-- and are readable by platform staff only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act_as(p_user uuid) returns void language sql security definer as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;
create table tests.demo (id uuid);
grant all on tests.demo to authenticated;

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
insert into tests.demo select (sme_create_demo_org() ->> 'org_id')::uuid;
select is(sme_track('00000000-0000-4000-a000-00000000000a', 'DashboardViewed', '{"shortfall":true,"source":"home"}'), true, 'a member records a blueprint event');
select throws_ok($$ select sme_track('00000000-0000-4000-a000-00000000000a', 'SomethingElse', '{}') $$, 'P0001', 'VALIDATION_FAILED', 'unknown event names are refused');
select throws_ok($$ select sme_track('00000000-0000-4000-a000-00000000000a', 'DashboardViewed', '{"cash":15202}') $$, 'P0001', 'VALIDATION_FAILED', 'numbers such as amounts are refused');
select throws_ok($$ select sme_track('00000000-0000-4000-a000-00000000000a', 'DashboardViewed', '{"note":"Al-Noor Trading owes us"}') $$, 'P0001', 'VALIDATION_FAILED', 'free text and names are refused');
select is(sme_track((select id from tests.demo), 'DashboardViewed', '{}'), false, 'demo organizations are not recorded');
select is((select count(*)::int from sme_product_events), 0, 'an owner cannot read the usage log');
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select throws_ok($$ select sme_track('00000000-0000-4000-a000-00000000000a', 'DashboardViewed', '{}') $$, 'P0001', 'ACCESS_DENIED', 'Org B cannot record events for Org A');
reset role;
select is((select count(*)::int from sme_product_events where org_id = (select id from tests.demo)), 0, 'nothing was stored for the demo organization');

select * from finish();
rollback;
