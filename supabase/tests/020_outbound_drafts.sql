-- W0-10: outbound drafts change state only through crm_decide_outbound_draft, by a member who
-- may write contacts, once.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act_as(p_user uuid) returns void language sql security definer as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-a000-000000000009', 'authenticated', 'authenticated', 'viewer.a@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', '');
insert into org_members (org_id, user_id, role) values ('00000000-0000-4000-a000-00000000000a', 'a0000000-0000-4000-a000-000000000009', 'viewer');

insert into crm_outbound_drafts (id, org_id, channel, recipient, payload) values
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-4000-a000-00000000000a', 'slack', 'C1', '{"message":"hi"}'),
  ('d1000000-0000-4000-8000-000000000002', '00000000-0000-4000-a000-00000000000a', 'webhook', 'https://example.test', '{}');

set local role authenticated;

select tests.act_as('a0000000-0000-4000-a000-000000000001');
select results_eq(
  $$ with u as (update crm_outbound_drafts set status = 'approved' where id = 'd1000000-0000-4000-8000-000000000001' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'members cannot change a draft directly');
select results_eq($$ select status from crm_outbound_drafts where id = 'd1000000-0000-4000-8000-000000000001' $$,
  $$ values ('draft'::text) $$, 'the draft is unchanged');

select tests.act_as('a0000000-0000-4000-a000-000000000009');
select throws_ok($$ select crm_decide_outbound_draft('d1000000-0000-4000-8000-000000000001', 'approve') $$,
  'P0001', 'ACCESS_DENIED', 'a viewer cannot approve outbound messages');

select tests.act_as('b0000000-0000-4000-b000-000000000001');
select throws_ok($$ select crm_decide_outbound_draft('d1000000-0000-4000-8000-000000000001', 'approve') $$,
  'P0001', 'ACCESS_DENIED', 'another organization cannot approve the draft');

select tests.act_as('a0000000-0000-4000-a000-000000000001');
select is(crm_decide_outbound_draft('d1000000-0000-4000-8000-000000000001', 'approve'), 'approved', 'the owner approves');
select throws_ok($$ select crm_decide_outbound_draft('d1000000-0000-4000-8000-000000000001', 'discard') $$,
  'P0001', 'VALIDATION_FAILED', 'a decided draft cannot be decided again');
select is(crm_decide_outbound_draft('d1000000-0000-4000-8000-000000000002', 'discard'), 'discarded', 'the owner discards');

reset role;
select results_eq(
  $$ select action from crm_audit_log where entity_type = 'crm_outbound_draft' order by created_at $$,
  $$ values ('outbound_draft.approved'::text), ('outbound_draft.discarded'::text) $$,
  'each decision is audited'
);

select * from finish();
rollback;
