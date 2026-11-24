-- W3a-09: evaluation is idempotent and resolves what clears; people decide; reminders are drafts only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

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
create function tests.overdue(p_invoice text) returns jsonb language sql as $$
  select jsonb_build_object('rule_code', 'receivable_overdue', 'rule_version', '1.0.0', 'dedupe_key', 'receivable_overdue:' || p_invoice,
    'subject_type', 'invoice', 'subject_id', p_invoice, 'severity', 'warning', 'title_key', 'actions.rule.receivable_overdue.title',
    'body_key', 'actions.rule.receivable_overdue.body', 'params', jsonb_build_object('number', 'A-77'),
    'evidence', '[]'::jsonb, 'competency_tags', '["collections"]'::jsonb, 'required_perm', 'sme.receivables.read');
$$;

-- Fixtures in Org A: a customer, a contact there, and an overdue issued invoice.
select tests.add_user('a5000000-0000-4000-a000-000000000001', 'adviser.actions@org-a.example.test');
select tests.add_user('a5000000-0000-4000-a000-000000000002', 'manager.actions@org-a.example.test');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-4000-a000-00000000000a', 'a5000000-0000-4000-a000-000000000001', 'adviser'),
  ('00000000-0000-4000-a000-00000000000a', 'a5000000-0000-4000-a000-000000000002', 'manager');
insert into crm_companies (id, org_id, name, created_by) values
  ('a5000000-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-00000000000a', 'Al-Noor Trading', 'a0000000-0000-4000-a000-000000000001'),
  ('b5000000-0000-4000-b000-0000000000c1', '00000000-0000-4000-b000-00000000000b', 'Org B customer', 'b0000000-0000-4000-b000-000000000001');
insert into crm_contacts (id, org_id, company_id, first_name, phone, created_by) values
  ('a5000000-0000-4000-a000-0000000000d1', '00000000-0000-4000-a000-00000000000a', 'a5000000-0000-4000-a000-0000000000c1', 'Huda', '+962790000000', 'a0000000-0000-4000-a000-000000000001'),
  ('b5000000-0000-4000-b000-0000000000d1', '00000000-0000-4000-b000-00000000000b', 'b5000000-0000-4000-b000-0000000000c1', 'Other', '+962790000001', 'b0000000-0000-4000-b000-000000000001');
insert into sme_invoices (id, org_id, number, customer_company_id, issue_date, due_date, currency, subtotal_minor, total_minor, status, idempotency_key, created_by)
values ('a5000000-0000-4000-a000-0000000000e1', '00000000-0000-4000-a000-00000000000a', 'A-77', 'a5000000-0000-4000-a000-0000000000c1',
        current_date - 40, current_date - 10, 'JOD', 500000, 500000, 'open', 'actions-test-inv', 'a0000000-0000-4000-a000-000000000001');

-- ── Worker sync ─────────────────────────────────────────────
create temp table s1 as select sme_sync_actions_worker('00000000-0000-4000-a000-00000000000a', array['receivable_overdue'],
  jsonb_build_array(tests.overdue('a5000000-0000-4000-a000-0000000000e1')), '{"receivable_overdue":"1.0.0"}') as res;
select is(jsonb_array_length((select res -> 'opened' from s1)), 1, 'a new condition opens one action and reports it once');
select is(jsonb_array_length(sme_sync_actions_worker('00000000-0000-4000-a000-00000000000a', array['receivable_overdue'],
  jsonb_build_array(tests.overdue('a5000000-0000-4000-a000-0000000000e1')), '{}') -> 'opened'), 0,
  'evaluating again reports nothing new');
select is((select count(*)::int from sme_actions where dedupe_key = 'receivable_overdue:a5000000-0000-4000-a000-0000000000e1'), 1,
  'and creates no duplicate');
select is((sme_sync_actions_worker('00000000-0000-4000-a000-00000000000a', array['receivable_overdue'], '[]', '{}') ->> 'resolved')::int, 1,
  'when the condition clears the action resolves itself');
select is((select decision_reason from sme_actions where dedupe_key = 'receivable_overdue:a5000000-0000-4000-a000-0000000000e1'), 'condition_cleared',
  'with the reason recorded');
select is(jsonb_array_length(sme_sync_actions_worker('00000000-0000-4000-a000-00000000000a', array['receivable_overdue'],
  jsonb_build_array(tests.overdue('a5000000-0000-4000-a000-0000000000e1')), '{}') -> 'opened'), 1,
  'when it comes back the action reopens and is reported again');
select is((select evaluated_at is not null from sme_action_evaluations where org_id = '00000000-0000-4000-a000-00000000000a'), true,
  'the evaluation time is kept');
