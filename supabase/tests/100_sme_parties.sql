-- W3a-01: parties are CRM companies and contacts with roles; identifiers are masked everywhere
-- except an audited reveal; bookkeepers manage parties without deal or pipeline rights.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-a000-000000000002', 'authenticated', 'authenticated', 'books@org-a.example.test', '', now(), '{}', '{}', now(), now(), '', '', '', '');
insert into org_members (org_id, user_id, role) values ('00000000-0000-4000-a000-00000000000a', 'a2000000-0000-4000-a000-000000000002', 'bookkeeper');

-- ── Bookkeepers and party roles ─────────────────────────────
select results_eq($$ select (permissions ->> 'companies.write')::boolean, (permissions ->> 'contacts.write')::boolean,
                            (permissions ->> 'deals.write')::boolean, (permissions ->> 'pipeline.configure')::boolean
                     from org_roles where org_id = '00000000-0000-4000-a000-00000000000a' and name = 'bookkeeper' $$,
  $$ values (true, true, false, false) $$, 'bookkeepers write companies and contacts, not deals or pipelines');
select results_eq($$ select (permissions ->> 'companies.write')::boolean, (permissions ->> 'companies.read')::boolean
                     from org_roles where org_id = '00000000-0000-4000-a000-00000000000a' and name = 'adviser' $$,
  $$ values (false, true) $$, 'advisers read companies and contacts only');

set local role authenticated;
select tests.act_as('a2000000-0000-4000-a000-000000000002');
select lives_ok($$ with x as (
  insert into crm_companies (org_id, name, party_roles, created_by)
  values ('00000000-0000-4000-a000-00000000000a', 'Al-Quds Packaging', array['supplier'], 'a2000000-0000-4000-a000-000000000002') returning id)
  insert into tests.ids select 'supplier', id from x $$,
  'a bookkeeper creates a supplier');
select throws_ok($$ insert into crm_companies (org_id, name, party_roles, created_by)
  values ('00000000-0000-4000-a000-00000000000a', 'Bad role', array['partner'], 'a2000000-0000-4000-a000-000000000002') $$,
  '23514', null, 'party roles are customer or supplier only');
select throws_ok($$ select sme_set_party_identifier('00000000-0000-4000-a000-00000000000a', jsonb_build_object('company_id', tests.id('supplier')),
  'tax_number', '12345678', null, 'pid-bk') $$, 'P0001', 'ACCESS_DENIED', 'bookkeepers do not handle identifiers by default');

-- ── Identifiers: masked, revealed only with an audit ────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select is(sme_set_party_identifier('00000000-0000-4000-a000-00000000000a', jsonb_build_object('company_id', tests.id('supplier')),
  'tax_number', ' ١٢٣٤ ٥٦٧٨ ', null, 'pid-1') ->> 'last4', '5678', 'the owner records a tax number; only the last four are returned');
select is((select last4 from sme_party_identifiers where company_id = tests.id('supplier')), '5678', 'last4 is readable');
select throws_ok($$ select value from sme_party_identifiers $$, '42501', null, 'the value column cannot be selected');
select throws_ok($$ select * from sme_party_identifiers $$, '42501', null, 'nor through select *');
select is(sme_reveal_identifier((select id from sme_party_identifiers where company_id = tests.id('supplier'))), '12345678',
  'the reveal returns the normalized value');
reset role;
select is((select count(*)::int from sme_audit_events where action = 'party.identifier.revealed'
           and subject_id = (select id from sme_party_identifiers where company_id = (select v from tests.ids where k = 'supplier'))), 1,
  'and is audited');
select is((select count(*)::int from sme_audit_events where action like 'party.identifier.%' and payload::text like '%12345678%'), 0,
  'the audit trail never holds the value');
set local role authenticated;
select tests.act_as('a2000000-0000-4000-a000-000000000002');
select is((select count(*)::int from sme_party_identifiers), 0, 'members without the identifier permission see no identifier rows');
select throws_ok($$ select sme_reveal_identifier((select v from tests.ids where k = 'supplier')) $$, 'P0001', 'NOT_FOUND',
  'and cannot reveal one');

select * from finish();
rollback;
