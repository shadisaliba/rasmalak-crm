-- W3a-10: exports need sme.reports.export, are audited with their filter digest, and stay in the organization.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

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
select tests.add_user('a7000000-0000-4000-a000-000000000002', 'manager.reports@org-a.example.test');
insert into org_members (org_id, user_id, role) values ('00000000-0000-4000-a000-00000000000a', 'a7000000-0000-4000-a000-000000000002', 'manager');

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select ok(sme_record_export('00000000-0000-4000-a000-00000000000a', 'transactions', 'csv', repeat('c', 64), 12, null, 'x-1') ? 'exported_at',
  'the owner exports a report');
select throws_ok($$ select sme_record_export('00000000-0000-4000-a000-00000000000a', 'payroll', 'csv', repeat('c', 64), 1, null, 'x-2') $$,
  'P0001', 'VALIDATION_FAILED', 'only known reports');
select tests.act_as('a7000000-0000-4000-a000-000000000002');
select throws_ok($$ select sme_record_export('00000000-0000-4000-a000-00000000000a', 'transactions', 'csv', repeat('c', 64), 1, null, 'x-3') $$,
  'P0001', 'ACCESS_DENIED', 'a member without the export permission cannot');
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select throws_ok($$ select sme_record_export('00000000-0000-4000-a000-00000000000a', 'transactions', 'csv', repeat('c', 64), 1, null, 'x-4') $$,
  'P0001', 'ACCESS_DENIED', 'Org B cannot export from Org A');
reset role;
select ok(exists (select 1 from sme_audit_events where org_id = '00000000-0000-4000-a000-00000000000a' and action = 'report.exported'
                  and payload ->> 'filters_digest' = repeat('c', 64) and payload ->> 'rows' = '12'), 'the export is audited with its filter digest');

select * from finish();
rollback;
