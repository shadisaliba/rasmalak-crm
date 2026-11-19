-- W2-03: partial profiles, regulatory facts without conclusions, missing-information actions,
-- change events and audit, consent.
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act_as(p_user uuid) returns void language sql security definer as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-a000-000000000001', 'authenticated', 'authenticated', 'adviser2@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', '');
insert into org_members (org_id, user_id, role) values ('00000000-0000-4000-a000-00000000000a', 'a2000000-0000-4000-a000-000000000001', 'adviser');

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');

-- ── Partial profile ─────────────────────────────────────────
select lives_ok($$ select sme_update_profile('00000000-0000-4000-a000-00000000000a', '{"trade_name":"Lina Studio","trade_name_ar":"استوديو لينا"}', gen_random_uuid(), 'p-1') $$,
  'a business can start with only a name');
select is((select base_currency::text from sme_business_profiles where org_id = '00000000-0000-4000-a000-00000000000a'), 'JOD', 'the base currency is JOD');
select ok((select count(*) from sme_actions where org_id = '00000000-0000-4000-a000-00000000000a' and rule_code = 'profile.missing_fact' and status = 'open') >= 13,
  'each unknown item becomes a missing-information action');
select is((select count(*)::int from sme_actions where dedupe_key = 'profile.missing_fact:fact.income_tax.registered'), 1, 'one action per item');

-- ── Facts: unknown stays neutral, known resolves the action ─
select lives_ok($$ select sme_set_fact('00000000-0000-4000-a000-00000000000a', 'income_tax.registered', null, 'unknown', gen_random_uuid(), 'f-1') $$,
  'the owner can say "not sure" about tax registration');
select is((select status from sme_actions where dedupe_key = 'profile.missing_fact:fact.income_tax.registered'), 'open',
  'an unknown tax status leaves a missing-information action open');
select is((select value from sme_profile_facts where org_id = '00000000-0000-4000-a000-00000000000a' and fact_key = 'income_tax.registered'), null,
  'and records no value: nothing is concluded');
select lives_ok($$ select sme_set_fact('00000000-0000-4000-a000-00000000000a', 'jofotara.status', '"registered_unsure"', 'known', gen_random_uuid(), 'f-2') $$,
  'the owner records a JoFotara status');
select is((select status from sme_actions where dedupe_key = 'profile.missing_fact:fact.jofotara.status'), 'resolved', 'answering resolves its action');
select throws_ok($$ select sme_set_fact('00000000-0000-4000-a000-00000000000a', 'employees.count', '"many"', 'known', gen_random_uuid(), 'f-3') $$,
  'P0001', 'VALIDATION_FAILED', 'a fact value must match its type');
select throws_ok($$ select sme_set_fact('00000000-0000-4000-a000-00000000000a', 'revenue.estimated', 'true', 'known', gen_random_uuid(), 'f-4') $$,
  'P0001', 'VALIDATION_FAILED', 'unknown fact keys are rejected');
select throws_ok($$ select sme_update_profile('00000000-0000-4000-a000-00000000000a', '{"governorate":"atlantis"}', gen_random_uuid(), 'p-2') $$,
  'P0001', 'VALIDATION_FAILED', 'lookup fields only accept listed values');
select throws_ok($$ select sme_update_profile('00000000-0000-4000-a000-00000000000a', '{"country":"AE"}', gen_random_uuid(), 'p-3') $$,
  'P0001', 'VALIDATION_FAILED', 'country and base currency cannot be patched');

-- ── Legal form and municipality changes are events and audited ─
select lives_ok($$ select sme_update_profile('00000000-0000-4000-a000-00000000000a', '{"legal_form":"sole_establishment","municipality":"greater_amman"}', gen_random_uuid(), 'p-4') $$,
  'the owner sets legal form and municipality');
reset role;
select ok(exists (select 1 from sme_outbox where event_type = 'BusinessProfileUpdated' and org_id = '00000000-0000-4000-a000-00000000000a'
  and payload -> 'changed' ? 'legal_form' and payload -> 'changed' ? 'municipality'), 'BusinessProfileUpdated lists the changed fields');
select ok(exists (select 1 from sme_audit_events where action = 'profile.updated' and payload -> 'changed' ? 'legal_form' and before_hash is not null and after_hash is not null),
  'the change is audited with before and after hashes');
select is((select status from sme_profile_facts where org_id = '00000000-0000-4000-a000-00000000000a' and fact_key = 'legal.form'), 'known',
  'legal form is mirrored as a fact for compliance rules');
set local role authenticated;

-- ── Permissions and gating ──────────────────────────────────
select tests.act_as('a2000000-0000-4000-a000-000000000001');
select throws_ok($$ select sme_update_profile('00000000-0000-4000-a000-00000000000a', '{"trade_name":"x"}', gen_random_uuid(), 'p-5') $$,
  'P0001', 'ACCESS_DENIED', 'an adviser can read but not change the profile');
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select throws_ok($$ select sme_update_profile('00000000-0000-4000-b000-00000000000b', '{"trade_name":"x"}', gen_random_uuid(), 'p-6') $$,
  'P0001', 'FEATURE_NOT_ENABLED', 'organizations without the SME suite cannot use it');

-- ── Consent ─────────────────────────────────────────────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select sme_record_consent('00000000-0000-4000-a000-00000000000a', 'ai_processing', 'draft-2026-11', true, gen_random_uuid());
select ok(sme_has_consent('00000000-0000-4000-a000-00000000000a', 'ai_processing'), 'consent is recorded');
select sme_record_consent('00000000-0000-4000-a000-00000000000a', 'ai_processing', 'draft-2026-11', false, gen_random_uuid());
select ok(not sme_has_consent('00000000-0000-4000-a000-00000000000a', 'ai_processing'), 'revocation takes effect immediately');

reset role;
select * from finish();
rollback;
