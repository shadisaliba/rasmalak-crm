-- W0-04: nobody joins an organization except through an invitation, and nobody grants a
-- role above their own. Relies on supabase/seed.sql (Org A and its owner).
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

create schema tests;
grant usage on schema tests to authenticated;

create function tests.add_user(p_id uuid, p_email text, p_confirmed boolean default true) returns void
language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email, '',
          case when p_confirmed then now() end, '{}', '{}', now(), now(), '', '', '', '');
$$;

create function tests.act_as(p_user uuid) returns void language sql security definer as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'email', (select email from auth.users where id = p_user))::text,
    true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;

-- Org A:            00000000-0000-4000-a000-00000000000a
--   owner (seed)    a0000000-0000-4000-a000-000000000001
--   admin           a0000000-0000-4000-a000-000000000002
--   manager         a0000000-0000-4000-a000-000000000003
--   sales rep       a0000000-0000-4000-a000-000000000004
-- outsider          d0000000-0000-4000-d000-000000000001
-- invitee           d0000000-0000-4000-d000-000000000002
-- unconfirmed       d0000000-0000-4000-d000-000000000003
select tests.add_user('a0000000-0000-4000-a000-000000000002', 'admin.a@example.test');
select tests.add_user('a0000000-0000-4000-a000-000000000003', 'manager.a@example.test');
select tests.add_user('a0000000-0000-4000-a000-000000000004', 'rep.a@example.test');
select tests.add_user('d0000000-0000-4000-d000-000000000001', 'outsider@example.test');
select tests.add_user('d0000000-0000-4000-d000-000000000002', 'invitee@example.test');
select tests.add_user('d0000000-0000-4000-d000-000000000003', 'unconfirmed@example.test', false);
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-4000-a000-00000000000a', 'a0000000-0000-4000-a000-000000000002', 'admin'),
  ('00000000-0000-4000-a000-00000000000a', 'a0000000-0000-4000-a000-000000000003', 'manager'),
  ('00000000-0000-4000-a000-00000000000a', 'a0000000-0000-4000-a000-000000000004', 'sales_rep');

-- ── Direct inserts are closed ───────────────────────────────

set local role authenticated;
select tests.act_as('d0000000-0000-4000-d000-000000000001');
select throws_ok(
  $$ insert into org_members (org_id, user_id, role)
     values ('00000000-0000-4000-a000-00000000000a', 'd0000000-0000-4000-d000-000000000001', 'owner') $$,
  '42501', null,
  'a signed-in non-member cannot insert themselves into Org A'
);

select tests.act_as('a0000000-0000-4000-a000-000000000001');
select throws_ok(
  $$ insert into org_members (org_id, user_id, role)
     values ('00000000-0000-4000-a000-00000000000a', 'd0000000-0000-4000-d000-000000000001', 'viewer') $$,
  '42501', null,
  'even the owner cannot add members except through an invitation'
);

-- ── Who may invite which role ───────────────────────────────

select tests.act_as('a0000000-0000-4000-a000-000000000003');
select throws_ok($$ select org_invite('00000000-0000-4000-a000-00000000000a', 'x@example.test', 'owner') $$,
  'P0001', 'ACCESS_DENIED', 'a manager cannot invite an owner');
select throws_ok($$ select org_invite('00000000-0000-4000-a000-00000000000a', 'x@example.test', 'admin') $$,
  'P0001', 'ACCESS_DENIED', 'a manager cannot invite an admin');
select lives_ok($$ select org_invite('00000000-0000-4000-a000-00000000000a', 'x@example.test', 'sales_rep') $$,
  'a manager can invite a sales rep');

select tests.act_as('a0000000-0000-4000-a000-000000000004');
select throws_ok($$ select org_invite('00000000-0000-4000-a000-00000000000a', 'y@example.test', 'viewer') $$,
  'P0001', 'ACCESS_DENIED', 'a sales rep without team.invite cannot invite');

select tests.act_as('a0000000-0000-4000-a000-000000000002');
select throws_ok($$ select org_invite('00000000-0000-4000-a000-00000000000a', 'x@example.test', 'admin') $$,
  'P0001', 'ACCESS_DENIED', 'an admin cannot invite another admin');

