-- W2-02: SME permissions by role, module scopes, revocation, and the SME feature gate.
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
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'email', (select email from auth.users where id = p_user))::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;

-- One member of Org A per role.
select tests.add_user(('a1000000-0000-4000-a000-00000000000' || n)::uuid, r || '@org-a.example.test')
from (values (1, 'admin'), (2, 'bookkeeper'), (3, 'adviser'), (4, 'manager'), (5, 'sales_rep'), (6, 'viewer')) v(n, r);
insert into org_members (org_id, user_id, role)
select '00000000-0000-4000-a000-00000000000a', ('a1000000-0000-4000-a000-00000000000' || n)::uuid, r
from (values (1, 'admin'), (2, 'bookkeeper'), (3, 'adviser'), (4, 'manager'), (5, 'sales_rep'), (6, 'viewer')) v(n, r);

create function tests.granted(p_role text) returns setof text language plpgsql as $$
declare
  v_user uuid;
  k text;
begin
  select user_id into v_user from org_members where org_id = '00000000-0000-4000-a000-00000000000a' and role = p_role limit 1;
  perform tests.act_as(v_user);
  foreach k in array sme_permission_keys() loop
    if sme_has_perm('00000000-0000-4000-a000-00000000000a', k) then return next k; end if;
  end loop;
end $$;

-- ── Role matrix ─────────────────────────────────────────────
select set_eq($$ select tests.granted('owner') $$, $$ select unnest(sme_permission_keys()) $$, 'owner holds every SME permission');
select set_eq($$ select tests.granted('admin') $$, $$ select unnest(sme_permission_keys()) $$, 'admin holds every SME permission');
select set_eq($$ select tests.granted('bookkeeper') $$, $$ values
  ('sme.profile.read'), ('sme.ledger.read'), ('sme.ledger.post'), ('sme.ledger.reverse'), ('sme.imports.execute'),
  ('sme.parties.read'), ('sme.receivables.read'), ('sme.receivables.write'), ('sme.payables.read'), ('sme.payables.write'),
  ('sme.forecast.read'), ('sme.forecast.scenario'), ('sme.reports.export'), ('sme.calc.run'), ('sme.calc.save'),
  ('sme.assistant.use'), ('sme.learn.use'), ('sme.compliance.read') $$, 'bookkeeper holds exactly the playbook defaults');
select set_eq($$ select tests.granted('adviser') $$, $$ values
  ('sme.profile.read'), ('sme.ledger.read'), ('sme.parties.read'), ('sme.receivables.read'), ('sme.payables.read'),
  ('sme.forecast.read'), ('sme.reports.export'), ('sme.calc.run'), ('sme.assistant.use'), ('sme.learn.use'),
  ('sme.compliance.read') $$, 'adviser holds exactly the playbook defaults');
select is_empty($$ select tests.granted('manager') $$, 'manager holds no SME permission by default');
select is_empty($$ select tests.granted('sales_rep') $$, 'sales rep holds no SME permission by default');
select is_empty($$ select tests.granted('viewer') $$, 'viewer holds no SME permission by default');
select is((select name_ar from org_roles where org_id = '00000000-0000-4000-a000-00000000000a' and name = 'bookkeeper'), 'محاسب', 'the bookkeeper role is named in Arabic');

-- ── Feature gate ────────────────────────────────────────────
select ok(sme_enabled('00000000-0000-4000-a000-00000000000a'), 'Org A (JO, organization plan) has SME enabled');
select ok(sme_enabled('00000000-0000-4000-b000-00000000000b'), 'Org B (JO, no subscription) has it too: the plan does not switch SME off');
update organizations set country = 'AE' where id = '00000000-0000-4000-a000-00000000000a';
select ok(not sme_enabled('00000000-0000-4000-a000-00000000000a'), 'SME is for Jordanian organizations only');
update organizations set country = 'JO' where id = '00000000-0000-4000-a000-00000000000a';

-- ── Module scopes ───────────────────────────────────────────
set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select lives_ok($$ select sme_set_member_modules('00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-000000000003',
  array['reports'], 'Year-end review only', gen_random_uuid(), 'modules-1') $$, 'the owner limits the adviser to reports');
select tests.act_as('a1000000-0000-4000-a000-000000000003');
select ok(sme_has_perm('00000000-0000-4000-a000-00000000000a', 'sme.reports.export'), 'a reports-only adviser can export reports');
select ok(not sme_has_perm('00000000-0000-4000-a000-00000000000a', 'sme.ledger.read'), 'a reports-only adviser cannot read the ledger');
select ok((sme_my_permissions('00000000-0000-4000-a000-00000000000a') ->> 'sme.ledger.read')::boolean = false, 'the UI sees the same answer');
select throws_ok($$ update org_members set allowed_modules = null where user_id = 'a1000000-0000-4000-a000-000000000003' $$,
  '42501', null, 'members cannot widen their own modules directly');

select tests.act_as('a1000000-0000-4000-a000-000000000004');
select throws_ok($$ select sme_set_member_modules('00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-000000000006',
  array['ledger'], 'x', gen_random_uuid(), 'modules-2') $$, 'P0001', 'ACCESS_DENIED', 'a manager cannot change SME access');

select tests.act_as('a1000000-0000-4000-a000-000000000001');
select throws_ok($$ select sme_revoke_member('00000000-0000-4000-a000-00000000000a', 'a0000000-0000-4000-a000-000000000001',
  'x', gen_random_uuid(), 'revoke-owner') $$, 'P0001', 'ACCESS_DENIED', 'an admin cannot revoke the owner');

-- ── Revocation takes effect on the next request ─────────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select lives_ok($$ select sme_revoke_member('00000000-0000-4000-a000-00000000000a', 'a1000000-0000-4000-a000-000000000002',
  'Engagement ended', gen_random_uuid(), 'revoke-1') $$, 'the owner revokes the bookkeeper');
select tests.act_as('a1000000-0000-4000-a000-000000000002');
select ok(not sme_has_perm('00000000-0000-4000-a000-00000000000a', 'sme.ledger.read'), 'a revoked bookkeeper loses access immediately');

-- ── An invited adviser gets only the tenant and modules assigned ─
reset role;
select tests.add_user('a1000000-0000-4000-a000-000000000009', 'adviser.invited@example.test');
set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select set_config('tests.token', org_invite('00000000-0000-4000-a000-00000000000a', 'adviser.invited@example.test', 'adviser', array['reports', 'ledger']), true);
select tests.act_as('a1000000-0000-4000-a000-000000000009');
select org_accept_invitation(current_setting('tests.token'));
select set_eq(
  $$ select key from jsonb_each_text(sme_my_permissions('00000000-0000-4000-a000-00000000000a')) where key like 'sme.%' and value = 'true' $$,
  $$ values ('sme.ledger.read'), ('sme.reports.export') $$,
  'an invited adviser holds only adviser permissions inside the assigned modules');
select ok(not sme_has_perm('00000000-0000-4000-b000-00000000000b', 'sme.ledger.read'), 'and nothing in another organization');

reset role;
select * from finish();
rollback;