select is(jsonb_array_length(sme_sync_actions_worker('00000000-0000-4000-a000-00000000000a', array['cost_spike'],
  jsonb_build_array(tests.overdue('a5000000-0000-4000-a000-0000000000e1')), '{}') -> 'opened'), 0,
  'a sync touches only the rules it names');

set local role authenticated;

-- ── Decisions ───────────────────────────────────────────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
create temp table act as select id from sme_actions where dedupe_key = 'receivable_overdue:a5000000-0000-4000-a000-0000000000e1';
select throws_ok($$ select sme_decide_action('00000000-0000-4000-a000-00000000000a', (select id from act), 'dismiss', null, '', null, 'd-1') $$,
  'P0001', 'VALIDATION_FAILED', 'dismissing needs a reason');
select throws_ok($$ select sme_decide_action('00000000-0000-4000-a000-00000000000a', (select id from act), 'snooze', now() + interval '200 days', null, null, 'd-2') $$,
  'P0001', 'VALIDATION_FAILED', 'a snooze is at most 90 days');
select is(sme_decide_action('00000000-0000-4000-a000-00000000000a', (select id from act), 'snooze', now() + interval '1 day', null, null, 'd-3') #>> '{action,status}',
  'snoozed', 'the owner snoozes it for a day');
select is(sme_decide_action('00000000-0000-4000-a000-00000000000a', (select id from act), 'snooze', now() + interval '1 day', null, null, 'd-3') #>> '{action,status}',
  'snoozed', 'a replay returns the same decision');
select is(sme_decide_action('00000000-0000-4000-a000-00000000000a', (select id from act), 'dismiss', null, 'Paid in cash, receipt on its way', null, 'd-4') #>> '{action,status}',
  'dismissed', 'and then dismisses it with a reason');

-- ── Reminder drafts and tasks ───────────────────────────────
create temp table draft as select sme_draft_collection_reminder('00000000-0000-4000-a000-00000000000a', 'a5000000-0000-4000-a000-0000000000e1',
  'a5000000-0000-4000-a000-0000000000d1', '{"templateName":"payment_reminder","language":"ar","params":["Huda","A-77"]}', null, 'r-1') as res;
select is((select status from crm_outbound_drafts where id = (select (res ->> 'draft_id')::uuid from draft)), 'draft',
  'a reminder is an Outbox draft: nothing is sent');
select throws_ok($$ select sme_draft_collection_reminder('00000000-0000-4000-a000-00000000000a', 'a5000000-0000-4000-a000-0000000000e1',
  'b5000000-0000-4000-b000-0000000000d1', '{"templateName":"payment_reminder","params":[]}', null, 'r-2') $$,
  'P0001', 'NOT_FOUND', 'the recipient must be a contact of this customer');
select is(sme_action_create_task('00000000-0000-4000-a000-00000000000a', (select id from act), 'Call Huda about A-77', now() + interval '2 days', null, 't-1') ? 'task_id',
  true, 'a follow-up task is created from the action');
select throws_ok($$ select sme_action_create_task('00000000-0000-4000-a000-00000000000a', (select id from act), 'Again', null, null, 't-2') $$,
  'P0001', 'VALIDATION_FAILED', 'only once');

-- ── Settings and access ─────────────────────────────────────
select is(sme_set_action_settings('00000000-0000-4000-a000-00000000000a', 'receivable_overdue', true, '{"critical_days":45}', null, 's-1') #>> '{settings,params,critical_days}',
  '45', 'the owner changes a threshold');
select tests.act_as('a5000000-0000-4000-a000-000000000001');
select throws_ok($$ select sme_set_action_settings('00000000-0000-4000-a000-00000000000a', 'receivable_overdue', false, '{}', null, 's-2') $$,
  'P0001', 'ACCESS_DENIED', 'an adviser cannot');
select ok((select count(*) from sme_actions where org_id = '00000000-0000-4000-a000-00000000000a' and required_perm = 'sme.receivables.read') >= 1,
  'an adviser who reads invoices sees invoice actions');
select tests.act_as('a5000000-0000-4000-a000-000000000002');
select is((select count(*)::int from sme_actions where required_perm = 'sme.receivables.read'), 0, 'a manager without invoice access does not');
select throws_ok($$ select sme_sync_actions_worker('00000000-0000-4000-a000-00000000000a', array['receivable_overdue'], '[]', '{}') $$,
  '42501', null, 'the worker path is closed to signed-in users');
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select is((select count(*)::int from sme_actions where org_id = '00000000-0000-4000-a000-00000000000a'), 0, 'Org B reads none of Org A''s actions');
select throws_ok($$ select sme_decide_action('00000000-0000-4000-a000-00000000000a', (select id from act), 'reopen', null, null, null, 'b-1') $$,
  'P0001', 'ACCESS_DENIED', 'and cannot decide them');

select * from finish();
rollback;
