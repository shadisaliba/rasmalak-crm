-- Baseline tenancy checks: RLS is on everywhere, and no member of one organization can
-- read another organization's rows in any table. Relies on supabase/seed.sql (Org A, Org B).
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- ── Helpers (rolled back with the transaction) ───────────────────────────────

create schema tests;
grant usage on schema tests to authenticated, anon;

-- Tables reachable only through a parent row, with the join that finds the owning organization.
create function tests.child_table_org_sql() returns table (table_name text, org_sql text)
language sql immutable as $$
  values
    ('crm_deal_stage_history', 'select d.org_id from crm_deal_stage_history h join crm_deals d on d.id = h.deal_id'),
    ('crm_document_versions',  'select d.org_id from crm_document_versions v join crm_documents d on d.id = v.document_id'),
    ('event_sync_map',         'select c.org_id from event_sync_map e join service_connections c on c.id = e.connection_id'),
    ('organizations',          'select id as org_id from organizations')
$$;

-- Row count per tenant-scoped table for one organization, as seen by the current role.
create function tests.rows_per_table(p_org uuid) returns table (table_name text, n bigint)
language plpgsql security invoker as $$
declare
  r record;
begin
  for r in
    select c.table_name::text as table_name, format('select org_id from public.%I', c.table_name) as org_sql
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type = 'BASE TABLE'
    union all
    select * from tests.child_table_org_sql()
  loop
    table_name := r.table_name;
    execute format('select count(*) from (%s) s where s.org_id = $1', r.org_sql) into n using p_org;
    return next;
  end loop;
end $$;
grant execute on all functions in schema tests to authenticated, anon;

create function tests.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;

-- ── 1. RLS everywhere ────────────────────────────────────────────────────────

select is_empty(
  $$ select c.relname::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'every public table has row-level security enabled'
);

select is_empty(
  $$ select c.relname::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname not in (select table_name from tests.rows_per_table('00000000-0000-4000-b000-00000000000b'))
       and c.relname not in ('crm_vertical_templates', 'crm_workflow_templates') $$,
  'every table except the global template catalogues is covered by the tenancy check'
);

-- ── 2. Fixtures: one Org B row in every tenant-scoped table ──────────────────

do $$
declare
  b  constant uuid := '00000000-0000-4000-b000-00000000000b';
  ub constant uuid := 'b0000000-0000-4000-b000-000000000001';
  v_contact uuid; v_pipeline uuid; v_stage uuid; v_deal uuid; v_workflow uuid;
  v_doc uuid; v_key uuid; v_conn uuid; v_wa uuid;
