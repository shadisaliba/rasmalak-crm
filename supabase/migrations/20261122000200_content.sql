-- ============================================================
-- PLATFORM STAFF AND THE CONTENT REGISTER (W3b-01, blueprint §6 F2.09)
-- ============================================================
-- Lessons, checklists and playbooks are platform content, not tenant data: versioned per locale,
-- written by content editors, approved by a subject reviewer who is not the author, and, when
-- regulated (tax, legal, SSC, licensing, e-invoicing, PDP), also by a legal reviewer, with a
-- legal source and an effective date (rule R16). Nothing is machine-translated.

-- ── Platform staff ──────────────────────────────────────────

create table platform_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  roles text[] not null check (
    cardinality(roles) > 0
    and roles <@ array['content_editor', 'subject_reviewer', 'legal_reviewer', 'rules_admin', 'directory_curator', 'compliance_lead']::text[]),
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table platform_staff enable row level security;
create policy platform_staff_select_self on platform_staff for select to authenticated using (user_id = auth.uid());
revoke all on platform_staff from anon, authenticated;
grant select on platform_staff to authenticated;

-- Managed only by scripts/grant-staff.mjs (service role) in the MVP.
create or replace function is_staff(p_role text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from platform_staff s
    where s.user_id = auth.uid() and s.revoked_at is null and (p_role is null or p_role = any (s.roles))
  );
$$;

create policy sme_audit_events_staff_select on sme_audit_events for select to authenticated
  using (org_id is null and is_staff(null));

-- ── Search normalization (mirrors src/crm/search/normalizer.ts) ─

create or replace function content_normalize(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(translate(regexp_replace(coalesce(p_text, ''), '[ً-ٰٟـ]', '', 'g'), 'إأآٱةى', 'ااااهي'));
$$;

-- ── Content ─────────────────────────────────────────────────

create table content_items (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9][a-z0-9_-]{2,120}$'),
  kind text not null check (kind in ('lesson', 'checklist', 'playbook', 'notice')),
  regulated boolean not null default false,   -- tax, legal, SSC, licensing, e-invoicing, PDP
  level text check (level in ('beginner', 'intermediate', 'advanced')),
  topic_tags text[] not null default '{}',
  competency_tags text[] not null default '{}',
  segments text[] not null default '{}',
  legal_forms text[] not null default '{}',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table content_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references content_items(id),
  version int not null check (version > 0),
  locale text not null check (locale in ('ar', 'en')),
  title text not null check (length(title) between 1 and 200),
  summary text not null check (length(summary) between 1 and 600),
  -- Block schema of src/sme/content/types.ts: { sections: [{ id, title, blocks: [...] }] }.
  body jsonb not null check (jsonb_typeof(body) = 'object' and jsonb_typeof(body -> 'sections') = 'array'),
  est_minutes int check (est_minutes between 3 and 7),
  legal_source_ids uuid[] not null default '{}',     -- FK enforced in RPC once legal_sources exists (W3b-04)
  external_sources jsonb not null default '[]' check (jsonb_typeof(external_sources) = 'array'),
  state text not null default 'draft' check (state in ('draft', 'in_review', 'changes_requested', 'approved', 'published', 'retired')),
  author_id uuid not null references auth.users(id),
  submitted_at timestamptz,
  reviewer_id uuid references auth.users(id),
  reviewed_at timestamptz,
  legal_reviewer_id uuid references auth.users(id),
  legal_reviewed_at timestamptz,
  review_note text,
  valid_from date,
  valid_to date,
  published_at timestamptz,
  change_note text,
  search_norm text generated always as (content_normalize(title || ' ' || summary)) stored,
  unique (item_id, locale, version),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create unique index content_versions_one_published on content_versions (item_id, locale) where state = 'published';
create index content_versions_search_idx on content_versions using gin (search_norm gin_trgm_ops) where state = 'published';
create index content_versions_state_idx on content_versions (state, item_id);

-- Readers: any member of an SME organization who may use learning.
create or replace function content_can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from org_members m
    where m.user_id = auth.uid() and m.is_active and m.revoked_at is null
      and sme_enabled(m.org_id) and sme_has_perm(m.org_id, 'sme.learn.use')
  );
$$;

alter table content_items enable row level security;
alter table content_versions enable row level security;
create policy content_items_select on content_items for select to authenticated
  using ((select is_staff(null)) or (select content_can_read()));
