-- ============================================================
-- SME ACTION CENTRE (W3a-09, F1.11): rule settings, evaluation, decisions, reminder drafts
-- ============================================================
-- Rules run in the app (src/sme/actions/rules). The worker hands their result to
-- sme_sync_actions_worker, which upserts by dedupe_key and resolves what no longer applies, so
-- evaluating twice never creates a second action or a second notification.

-- An action shows figures from one register; only members who may read that register see it.
alter table sme_actions add column required_perm text
  check (required_perm is null or required_perm = any (sme_permission_keys()));
drop policy sme_actions_select on sme_actions;
create policy sme_actions_select on sme_actions
  for select to authenticated
  using (case when required_perm is null
              then sme_has_perm(org_id, 'sme.profile.read') or sme_has_perm(org_id, 'sme.ledger.read')
              else sme_has_perm(org_id, required_perm) end);
create index sme_actions_org_status_idx on sme_actions (org_id, status, severity);

create table sme_action_settings (
  org_id uuid not null references organizations(id) on delete restrict,
  rule_code text not null check (rule_code in ('receivable_overdue','forecast_shortfall','payables_due_soon','cost_spike',
                                               'stale_account_data','uncategorized_backlog','concentration_risk')),
  params jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  enabled boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, rule_code)
);

-- The last evaluation per organization: lets an event or a page view skip a run already done.
create table sme_action_evaluations (
  org_id uuid primary key references organizations(id) on delete restrict,
  evaluated_at timestamptz not null default now(),
  rule_versions jsonb not null default '{}',
  opened int not null default 0,
  resolved int not null default 0
);

alter table sme_action_settings enable row level security;
alter table sme_action_evaluations enable row level security;
create policy sme_action_settings_select on sme_action_settings for select to authenticated
  using (sme_has_perm(org_id, 'sme.profile.read') or sme_has_perm(org_id, 'sme.ledger.read'));
create policy sme_action_evaluations_select on sme_action_evaluations for select to authenticated
  using (sme_has_perm(org_id, 'sme.profile.read') or sme_has_perm(org_id, 'sme.ledger.read'));
revoke all on sme_action_settings, sme_action_evaluations from anon, authenticated;
grant select on sme_action_settings, sme_action_evaluations to authenticated;

-- ── Worker: apply one evaluation ────────────────────────────
-- p_actions: [{rule_code, rule_version, dedupe_key, subject_type, subject_id, severity, title_key,
-- body_key, params, evidence, competency_tags, required_perm}]. Returns the actions that are new or
-- came back after clearing, so the caller notifies once per action.

