-- W3b-01: the content register. Four eyes, legal review for regulated items, publishing and
-- history, who reads what, and lesson progress.
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

-- Staff: an editor, an editor who is also a subject reviewer, a subject reviewer, a legal reviewer.
select tests.add_user('5e000000-0000-4000-a000-000000000001', 'editor@staff.example.test');
select tests.add_user('5e000000-0000-4000-a000-000000000002', 'editor.reviewer@staff.example.test');
select tests.add_user('5e000000-0000-4000-a000-000000000003', 'reviewer@staff.example.test');
select tests.add_user('5e000000-0000-4000-a000-000000000004', 'legal@staff.example.test');
insert into platform_staff (user_id, roles) values
  ('5e000000-0000-4000-a000-000000000001', array['content_editor']),
  ('5e000000-0000-4000-a000-000000000002', array['content_editor', 'subject_reviewer']),
  ('5e000000-0000-4000-a000-000000000003', array['subject_reviewer']),
  ('5e000000-0000-4000-a000-000000000004', array['legal_reviewer']);
-- A manager of Org A, who has no learning permission by default.
select tests.add_user('a4000000-0000-4000-a000-000000000001', 'manager.learn@org-a.example.test');
insert into org_members (org_id, user_id, role) values ('00000000-0000-4000-a000-00000000000a', 'a4000000-0000-4000-a000-000000000001', 'manager');

set local role authenticated;

-- ── Creating and reviewing ──────────────────────────────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select throws_ok($$ select content_create_item('{"slug":"not-staff"}') $$, 'P0001', 'ACCESS_DENIED', 'an organization owner is not platform staff');

select tests.act_as('5e000000-0000-4000-a000-000000000002');
create temp table i as select content_create_item('{"slug":"cash-basics","kind":"lesson","level":"beginner","topic_tags":["cash"]}') as id;
grant select on i to authenticated;
create temp table v1 as select (content_save_draft((select id from i), 'en',
  '{"title":"Cash basics","summary":"Why cash is not profit.","body":{"sections":[{"id":"s1","title":"Cash","blocks":[{"type":"p","text":"x"}]}]},"est_minutes":5}') ->> 'version_id')::uuid as id;
grant select on v1 to authenticated;
select is((select state from content_versions where id = (select id from v1)), 'draft', 'a new draft is a draft');
select lives_ok($$ select content_submit((select id from v1)) $$, 'the author submits it');
select throws_ok($$ select content_review((select id from v1), 'approve', null) $$, 'P0001', 'ACCESS_DENIED', 'the author cannot approve their own version');

select tests.act_as('5e000000-0000-4000-a000-000000000003');
select throws_ok($$ select content_review((select id from v1), 'request_changes', null) $$, 'P0001', 'VALIDATION_FAILED', 'asking for changes needs a note');
select is(content_review((select id from v1), 'approve', 'Clear and correct.') ->> 'state', 'approved', 'another reviewer approves it');

select tests.act_as('a0000000-0000-4000-a000-000000000001');
select is((select count(*)::int from content_versions where item_id = (select id from i)), 0, 'members see nothing before it is published');

select tests.act_as('5e000000-0000-4000-a000-000000000003');
select is(content_publish((select id from v1)) ->> 'state', 'published', 'a reviewer publishes the approved version');

-- ── Reading ─────────────────────────────────────────────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select is((select title from content_versions where item_id = (select id from i)), 'Cash basics', 'members of an SME organization read the published version');
select tests.act_as('a4000000-0000-4000-a000-000000000001');
select is((select count(*)::int from content_versions where item_id = (select id from i)), 0, 'a member without learning permission reads none');

-- ── A new version retires the old one, history kept ─────────
select tests.act_as('5e000000-0000-4000-a000-000000000001');
create temp table v2 as select (content_save_draft((select id from i), 'en',
  '{"title":"Cash basics (2)","summary":"Why cash is not profit, with an example.","body":{"sections":[]}}') ->> 'version_id')::uuid as id;
