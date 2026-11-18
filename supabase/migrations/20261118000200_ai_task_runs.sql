-- ============================================================
-- AI server-task audit (W0-09)
-- ============================================================
-- One row per LLM call made by a server task (deal scoring, reports). Prompt and output text
-- are deliberately not stored; input_digest lets a run be matched to its inputs if needed.

create table ai_task_runs (
  id            bigint generated always as identity primary key,
  org_id        uuid not null references organizations(id) on delete cascade,
  task          text not null,
  provider      text not null,
  model         text not null,
  status        text not null check (status in ('ok', 'not_configured', 'provider_error', 'timeout', 'invalid_output')),
  latency_ms    integer not null check (latency_ms >= 0),
  input_digest  text not null,
  created_at    timestamptz not null default now()
);
create index ai_task_runs_org_idx on ai_task_runs (org_id, created_at desc);

alter table ai_task_runs enable row level security;

create policy ai_task_runs_select on ai_task_runs
  for select to authenticated
  using (get_org_role(org_id) in ('owner', 'admin'));
-- Written only by server workers with the service role; no write policies for users.