select tests.act_as('d0000000-0000-4000-d000-000000000001');
select throws_ok($$ select org_invite('00000000-0000-4000-a000-00000000000a', 'x@example.test', 'viewer') $$,
  'P0001', 'ACCESS_DENIED', 'a non-member cannot invite');

select tests.act_as('a0000000-0000-4000-a000-000000000001');
select lives_ok($$ select org_invite('00000000-0000-4000-a000-00000000000a', 'x@example.test', 'admin') $$,
  'the owner can invite an admin');

-- ── Role changes respect rank ───────────────────────────────

select tests.act_as('a0000000-0000-4000-a000-000000000003');
select results_eq(
  $$ with u as (update org_members set role = 'admin'
                where user_id = 'a0000000-0000-4000-a000-000000000004' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'a manager cannot promote anyone'
);

select tests.act_as('a0000000-0000-4000-a000-000000000002');
select throws_ok(
  $$ update org_members set role = 'admin' where user_id = 'a0000000-0000-4000-a000-000000000004' $$,
  '42501', null, 'an admin cannot promote a member to admin'
);
select throws_ok(
  $$ update org_members set role = 'owner' where user_id = 'a0000000-0000-4000-a000-000000000004' $$,
  '42501', null, 'an admin cannot promote a member to owner'
);
select results_eq(
  $$ with u as (update org_members set role = 'viewer'
                where user_id = 'a0000000-0000-4000-a000-000000000001' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'an admin cannot change the owner'
);
select results_eq(
  $$ with d as (delete from org_members where user_id = 'a0000000-0000-4000-a000-000000000001' returning 1)
     select count(*)::int from d $$,
  $$ values (0) $$,
  'an admin cannot remove the owner'
);
select lives_ok(
  $$ update org_members set role = 'manager' where user_id = 'a0000000-0000-4000-a000-000000000004' $$,
  'an admin can promote a sales rep to manager'
);

-- ── Accepting invitations ───────────────────────────────────

select tests.act_as('a0000000-0000-4000-a000-000000000001');
select set_config('tests.token', org_invite('00000000-0000-4000-a000-00000000000a', 'Invitee@Example.test', 'sales_rep'), true);

select tests.act_as('d0000000-0000-4000-d000-000000000001');
select throws_ok($$ select org_accept_invitation(current_setting('tests.token')) $$,
  'P0001', 'ACCESS_DENIED', 'an invitation cannot be accepted from a different email');

select tests.act_as('d0000000-0000-4000-d000-000000000002');
select lives_ok($$ select org_accept_invitation(current_setting('tests.token')) $$,
  'the invited email accepts the invitation (case-insensitively)');
select results_eq(
  $$ select role from org_members
     where org_id = '00000000-0000-4000-a000-00000000000a' and user_id = 'd0000000-0000-4000-d000-000000000002' $$,
  $$ values ('sales_rep'::text) $$,
  'an accepted invitation yields exactly the invited role'
);
select throws_ok($$ select org_accept_invitation(current_setting('tests.token')) $$,
  'P0001', 'NOT_FOUND', 'a used token is rejected');

select tests.act_as('a0000000-0000-4000-a000-000000000001');
select set_config('tests.token', org_invite('00000000-0000-4000-a000-00000000000a', 'outsider@example.test', 'viewer'), true);
reset role;
update org_invitations set expires_at = now() - interval '1 minute' where email = 'outsider@example.test';
set local role authenticated;
select tests.act_as('d0000000-0000-4000-d000-000000000001');
select throws_ok($$ select org_accept_invitation(current_setting('tests.token')) $$,
  'P0001', 'NOT_FOUND', 'an expired token is rejected');

select tests.act_as('a0000000-0000-4000-a000-000000000001');
select set_config('tests.token', org_invite('00000000-0000-4000-a000-00000000000a', 'unconfirmed@example.test', 'viewer'), true);
select tests.act_as('d0000000-0000-4000-d000-000000000003');
select throws_ok($$ select org_accept_invitation(current_setting('tests.token')) $$,
  'P0001', 'ACCESS_DENIED', 'an account with an unconfirmed email cannot accept');

select throws_ok($$ select org_accept_invitation('not-a-real-token') $$,
  'P0001', 'NOT_FOUND', 'an unknown token is rejected');

reset role;
select * from finish();
rollback;