-- Drafts and review data are staff-only; members see published versions.
create policy content_versions_select on content_versions for select to authenticated
  using ((select is_staff(null)) or (state = 'published' and (select content_can_read())));
revoke all on content_items, content_versions from anon, authenticated;
grant select on content_items, content_versions to authenticated;

-- ── Progress and feedback (tenant rows) ─────────────────────

create table lesson_progress (
  user_id uuid not null references auth.users(id),
  org_id uuid not null references organizations(id),
  item_id uuid not null references content_items(id),
  version_id uuid not null references content_versions(id),
  started_at timestamptz not null default now(),
  last_section_id text,
  completed_at timestamptz,
  quiz_score numeric(5,2) check (quiz_score between 0 and 100),   -- independent of completion
  quiz_attempts int not null default 0,
  primary key (user_id, org_id, item_id)
);

create table lesson_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  org_id uuid not null references organizations(id),
  item_id uuid not null references content_items(id),
  version_id uuid not null references content_versions(id),
  useful boolean not null,
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now()
);

alter table lesson_progress enable row level security;
alter table lesson_feedback enable row level security;
create policy lesson_progress_select on lesson_progress for select to authenticated
  using (user_id = auth.uid() and sme_has_perm(org_id, 'sme.learn.use'));
create policy lesson_feedback_select on lesson_feedback for select to authenticated
  using (user_id = auth.uid() or (select is_staff('subject_reviewer')) or (select is_staff('content_editor')));
revoke all on lesson_progress, lesson_feedback from anon, authenticated;
grant select on lesson_progress, lesson_feedback to authenticated;

-- ── Staff workflow ──────────────────────────────────────────

