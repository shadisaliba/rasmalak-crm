-- ============================================================
-- SME PLATFORM (W2-01): idempotency, audit events, outbox
-- ============================================================
-- Shared mechanisms every SME write uses. The helper functions are internal: SME RPCs (SECURITY
-- DEFINER) call them inside their own transaction, and no client role may call them directly,
-- so nobody can forge audit rows or events.

-- ── Idempotency (rule R8) ───────────────────────────────────

create table sme_idempotency (
  org_id        uuid not null references organizations(id) on delete cascade,
  key           text not null check (length(key) between 1 and 200),
  operation     text not null,
  request_hash  text not null,
  response      jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (org_id, key)
);
create index sme_idempotency_created_idx on sme_idempotency (created_at);
alter table sme_idempotency enable row level security;
-- No policies: only SECURITY DEFINER functions touch this table.

-- Returns the stored response for a replay, null for a new key, and raises IDEMPOTENCY_CONFLICT
-- when the key was used for a different operation or body.
create or replace function sme_idem_begin(p_org uuid, p_key text, p_operation text, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text := encode(digest(coalesce(p_input, '{}'::jsonb)::text, 'sha256'), 'hex');
  v_row  sme_idempotency;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  -- Serialises concurrent requests with the same key, so the second waits and then replays.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || '|' || p_key, 0));
  select * into v_row from sme_idempotency where org_id = p_org and key = p_key;
  if not found then
    return null;
  end if;
  if v_row.operation <> p_operation or v_row.request_hash <> v_hash then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT',
      detail = jsonb_build_object('operation', v_row.operation)::text;
  end if;
  return v_row.response;
end;
$$;

create or replace function sme_idem_finish(p_org uuid, p_key text, p_operation text, p_input jsonb, p_response jsonb)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  insert into sme_idempotency (org_id, key, operation, request_hash, response)
  values (p_org, p_key, p_operation, encode(digest(coalesce(p_input, '{}'::jsonb)::text, 'sha256'), 'hex'), p_response);
  select p_response;
$$;

create or replace function sme_idem_purge(p_older_than interval default interval '30 days')
returns integer
language sql
security definer
set search_path = public
as $$
  with d as (delete from sme_idempotency where created_at < now() - p_older_than returning 1)
  select count(*)::int from d;
$$;

-- ── Audit events (rule R12) ─────────────────────────────────

create table sme_audit_events (
  id              bigint generated always as identity primary key,
  org_id          uuid references organizations(id) on delete restrict,  -- null: platform-level (content, rules)
  actor_id        uuid references auth.users(id),
  action          text not null,
  subject_type    text not null,
  subject_id      uuid,
  reason          text,
  before_hash     text,
  after_hash      text,
  payload         jsonb not null default '{}',
  correlation_id  uuid not null,
  created_at      timestamptz not null default now()
);
create index sme_audit_events_org_idx on sme_audit_events (org_id, created_at desc);
create index sme_audit_events_subject_idx on sme_audit_events (subject_type, subject_id);
alter table sme_audit_events enable row level security;
-- Read policies are added with sme_has_perm (W2-02) and staff roles (W3b-01).

create or replace function sme_audit_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = 'LEDGER_IMMUTABLE',
    detail = '{"table":"sme_audit_events"}';
end;
$$;

create trigger sme_audit_events_no_update_delete
  before update or delete on sme_audit_events
  for each row execute function sme_audit_events_immutable();
create trigger sme_audit_events_no_truncate
  before truncate on sme_audit_events
  for each statement execute function sme_audit_events_immutable();

-- Hashes are of jsonb's canonical text form, so equal values hash equally regardless of key order.
create or replace function sme_audit(
  p_org uuid,
  p_action text,
  p_subject_type text,
  p_subject_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_payload jsonb,
  p_correlation_id uuid,
  p_reason text default null
)
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  insert into sme_audit_events (org_id, actor_id, action, subject_type, subject_id, reason, before_hash, after_hash, payload, correlation_id)
  values (
    p_org, auth.uid(), p_action, p_subject_type, p_subject_id, p_reason,
    case when p_before is null then null else encode(digest(p_before::text, 'sha256'), 'hex') end,
    case when p_after is null then null else encode(digest(p_after::text, 'sha256'), 'hex') end,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_correlation_id, gen_random_uuid())
  )
  returning id;
$$;

-- ── Outbox ──────────────────────────────────────────────────

create table sme_outbox (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references organizations(id) on delete cascade,
  event_type    text not null,
  payload       jsonb not null,
  -- Unique per event type across all organizations, so callers include the org or subject id.
  dedupe_key    text not null,
  available_at  timestamptz not null default now(),
  attempts      int not null default 0,
  processed_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  unique (event_type, dedupe_key)
);
create index sme_outbox_pending_idx on sme_outbox (available_at, id) where processed_at is null;
alter table sme_outbox enable row level security;
-- No policies: written by SME RPCs, read by the worker with the service role.

create or replace function sme_emit(p_org uuid, p_type text, p_payload jsonb, p_dedupe_key text, p_available_at timestamptz default now())
returns void
language sql
security definer
set search_path = public
as $$
  insert into sme_outbox (org_id, event_type, payload, dedupe_key, available_at)
  values (p_org, p_type, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, coalesce(p_available_at, now()))
  on conflict (event_type, dedupe_key) do nothing;
$$;

-- Claims due events and leases them, so an overlapping worker run skips them. A row is
-- abandoned (left unprocessed for investigation) after 10 attempts.
create or replace function sme_outbox_claim(p_limit int default 100, p_lease interval default interval '5 minutes')
returns setof sme_outbox
language sql
security definer
set search_path = public
as $$
  update sme_outbox o
     set attempts = o.attempts + 1,
         available_at = now() + p_lease
   where o.id in (
     select id from sme_outbox
      where processed_at is null and available_at <= now() and attempts < 10
      order by id
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning o.*;
$$;

create or replace function sme_outbox_complete(p_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update sme_outbox set processed_at = now(), last_error = null where id = p_id and processed_at is null;
$$;

-- Exponential backoff: 2^attempts minutes after the failed attempt.
create or replace function sme_outbox_fail(p_id bigint, p_error text)
returns integer
language sql
security definer
set search_path = public
as $$
  update sme_outbox
     set available_at = now() + make_interval(mins => power(2, attempts)::int),
         last_error = left(p_error, 2000)
   where id = p_id and processed_at is null
  returning attempts;
$$;

revoke all on function sme_idem_begin(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function sme_idem_finish(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function sme_idem_purge(interval) from public, anon, authenticated;
revoke all on function sme_audit(uuid, text, text, uuid, jsonb, jsonb, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function sme_emit(uuid, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function sme_outbox_claim(int, interval) from public, anon, authenticated;
revoke all on function sme_outbox_complete(bigint) from public, anon, authenticated;
revoke all on function sme_outbox_fail(bigint, text) from public, anon, authenticated;
grant execute on function sme_idem_purge(interval) to service_role;
grant execute on function sme_outbox_claim(int, interval) to service_role;
grant execute on function sme_outbox_complete(bigint) to service_role;
grant execute on function sme_outbox_fail(bigint, text) to service_role;
