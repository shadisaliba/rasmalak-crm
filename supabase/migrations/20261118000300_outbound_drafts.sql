-- ============================================================
-- OUTBOUND DRAFTS: automation never messages anyone without a person (D7, rule R17)
-- ============================================================
-- Outbound automation actions create a draft. A member approves or discards it; approved
-- drafts are sent by the automation worker, which holds the service role. The person's click
-- never runs with the service role (rule R11).

alter table crm_workflows
  add column requires_confirmation boolean not null default false;

create table crm_outbound_drafts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  workflow_id  uuid references crm_workflows(id) on delete set null,
  channel      text not null check (channel in ('email', 'whatsapp', 'slack', 'webhook')),
  recipient    text not null,
  payload      jsonb not null default '{}',
  entity_type  text,
  entity_id    uuid,
  -- approved: a person said send; the worker moves it to sent or failed.
  status       text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'failed', 'discarded')),
  last_error   text,
  created_at   timestamptz not null default now(),
  decided_by   uuid references auth.users(id),
  decided_at   timestamptz,
  sent_at      timestamptz,
  check ((status in ('draft')) = (decided_by is null))
);
create index crm_outbound_drafts_org_idx on crm_outbound_drafts (org_id, status, created_at desc);
create index crm_outbound_drafts_approved_idx on crm_outbound_drafts (created_at) where status = 'approved';

alter table crm_outbound_drafts enable row level security;

create policy crm_outbound_drafts_select on crm_outbound_drafts
  for select to authenticated
  using (is_org_member(org_id));
-- No write policies: the engine inserts with the service role; people decide through the function below.

create or replace function crm_decide_outbound_draft(p_draft uuid, p_decision text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;
  if p_decision not in ('approve', 'discard') then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"decision"}';
  end if;

  select org_id, status into v_org, v_status from crm_outbound_drafts where id = p_draft for update;
  if v_org is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if not org_has_permission(v_org, 'contacts.write') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  if v_status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = jsonb_build_object('reason', 'already_decided', 'status', v_status)::text;
  end if;

  update crm_outbound_drafts
     set status = case p_decision when 'approve' then 'approved' else 'discarded' end,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_draft;

  insert into crm_audit_log (org_id, user_id, action, entity_type, entity_id, changes)
  values (v_org, auth.uid(), case p_decision when 'approve' then 'outbound_draft.approved' else 'outbound_draft.discarded' end,
          'crm_outbound_draft', p_draft, '{}');

  return case p_decision when 'approve' then 'approved' else 'discarded' end;
end;
$$;

revoke all on function crm_decide_outbound_draft(uuid, text) from public, anon;
grant execute on function crm_decide_outbound_draft(uuid, text) to authenticated;