create or replace function content_require_staff(p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then perform sme_fail('UNAUTHENTICATED'); end if;
  if not exists (select 1 from platform_staff s where s.user_id = auth.uid() and s.revoked_at is null and s.roles && p_roles) then
    perform sme_fail('ACCESS_DENIED', jsonb_build_object('staff_roles', p_roles));
  end if;
end;
$$;

create or replace function content_text_array(p_obj jsonb, p_key text)
returns text[]
language plpgsql
immutable
as $$
begin
  if p_obj -> p_key is null or jsonb_typeof(p_obj -> p_key) = 'null' then return '{}'; end if;
  if jsonb_typeof(p_obj -> p_key) <> 'array' then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', p_key)); end if;
  return array(select jsonb_array_elements_text(p_obj -> p_key));
end;
$$;

create or replace function content_create_item(p_item jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform content_require_staff(array['content_editor']);
  if jsonb_typeof(p_item) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  begin
    insert into content_items (slug, kind, regulated, level, topic_tags, competency_tags, segments, legal_forms, created_by)
    values (
      sme_json_text(p_item, 'slug', 121, true),
      coalesce(p_item ->> 'kind', 'lesson'),
      coalesce((p_item ->> 'regulated')::boolean, false),
      nullif(p_item ->> 'level', ''),
      content_text_array(p_item, 'topic_tags'),
      content_text_array(p_item, 'competency_tags'),
      content_text_array(p_item, 'segments'),
      content_text_array(p_item, 'legal_forms'),
      auth.uid())
    returning id into v_id;
  exception
    when unique_violation then perform sme_fail('VALIDATION_FAILED', '{"field":"slug","reason":"taken"}');
    when check_violation or invalid_text_representation then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_item"}');
  end;
  perform sme_audit(null, 'content.item_created', 'content_item', v_id, null, null, jsonb_build_object('slug', p_item ->> 'slug'), null);
  return v_id;
end;
$$;

-- Creates the next draft for an item and locale, or updates the open draft. Whoever saves last is
-- the author, so the reviewer is always someone other than the person who wrote the text.
create or replace function content_save_draft(p_item uuid, p_locale text, p_draft jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row content_versions;
  v_next int;
begin
  perform content_require_staff(array['content_editor']);
  if not exists (select 1 from content_items where id = p_item) then perform sme_fail('NOT_FOUND', '{"field":"item"}'); end if;
  if p_locale not in ('ar', 'en') then perform sme_fail('VALIDATION_FAILED', '{"field":"locale"}'); end if;
  if jsonb_typeof(p_draft) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;

  select * into v_row from content_versions
  where item_id = p_item and locale = p_locale and state in ('draft', 'changes_requested')
  order by version desc limit 1 for update;

  begin
    if found then
      update content_versions set
        title = sme_json_text(p_draft, 'title', 200, true),
        summary = sme_json_text(p_draft, 'summary', 600, true),
        body = coalesce(p_draft -> 'body', body),
        est_minutes = nullif(p_draft ->> 'est_minutes', '')::int,
        legal_source_ids = coalesce(array(select jsonb_array_elements_text(p_draft -> 'legal_source_ids'))::uuid[], '{}'),
        external_sources = coalesce(p_draft -> 'external_sources', '[]'),
        valid_from = nullif(p_draft ->> 'valid_from', '')::date,
        valid_to = nullif(p_draft ->> 'valid_to', '')::date,
        change_note = sme_json_text(p_draft, 'change_note', 500),
        author_id = auth.uid()
      where id = v_row.id
      returning * into v_row;
    else
      select coalesce(max(version), 0) + 1 into v_next from content_versions where item_id = p_item and locale = p_locale;
      insert into content_versions (item_id, version, locale, title, summary, body, est_minutes, legal_source_ids, external_sources, valid_from, valid_to, change_note, author_id)
      values (
        p_item, v_next, p_locale,
        sme_json_text(p_draft, 'title', 200, true),
        sme_json_text(p_draft, 'summary', 600, true),
        coalesce(p_draft -> 'body', '{"sections":[]}'),
        nullif(p_draft ->> 'est_minutes', '')::int,
        coalesce(array(select jsonb_array_elements_text(p_draft -> 'legal_source_ids'))::uuid[], '{}'),
        coalesce(p_draft -> 'external_sources', '[]'),
        nullif(p_draft ->> 'valid_from', '')::date,
        nullif(p_draft ->> 'valid_to', '')::date,
        sme_json_text(p_draft, 'change_note', 500),
        auth.uid())
      returning * into v_row;
    end if;
  exception
    when check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then
      perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_draft"}');
  end;
  return jsonb_build_object('version_id', v_row.id, 'version', v_row.version, 'state', v_row.state);
end;
$$;

create or replace function content_lock_version(p_version uuid)
returns content_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row content_versions;
begin
  select * into v_row from content_versions where id = p_version for update;
  if not found then perform sme_fail('NOT_FOUND', '{"field":"version"}'); end if;
  return v_row;
end;
$$;

create or replace function content_submit(p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row content_versions;
begin
  perform content_require_staff(array['content_editor']);
  v_row := content_lock_version(p_version);
  if v_row.state not in ('draft', 'changes_requested') then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_state"}'); end if;
  update content_versions set state = 'in_review', submitted_at = now(),
    reviewer_id = null, reviewed_at = null, legal_reviewer_id = null, legal_reviewed_at = null, review_note = null
  where id = p_version;
  perform sme_audit(null, 'content.submitted', 'content_version', p_version, null, null, jsonb_build_object('item', v_row.item_id, 'locale', v_row.locale, 'version', v_row.version), null);
  return jsonb_build_object('version_id', p_version, 'state', 'in_review');
end;
$$;

-- A subject reviewer approves the substance; for regulated items a legal reviewer approves too.
-- Neither may review a version they authored (four eyes).
create or replace function content_review(p_version uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row content_versions;
  v_regulated boolean;
  v_subject boolean := is_staff('subject_reviewer');
  v_legal boolean := is_staff('legal_reviewer');
  v_state text;
begin
  perform content_require_staff(array['subject_reviewer', 'legal_reviewer']);
  v_row := content_lock_version(p_version);
  if v_row.state <> 'in_review' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_state"}'); end if;
  if v_row.author_id = auth.uid() then perform sme_fail('ACCESS_DENIED', '{"reason":"own_version"}'); end if;
  if p_decision not in ('approve', 'request_changes') then perform sme_fail('VALIDATION_FAILED', '{"field":"decision"}'); end if;
  if p_note is not null and length(p_note) > 2000 then perform sme_fail('VALIDATION_FAILED', '{"field":"note","reason":"too_long"}'); end if;
  select regulated into v_regulated from content_items where id = v_row.item_id;

  if p_decision = 'request_changes' then
    if nullif(btrim(coalesce(p_note, '')), '') is null then perform sme_fail('VALIDATION_FAILED', '{"field":"note","reason":"required"}'); end if;
    update content_versions set state = 'changes_requested', review_note = p_note,
      reviewer_id = null, reviewed_at = null, legal_reviewer_id = null, legal_reviewed_at = null
    where id = p_version;
    v_state := 'changes_requested';
  else
    if not ((v_subject and v_row.reviewer_id is null) or (v_regulated and v_legal and v_row.legal_reviewer_id is null)) then
      perform sme_fail('ACCESS_DENIED', '{"reason":"no_review_left_for_role"}');
    end if;
    update content_versions set
      reviewer_id = case when v_subject and reviewer_id is null then auth.uid() else reviewer_id end,
      reviewed_at = case when v_subject and reviewer_id is null then now() else reviewed_at end,
      legal_reviewer_id = case when v_regulated and v_legal and legal_reviewer_id is null then auth.uid() else legal_reviewer_id end,
      legal_reviewed_at = case when v_regulated and v_legal and legal_reviewer_id is null then now() else legal_reviewed_at end,
      review_note = coalesce(p_note, review_note)
    where id = p_version
    returning * into v_row;
    v_state := case when v_row.reviewer_id is not null and (not v_regulated or v_row.legal_reviewer_id is not null) then 'approved' else 'in_review' end;
    update content_versions set state = v_state where id = p_version;
  end if;
  perform sme_audit(null, 'content.reviewed', 'content_version', p_version, null, null,
    jsonb_build_object('decision', p_decision, 'state', v_state, 'subject', v_subject, 'legal', v_legal and v_regulated), null);
  return jsonb_build_object('version_id', p_version, 'state', v_state);
end;
$$;

create or replace function content_publish(p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row content_versions;
  v_regulated boolean;
  v_previous uuid;
begin
  perform content_require_staff(array['content_editor', 'subject_reviewer', 'compliance_lead']);
  v_row := content_lock_version(p_version);
  if v_row.state <> 'approved' then perform sme_fail('VALIDATION_FAILED', '{"reason":"not_approved"}'); end if;
  if v_row.reviewer_id is null or v_row.reviewer_id = v_row.author_id then perform sme_fail('VALIDATION_FAILED', '{"reason":"reviewer_required"}'); end if;
  select regulated into v_regulated from content_items where id = v_row.item_id;
  if v_regulated then
    if v_row.legal_reviewer_id is null or v_row.legal_reviewer_id = v_row.author_id then
      perform sme_fail('VALIDATION_FAILED', '{"reason":"legal_review_required"}');
    end if;
    if cardinality(v_row.legal_source_ids) = 0 then perform sme_fail('VALIDATION_FAILED', '{"reason":"legal_source_required"}'); end if;
    if v_row.valid_from is null then perform sme_fail('VALIDATION_FAILED', '{"reason":"valid_from_required"}'); end if;
  end if;

  update content_versions set state = 'retired' where item_id = v_row.item_id and locale = v_row.locale and state = 'published'
  returning id into v_previous;
  update content_versions set state = 'published', published_at = now() where id = p_version;
  perform sme_audit(null, 'content.published', 'content_version', p_version, null, null,
    jsonb_build_object('item', v_row.item_id, 'locale', v_row.locale, 'version', v_row.version, 'retired', v_previous), null);
  return jsonb_build_object('version_id', p_version, 'state', 'published', 'retired_version_id', v_previous);
end;
$$;

create or replace function content_retire(p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row content_versions;
begin
  perform content_require_staff(array['subject_reviewer', 'compliance_lead']);
  v_row := content_lock_version(p_version);
  if v_row.state not in ('published', 'approved') then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_state"}'); end if;
  update content_versions set state = 'retired' where id = p_version;
  perform sme_audit(null, 'content.retired', 'content_version', p_version, null, null, jsonb_build_object('item', v_row.item_id, 'locale', v_row.locale), null);
  return jsonb_build_object('version_id', p_version, 'state', 'retired');
end;
$$;

-- ── Learner actions ─────────────────────────────────────────

-- Starting, resuming and completing a lesson. Completion never depends on the quiz.
create or replace function content_record_progress(p_org uuid, p_version uuid, p_progress jsonb, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_version content_versions;
  v_before lesson_progress;
  v_row lesson_progress;
  v_complete boolean := coalesce((p_progress ->> 'completed')::boolean, false);
  v_score numeric := nullif(p_progress ->> 'quiz_score', '')::numeric;
  v_response jsonb;
begin
  perform sme_require(p_org, 'sme.learn.use');
  v_replay := sme_idem_begin(p_org, p_idem, 'learn.progress', jsonb_build_object('version', p_version, 'progress', p_progress));
  if v_replay is not null then return v_replay; end if;

  select * into v_version from content_versions where id = p_version and state = 'published';
  if not found then perform sme_fail('NOT_FOUND', '{"field":"version"}'); end if;
  if v_score is not null and (v_score < 0 or v_score > 100) then perform sme_fail('VALIDATION_FAILED', '{"field":"quiz_score"}'); end if;

  select * into v_before from lesson_progress where user_id = auth.uid() and org_id = p_org and item_id = v_version.item_id;
  insert into lesson_progress (user_id, org_id, item_id, version_id, last_section_id, completed_at, quiz_score, quiz_attempts)
  values (auth.uid(), p_org, v_version.item_id, p_version, sme_json_text(p_progress, 'section_id', 120),
          case when v_complete then now() end, v_score, case when v_score is null then 0 else 1 end)
  on conflict (user_id, org_id, item_id) do update set
    version_id = excluded.version_id,
    last_section_id = coalesce(excluded.last_section_id, lesson_progress.last_section_id),
    completed_at = coalesce(lesson_progress.completed_at, excluded.completed_at),
    quiz_score = coalesce(excluded.quiz_score, lesson_progress.quiz_score),
    quiz_attempts = lesson_progress.quiz_attempts + excluded.quiz_attempts
  returning * into v_row;

  if v_row.completed_at is not null and v_before.completed_at is null then
    perform sme_emit(p_org, 'LessonCompleted', jsonb_build_object('itemId', v_row.item_id, 'userId', v_row.user_id),
      'lesson:' || p_org || ':' || v_row.user_id || ':' || v_row.item_id);
  end if;
  v_response := jsonb_build_object('item_id', v_row.item_id, 'version_id', v_row.version_id, 'last_section_id', v_row.last_section_id,
    'completed_at', v_row.completed_at, 'quiz_score', v_row.quiz_score, 'quiz_attempts', v_row.quiz_attempts);
  return sme_idem_finish(p_org, p_idem, 'learn.progress', jsonb_build_object('version', p_version, 'progress', p_progress), v_response);
end;
$$;

create or replace function content_record_feedback(p_org uuid, p_version uuid, p_useful boolean, p_comment text, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_version content_versions;
  v_id uuid;
begin
  perform sme_require(p_org, 'sme.learn.use');
  v_replay := sme_idem_begin(p_org, p_idem, 'learn.feedback', jsonb_build_object('version', p_version, 'useful', p_useful, 'comment', p_comment));
  if v_replay is not null then return v_replay; end if;
  select * into v_version from content_versions where id = p_version and state = 'published';
  if not found then perform sme_fail('NOT_FOUND', '{"field":"version"}'); end if;
  if p_useful is null then perform sme_fail('VALIDATION_FAILED', '{"field":"useful"}'); end if;
  if p_comment is not null and length(p_comment) > 1000 then perform sme_fail('VALIDATION_FAILED', '{"field":"comment","reason":"too_long"}'); end if;
  insert into lesson_feedback (user_id, org_id, item_id, version_id, useful, comment)
  values (auth.uid(), p_org, v_version.item_id, p_version, p_useful, nullif(btrim(coalesce(p_comment, '')), ''))
  returning id into v_id;
  return sme_idem_finish(p_org, p_idem, 'learn.feedback', jsonb_build_object('version', p_version, 'useful', p_useful, 'comment', p_comment),
    jsonb_build_object('id', v_id));
end;
$$;

revoke all on function is_staff(text), content_can_read(), content_require_staff(text[]), content_text_array(jsonb, text),
  content_lock_version(uuid) from public, anon;
grant execute on function is_staff(text), content_can_read() to authenticated;
revoke all on function content_create_item(jsonb), content_save_draft(uuid, text, jsonb), content_submit(uuid),
  content_review(uuid, text, text), content_publish(uuid), content_retire(uuid),
  content_record_progress(uuid, uuid, jsonb, text), content_record_feedback(uuid, uuid, boolean, text, text) from public, anon;
grant execute on function content_create_item(jsonb), content_save_draft(uuid, text, jsonb), content_submit(uuid),
  content_review(uuid, text, text), content_publish(uuid), content_retire(uuid),
  content_record_progress(uuid, uuid, jsonb, text), content_record_feedback(uuid, uuid, boolean, text, text) to authenticated;