begin
  select id into v_contact from crm_contacts where org_id = b limit 1;
  select id into v_pipeline from crm_pipelines where org_id = b limit 1;
  select id into v_stage from crm_deal_stages where pipeline_id = v_pipeline order by position limit 1;

  insert into crm_companies (org_id, name, created_by) values (b, 'B Co', ub);
  insert into crm_deals (org_id, pipeline_id, stage_id, title, created_by)
    values (b, v_pipeline, v_stage, 'B deal', ub) returning id into v_deal;
  insert into crm_deal_stage_history (deal_id, to_stage_id, moved_by) values (v_deal, v_stage, ub);
  insert into crm_tasks (org_id, title, created_by) values (b, 'B task', ub);
  insert into crm_communications (org_id, contact_id, type, logged_by) values (b, v_contact, 'note', ub);
  insert into crm_custom_field_defs (org_id, entity_type, field_key, label, field_type)
    values (b, 'contact', 'b_field', 'B field', 'text');
  insert into crm_notifications (org_id, user_id, type, title) values (b, ub, 'info', 'B notice');
  insert into crm_audit_log (org_id, user_id, action, entity_type) values (b, ub, 'create', 'contact');
  insert into crm_imports (org_id, source, entity_type, created_by) values (b, 'csv', 'contact', ub);
  insert into crm_workflows (org_id, name, trigger_type) values (b, 'B workflow', 'deal_created')
    returning id into v_workflow;
  insert into crm_workflow_log (workflow_id, org_id) values (v_workflow, b);
  insert into crm_lead_scoring_rules (org_id, field, operator, value, points) values (b, 'source', 'eq', 'web', 5);
  insert into crm_routing_rules (org_id, name, type) values (b, 'B route', 'manual');
  insert into crm_document_templates (org_id, name, content) values (b, 'B template', 'x');
  insert into crm_documents (org_id, name, file_url) values (b, 'B doc', 'https://example.test/b.pdf')
    returning id into v_doc;
  insert into crm_document_versions (document_id, version, file_url) values (v_doc, 1, 'https://example.test/b1.pdf');
  insert into subscriptions (org_id, plan, seats_included, seats_max) values (b, 'organization', 3, 10);
  insert into billing_invoices (org_id, amount, currency) values (b, 10, 'USD');
  insert into payment_methods (org_id, type) values (b, 'card');
  insert into api_keys (org_id, name, key_hash, key_prefix) values (b, 'B key', 'hash-b', 'rk_b')
    returning id into v_key;
  insert into api_webhook_subscriptions (org_id, api_key_id, url, event_types, secret)
    values (b, v_key, 'https://example.test/hook', array['contact.created'], 's');
  insert into api_request_log (org_id, api_key_id, method, path, status_code) values (b, v_key, 'GET', '/v1/contacts', 200);
  insert into service_connections (org_id, user_id, provider, service_type, access_token)
    values (b, ub, 'google', 'calendar', 'token') returning id into v_conn;
  insert into event_sync_map (connection_id, external_event_id, entity_type, entity_id) values (v_conn, 'ext-1', 'task', v_deal);
  insert into slack_channel_configs (org_id, connection_id, channel_id) values (b, v_conn, 'C1');
  insert into health_events (org_id, event_type, severity, message) values (b, 'sync', 'info', 'ok');
  insert into whatsapp_accounts (org_id, phone_number, waba_id, access_token)
    values (b, '+962700000000', 'waba-b', 'token') returning id into v_wa;
  insert into whatsapp_templates (org_id, account_id, name, language, category, body)
    values (b, v_wa, 'b_template', 'ar', 'utility', 'x');
  insert into whatsapp_conversations (org_id, contact_phone) values (b, '+962700000001');
  insert into org_invitations (org_id, email, role, token_hash, invited_by)
    values (b, 'invitee.b@example.test', 'viewer', 'hash-of-b-token', ub);
  insert into ai_task_runs (org_id, task, provider, model, status, latency_ms, input_digest)
    values (b, 'deal_scoring', 'gemini', 'test-model', 'ok', 10, 'digest-b');
  insert into crm_outbound_drafts (org_id, workflow_id, channel, recipient, payload)
    values (b, v_workflow, 'slack', 'C-B', '{"message":"b"}');
end $$;

select is_empty(
  $$ select table_name from tests.rows_per_table('00000000-0000-4000-b000-00000000000b') where n = 0 $$,
  'fixtures put at least one Org B row in every tenant-scoped table'
);

-- ── 3. Isolation ─────────────────────────────────────────────────────────────

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');

select is_empty(
  $$ select table_name || ' (' || n || ')' from tests.rows_per_table('00000000-0000-4000-b000-00000000000b') where n > 0 $$,
  'a member of Org A cannot read any Org B row in any table'
);

select ok(
  (select count(*) from crm_contacts where org_id = '00000000-0000-4000-a000-00000000000a') = 1,
  'positive control: the Org A owner reads their own contacts'
);

select tests.act_as('c0000000-0000-4000-c000-000000000001');

select is_empty(
  $$ select table_name || ' (' || n || ')' from tests.rows_per_table('00000000-0000-4000-b000-00000000000b') where n > 0 $$,
  'a signed-in user with no organization cannot read any Org B row'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is_empty(
  $$ select table_name || ' (' || n || ')' from tests.rows_per_table('00000000-0000-4000-b000-00000000000b') where n > 0 $$,
  'the anonymous role cannot read any Org B row'
);

reset role;
select * from finish();
rollback;