create or replace function sme_sync_actions_worker(p_org uuid, p_rule_codes text[], p_actions jsonb, p_rule_versions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keys text[];
  v_opened jsonb;
  v_resolved int;
begin
  if not sme_enabled(p_org) then
    raise exception using errcode = 'P0001', message = 'FEATURE_NOT_ENABLED';
  end if;
  if jsonb_typeof(p_actions) is distinct from 'array' then perform sme_fail('VALIDATION_FAILED', '{"field":"actions"}'); end if;

  select coalesce(array_agg(a ->> 'dedupe_key'), '{}') into v_keys from jsonb_array_elements(p_actions) a;

  -- Snoozes that have run out come back first, so the upsert below treats them as open.
  update sme_actions set status = 'open', snooze_until = null, updated_at = now()
   where org_id = p_org and status = 'snoozed' and snooze_until <= now();

  with incoming as (
    select a ->> 'rule_code' as rule_code, a ->> 'rule_version' as rule_version, a ->> 'dedupe_key' as dedupe_key,
           a ->> 'subject_type' as subject_type, nullif(a ->> 'subject_id', '')::uuid as subject_id,
           a ->> 'severity' as severity, a ->> 'title_key' as title_key, a ->> 'body_key' as body_key,
           coalesce(a -> 'params', '{}') as params, coalesce(a -> 'evidence', '[]') as evidence,
           coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(a -> 'competency_tags', '[]')) t), '{}') as tags,
           a ->> 'required_perm' as required_perm
      from jsonb_array_elements(p_actions) a
     where a ->> 'rule_code' = any (p_rule_codes)
  ), earlier as (
    -- Same snapshot as the upsert, so this is the state before it.
    select s.dedupe_key, s.status, s.decision_reason from sme_actions s
     where s.org_id = p_org and s.dedupe_key in (select dedupe_key from incoming)
  ), upserted as (
    insert into sme_actions as s (org_id, rule_code, rule_version, dedupe_key, subject_type, subject_id, severity,
                                  title_key, body_key, params, evidence, competency_tags, required_perm)
    select p_org, rule_code, rule_version, dedupe_key, subject_type, subject_id, severity, title_key, body_key,
           params, evidence, tags, required_perm
      from incoming
    on conflict (org_id, dedupe_key) do update
       set rule_version = excluded.rule_version, severity = excluded.severity, title_key = excluded.title_key,
           body_key = excluded.body_key, params = excluded.params, evidence = excluded.evidence,
           competency_tags = excluded.competency_tags, required_perm = excluded.required_perm,
           -- Cleared by itself and back again: open it. A person's resolve or dismiss stands.
           status = case when s.status = 'resolved' and s.decision_reason = 'condition_cleared' then 'open' else s.status end,
           decided_at = case when s.status = 'resolved' and s.decision_reason = 'condition_cleared' then null else s.decided_at end,
           decision_reason = case when s.status = 'resolved' and s.decision_reason = 'condition_cleared' then null else s.decision_reason end,
           updated_at = now()
     where s.status in ('open', 'snoozed') or (s.status = 'resolved' and s.decision_reason = 'condition_cleared')
    returning s.id, s.rule_code, s.dedupe_key, s.severity, s.title_key, s.params, s.subject_type, s.subject_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'rule_code', u.rule_code, 'dedupe_key', u.dedupe_key, 'severity', u.severity,
                                               'title_key', u.title_key, 'params', u.params, 'subject_type', u.subject_type, 'subject_id', u.subject_id))
                  filter (where e.dedupe_key is null or (e.status = 'resolved' and e.decision_reason = 'condition_cleared')), '[]')
    into v_opened
    from upserted u left join earlier e on e.dedupe_key = u.dedupe_key;

  with cleared as (
    update sme_actions set status = 'resolved', decided_by = null, decided_at = now(), decision_reason = 'condition_cleared', updated_at = now()
     where org_id = p_org and rule_code = any (p_rule_codes) and status in ('open', 'snoozed') and not (dedupe_key = any (v_keys))
    returning 1
  )
  select count(*) into v_resolved from cleared;

  insert into sme_action_evaluations (org_id, evaluated_at, rule_versions, opened, resolved)
  values (p_org, now(), coalesce(p_rule_versions, '{}'), jsonb_array_length(v_opened), v_resolved)
  on conflict (org_id) do update
     set evaluated_at = excluded.evaluated_at, rule_versions = excluded.rule_versions, opened = excluded.opened, resolved = excluded.resolved;

  return jsonb_build_object('opened', v_opened, 'resolved', v_resolved);
end;
$$;

-- ── People decide ───────────────────────────────────────────