grant select on v2 to authenticated;
select is((select version from content_versions where id = (select id from v2)), 2, 'editing a published lesson starts version 2');
select content_submit((select id from v2));
select tests.act_as('5e000000-0000-4000-a000-000000000002');
select content_review((select id from v2), 'approve', null);
select content_publish((select id from v2));
select results_eq($$ select version, state from content_versions where item_id = (select id from i) order by version $$,
  $$ values (1, 'retired'), (2, 'published') $$, 'publishing version 2 retires version 1 and keeps it');

-- ── Regulated content needs a legal reviewer, a source and a date ─
select tests.act_as('5e000000-0000-4000-a000-000000000001');
create temp table ri as select content_create_item('{"slug":"test-tax-notice","kind":"notice","regulated":true}') as id;
grant select on ri to authenticated;
create temp table rv as select (content_save_draft((select id from ri), 'ar',
  '{"title":"TEST_ ملاحظة","summary":"TEST_ للاختبار فقط","body":{"sections":[]}}') ->> 'version_id')::uuid as id;
grant select on rv to authenticated;
select content_submit((select id from rv));
select tests.act_as('5e000000-0000-4000-a000-000000000003');
select is(content_review((select id from rv), 'approve', null) ->> 'state', 'in_review', 'a subject review alone does not approve regulated content');
select tests.act_as('5e000000-0000-4000-a000-000000000004');
select is(content_review((select id from rv), 'approve', null) ->> 'state', 'approved', 'the legal review completes the approval');
select throws_ok($$ select content_publish((select id from rv)) $$, 'P0001', 'ACCESS_DENIED', 'a legal reviewer alone cannot publish');
select tests.act_as('5e000000-0000-4000-a000-000000000003');
select throws_like($$ select content_publish((select id from rv)) $$, 'VALIDATION_FAILED', 'regulated content cannot publish without a legal source and a date');
reset role;
update content_versions set legal_source_ids = array[gen_random_uuid()], valid_from = current_date where id = (select id from rv);
set local role authenticated;
select tests.act_as('5e000000-0000-4000-a000-000000000003');
select is(content_publish((select id from rv)) ->> 'state', 'published', 'with a source and an effective date it publishes');
select ok(exists (select 1 from sme_audit_events where org_id is null and action = 'content.published' and subject_id = (select id from rv)),
  'every transition is audited at platform level');

-- ── Progress ────────────────────────────────────────────────
select tests.act_as('a0000000-0000-4000-a000-000000000001');
select is(content_record_progress('00000000-0000-4000-a000-00000000000a', (select id from v2), '{"section_id":"s1"}', 'p-1') ->> 'completed_at', null,
  'opening a lesson records where the reader is');
select isnt(content_record_progress('00000000-0000-4000-a000-00000000000a', (select id from v2), '{"completed":true}', 'p-2') ->> 'completed_at', null,
  'completing it needs no quiz');
select content_record_progress('00000000-0000-4000-a000-00000000000a', (select id from v2), '{"section_id":"s1"}', 'p-3');
select results_eq($$ select count(*)::int, max(last_section_id), bool_and(completed_at is not null) from lesson_progress where item_id = (select id from i) $$,
  $$ values (1, 's1', true) $$, 'resuming later keeps one row and the completion');
reset role;
select is((select count(*)::int from sme_outbox where event_type = 'LessonCompleted' and payload ->> 'itemId' = (select id from i)::text), 1,
  'LessonCompleted is emitted once');
set local role authenticated;
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select is((select count(*)::int from lesson_progress where org_id = '00000000-0000-4000-a000-00000000000a'), 0, 'Org B cannot read Org A progress');
select throws_ok($$ select content_record_progress('00000000-0000-4000-a000-00000000000a', (select id from v2), '{}', 'p-4') $$,
  'P0001', 'ACCESS_DENIED', 'and cannot record progress in Org A');

select * from finish();
rollback;