create or replace function sme_decide_action(p_org uuid, p_action uuid, p_decision text, p_snooze_until timestamptz,
                                             p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_before sme_actions;
  v_row sme_actions;
  v_request jsonb := jsonb_build_object('action', p_action, 'decision', p_decision, 'until', p_snooze_until, 'reason', p_reason);
  v_response jsonb;
begin
  select * into v_before from sme_actions where id = p_action and org_id = p_org;
  if not found then perform sme_require(p_org, 'sme.ledger.read'); perform sme_fail('NOT_FOUND', '{"entity":"action"}'); end if;
  perform sme_require(p_org, coalesce(v_before.required_perm, 'sme.ledger.read'));
  if p_decision not in ('snooze', 'resolve', 'dismiss', 'reopen') then perform sme_fail('VALIDATION_FAILED', '{"field":"decision"}'); end if;

  v_replay := sme_idem_begin(p_org, p_idem, 'actions.decide', v_request);
  if v_replay is not null then return v_replay; end if;

  if p_decision = 'snooze' and (p_snooze_until is null or p_snooze_until <= now() or p_snooze_until > now() + interval '90 days') then
    perform sme_fail('VALIDATION_FAILED', '{"field":"snooze_until"}');
  end if;
  if p_decision = 'dismiss' and length(btrim(coalesce(p_reason, ''))) = 0 then
    perform sme_fail('VALIDATION_FAILED', '{"field":"reason","reason":"required"}');
  end if;
  if (p_decision in ('snooze', 'resolve', 'dismiss') and v_before.status not in ('open', 'snoozed'))
     or (p_decision = 'reopen' and v_before.status = 'open') then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid_state', 'from', v_before.status, 'decision', p_decision));
  end if;

  update sme_actions set
    status = case p_decision when 'snooze' then 'snoozed' when 'resolve' then 'resolved' when 'dismiss' then 'dismissed' else 'open' end,
    snooze_until = case when p_decision = 'snooze' then p_snooze_until end,
    decided_by = case when p_decision = 'reopen' then null else auth.uid() end,
    decided_at = case when p_decision = 'reopen' then null else now() end,
    decision_reason = case when p_decision = 'reopen' then null else nullif(left(btrim(coalesce(p_reason, '')), 500), '') end,
    updated_at = now()
  where id = p_action
  returning * into v_row;

  perform sme_audit(p_org, 'action.' || p_decision, 'action', v_row.id,
    jsonb_build_object('status', v_before.status), jsonb_build_object('status', v_row.status, 'snooze_until', v_row.snooze_until),
    jsonb_build_object('rule', v_row.rule_code), p_correlation_id, v_row.decision_reason);

  v_response := jsonb_build_object('action', jsonb_build_object('id', v_row.id, 'status', v_row.status, 'snooze_until', v_row.snooze_until));
  perform sme_idem_finish(p_org, p_idem, 'actions.decide', v_request, v_response);
  return v_response;
end;
$$;

-- A CRM task that follows the action up; the action keeps a link to it.
create or replace function sme_action_create_task(p_org uuid, p_action uuid, p_title text, p_due timestamptz,
                                                  p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_action sme_actions;
  v_task uuid;
  v_company uuid;
  v_contact uuid;
  v_request jsonb := jsonb_build_object('action', p_action, 'title', p_title, 'due', p_due);
  v_response jsonb;
begin
  select * into v_action from sme_actions where id = p_action and org_id = p_org;
  if not found then perform sme_require(p_org, 'sme.ledger.read'); perform sme_fail('NOT_FOUND', '{"entity":"action"}'); end if;
  perform sme_require(p_org, coalesce(v_action.required_perm, 'sme.ledger.read'));
  if not org_has_permission(p_org, 'tasks.write') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED', detail = '{"permission":"tasks.write"}';
  end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 200 then perform sme_fail('VALIDATION_FAILED', '{"field":"title"}'); end if;
  if v_action.crm_task_id is not null then perform sme_fail('VALIDATION_FAILED', '{"reason":"task_exists"}'); end if;

  v_replay := sme_idem_begin(p_org, p_idem, 'actions.task', v_request);
  if v_replay is not null then return v_replay; end if;

  if v_action.subject_type = 'invoice' then
    select customer_company_id, customer_contact_id into v_company, v_contact from sme_invoices where id = v_action.subject_id and org_id = p_org;
  elsif v_action.subject_type = 'bill' then
    select supplier_company_id, supplier_contact_id into v_company, v_contact from sme_bills where id = v_action.subject_id and org_id = p_org;
  end if;

  insert into crm_tasks (org_id, company_id, contact_id, title, type, priority, due_date, assigned_to, created_by)
  values (p_org, v_company, v_contact, btrim(p_title), 'follow_up',
          case v_action.severity when 'critical' then 'high' when 'warning' then 'medium' else 'low' end,
          p_due, auth.uid(), auth.uid())
  returning id into v_task;
  update sme_actions set crm_task_id = v_task, updated_at = now() where id = p_action;
  perform sme_audit(p_org, 'action.task_created', 'action', p_action, null, null, jsonb_build_object('task', v_task), p_correlation_id);

  v_response := jsonb_build_object('task_id', v_task);
  perform sme_idem_finish(p_org, p_idem, 'actions.task', v_request, v_response);
  return v_response;
end;
$$;

-- A collection reminder for an open invoice, as an Outbox draft. Nothing is sent until a person
-- approves the draft (rule R17); the worker then uses the organization's WhatsApp template.
create or replace function sme_draft_collection_reminder(p_org uuid, p_invoice uuid, p_contact uuid, p_payload jsonb,
                                                         p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_invoice sme_invoice_balances;
  v_draft uuid;
  v_request jsonb := jsonb_build_object('invoice', p_invoice, 'contact', p_contact, 'payload', p_payload);
  v_response jsonb;
begin
  perform sme_require(p_org, 'sme.receivables.read');
  if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload -> 'params') is distinct from 'array'
     or length(coalesce(p_payload ->> 'templateName', '')) not between 1 and 120 then
    perform sme_fail('VALIDATION_FAILED', '{"field":"payload"}');
  end if;

  v_replay := sme_idem_begin(p_org, p_idem, 'actions.reminder', v_request);
  if v_replay is not null then return v_replay; end if;

  select * into v_invoice from sme_invoice_balances where invoice_id = p_invoice and org_id = p_org;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"invoice"}'); end if;
  if v_invoice.derived_status not in ('open', 'partially_paid', 'overdue') then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invoice_not_open', 'status', v_invoice.derived_status));
  end if;
  -- The recipient is a contact of this organization: the invoice's contact or one at its company.
  if not exists (select 1 from crm_contacts c where c.id = p_contact and c.org_id = p_org
                   and (c.id = v_invoice.customer_contact_id or c.company_id = v_invoice.customer_company_id)) then
    perform sme_fail('NOT_FOUND', '{"entity":"contact"}');
  end if;

  insert into crm_outbound_drafts (org_id, channel, recipient, payload, entity_type, entity_id)
  values (p_org, 'whatsapp', p_contact::text, p_payload, 'invoice', p_invoice)
  returning id into v_draft;
  perform sme_audit(p_org, 'action.reminder_drafted', 'invoice', p_invoice, null, null,
    jsonb_build_object('draft', v_draft, 'channel', 'whatsapp'), p_correlation_id);

  v_response := jsonb_build_object('draft_id', v_draft);
  perform sme_idem_finish(p_org, p_idem, 'actions.reminder', v_request, v_response);
  return v_response;
end;
$$;

create or replace function sme_set_action_settings(p_org uuid, p_rule_code text, p_enabled boolean, p_params jsonb,
                                                   p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_row sme_action_settings;
  v_request jsonb := jsonb_build_object('rule', p_rule_code, 'enabled', p_enabled, 'params', p_params);
  v_response jsonb;
begin
  perform sme_require(p_org, 'sme.profile.manage');
  v_replay := sme_idem_begin(p_org, p_idem, 'actions.settings', v_request);
  if v_replay is not null then return v_replay; end if;
  begin
    insert into sme_action_settings (org_id, rule_code, params, enabled, updated_by, updated_at)
    values (p_org, p_rule_code, coalesce(p_params, '{}'), coalesce(p_enabled, true), auth.uid(), now())
    on conflict (org_id, rule_code) do update
       set params = excluded.params, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    returning * into v_row;
  exception
    when check_violation or not_null_violation then perform sme_fail('VALIDATION_FAILED', '{"field":"rule_code"}');
  end;
  perform sme_audit(p_org, 'action.settings_changed', 'action_settings', null, null, to_jsonb(v_row), null, p_correlation_id);
  v_response := jsonb_build_object('settings', to_jsonb(v_row));
  perform sme_idem_finish(p_org, p_idem, 'actions.settings', v_request, v_response);
  return v_response;
end;
$$;

revoke all on function sme_sync_actions_worker(uuid, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function sme_sync_actions_worker(uuid, text[], jsonb, jsonb) to service_role;
revoke all on function sme_decide_action(uuid, uuid, text, timestamptz, text, uuid, text) from public, anon;
revoke all on function sme_action_create_task(uuid, uuid, text, timestamptz, uuid, text) from public, anon;
revoke all on function sme_draft_collection_reminder(uuid, uuid, uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_set_action_settings(uuid, text, boolean, jsonb, uuid, text) from public, anon;
grant execute on function sme_decide_action(uuid, uuid, text, timestamptz, text, uuid, text) to authenticated;
grant execute on function sme_action_create_task(uuid, uuid, text, timestamptz, uuid, text) to authenticated;
grant execute on function sme_draft_collection_reminder(uuid, uuid, uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_set_action_settings(uuid, text, boolean, jsonb, uuid, text) to authenticated;
