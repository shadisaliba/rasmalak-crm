-- ============================================================
-- SME FORECAST (W3a-07, F1.09, FIN-05): scheduled items, scenarios, forecast settings and runs
-- ============================================================
-- The engine runs in the app (src/sme/forecast/domain/engine.ts). The database keeps its inputs
-- the owner enters, the scenarios, and every run with its input digest, so a figure on screen
-- can always be traced back to the run that produced it.

create table sme_scheduled_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  label text not null check (length(btrim(label)) between 1 and 120),
  direction text not null check (direction in ('in','out')),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9000000000000000),
  -- MVP forecasts are in the base currency, which is JOD (sme_business_profiles).
  currency char(3) not null default 'JOD' check (currency = 'JOD') references sme_currencies(code),
  start_date date not null,
  recurrence text not null default 'none' check (recurrence in ('none','weekly','monthly','quarterly','annually')),
  end_date date,
  category_id uuid references sme_categories(id),
  counterparty_company_id uuid references crm_companies(id),
  counterparty_contact_id uuid references crm_contacts(id),
  source text not null default 'owner_entered' check (source in ('owner_entered','detected_confirmed')),
  series_key text check (series_key is null or length(series_key) <= 200),
  is_estimate boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (source <> 'detected_confirmed' or series_key is not null)
);
create index sme_scheduled_items_org_idx on sme_scheduled_items (org_id, status);

create table sme_scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- Typed overrides, validated at the API boundary (src/sme/forecast/api/schemas.ts).
  overrides jsonb not null default '[]' check (jsonb_typeof(overrides) = 'array' and jsonb_array_length(overrides) <= 50),
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sme_scenarios_org_idx on sme_scenarios (org_id, status);

create table sme_forecast_settings (
  org_id uuid primary key references organizations(id) on delete restrict,
  buffer_minor bigint not null default 0 check (buffer_minor >= 0 and buffer_minor <= 9000000000000000),
  -- Detected recurring series the owner removed from the baseline.
  dismissed_series text[] not null default '{}' check (cardinality(dismissed_series) <= 500),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table sme_forecast_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  scenario_id uuid references sme_scenarios(id),
  engine_version text not null check (length(engine_version) <= 20),
  as_of date not null,
  input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
  assumptions jsonb not null default '[]' check (jsonb_typeof(assumptions) = 'array'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  data_quality jsonb not null default '{}' check (jsonb_typeof(data_quality) = 'object'),
  trigger text not null check (trigger in ('request','event')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  -- The same inputs, scenario and engine give the same result, so they are stored once.
  unique nulls not distinct (org_id, scenario_id, engine_version, input_digest)
);
create index sme_forecast_runs_latest_idx on sme_forecast_runs (org_id, scenario_id, created_at desc);

create or replace function sme_forecast_runs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = 'LEDGER_IMMUTABLE', detail = '{"table":"sme_forecast_runs"}';
end;
$$;

create trigger sme_forecast_runs_no_update_delete
  before update or delete on sme_forecast_runs
  for each row execute function sme_forecast_runs_immutable();

-- ── RLS (reads only; writes go through the RPCs below, rule R10) ─

alter table sme_scheduled_items enable row level security;
alter table sme_scenarios enable row level security;
alter table sme_forecast_settings enable row level security;
alter table sme_forecast_runs enable row level security;

create policy sme_scheduled_items_select on sme_scheduled_items for select to authenticated using (sme_has_perm(org_id, 'sme.forecast.read'));
create policy sme_scenarios_select on sme_scenarios for select to authenticated using (sme_has_perm(org_id, 'sme.forecast.read'));
create policy sme_forecast_settings_select on sme_forecast_settings for select to authenticated using (sme_has_perm(org_id, 'sme.forecast.read'));
create policy sme_forecast_runs_select on sme_forecast_runs for select to authenticated using (sme_has_perm(org_id, 'sme.forecast.read'));

revoke all on sme_scheduled_items, sme_scenarios, sme_forecast_settings, sme_forecast_runs from anon, authenticated;
grant select on sme_scheduled_items, sme_scenarios, sme_forecast_settings, sme_forecast_runs to authenticated;

-- ── Scheduled items ─────────────────────────────────────────

create or replace function sme_save_scheduled_item(p_org uuid, p_id uuid, p_item jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_before sme_scheduled_items;
  v_row sme_scheduled_items;
  v_category uuid;
  v_company uuid;
  v_contact uuid;
  v_source text;
  v_recurrence text;
  v_direction text;
  v_response jsonb;
begin
  perform sme_require(p_org, 'sme.forecast.scenario');
  if jsonb_typeof(p_item) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;

  v_replay := sme_idem_begin(p_org, p_idem, 'forecast.item.save', jsonb_build_object('id', p_id, 'item', p_item));
  if v_replay is not null then return v_replay; end if;

  if p_id is not null then
    select * into v_before from sme_scheduled_items where id = p_id and org_id = p_org for update;
    if not found then perform sme_fail('NOT_FOUND', '{"entity":"scheduled_item"}'); end if;
    if v_before.status = 'archived' then perform sme_fail('VALIDATION_FAILED', '{"reason":"archived"}'); end if;
  end if;

  v_direction := sme_json_text(p_item, 'direction', 3, true);
  if v_direction not in ('in', 'out') then perform sme_fail('VALIDATION_FAILED', '{"field":"direction"}'); end if;
  v_recurrence := coalesce(sme_json_text(p_item, 'recurrence', 10, false), 'none');
  if v_recurrence not in ('none', 'weekly', 'monthly', 'quarterly', 'annually') then
    perform sme_fail('VALIDATION_FAILED', '{"field":"recurrence"}');
  end if;
  v_source := coalesce(sme_json_text(p_item, 'source', 20, false), 'owner_entered');
  if v_source not in ('owner_entered', 'detected_confirmed') then perform sme_fail('VALIDATION_FAILED', '{"field":"source"}'); end if;

  v_category := sme_json_uuid(p_item, 'category_id', false);
  if v_category is not null and not exists (
    select 1 from sme_categories where id = v_category and (org_id is null or org_id = p_org) and active
  ) then
    perform sme_fail('NOT_FOUND', '{"entity":"category"}');
  end if;
  v_company := sme_json_uuid(p_item, 'counterparty_company_id', false);
  v_contact := sme_json_uuid(p_item, 'counterparty_contact_id', false);
  if v_company is not null or v_contact is not null then
    perform sme_require_party_in_org(p_org, v_company, v_contact);
  end if;

  begin
    if p_id is null then
      insert into sme_scheduled_items (
        org_id, label, direction, amount_minor, start_date, recurrence, end_date, category_id,
        counterparty_company_id, counterparty_contact_id, source, series_key, is_estimate, created_by)
      values (
        p_org, btrim(sme_json_text(p_item, 'label', 120, true)), v_direction, sme_json_minor(p_item, 'amount_minor', true),
        sme_json_date(p_item, 'start_date'), v_recurrence, sme_json_date(p_item, 'end_date', false), v_category,
        v_company, v_contact, v_source, sme_json_text(p_item, 'series_key', 200, false),
        coalesce((p_item ->> 'is_estimate')::boolean, false), auth.uid())
      returning * into v_row;
    else
      update sme_scheduled_items set
        label = btrim(sme_json_text(p_item, 'label', 120, true)),
        direction = v_direction,
        amount_minor = sme_json_minor(p_item, 'amount_minor', true),
        start_date = sme_json_date(p_item, 'start_date'),
        recurrence = v_recurrence,
        end_date = sme_json_date(p_item, 'end_date', false),
        category_id = v_category,
        counterparty_company_id = v_company,
        counterparty_contact_id = v_contact,
        is_estimate = coalesce((p_item ->> 'is_estimate')::boolean, false),
        updated_by = auth.uid(),
        updated_at = now()
      where id = p_id
      returning * into v_row;
    end if;
  exception
    when check_violation or not_null_violation or invalid_text_representation then
      perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid_item'));
  end;

  perform sme_emit(p_org, 'ScheduledItemChanged', jsonb_build_object('itemId', v_row.id), 'scheduled:' || v_row.id || ':' || v_row.updated_at);
  perform sme_audit(p_org, case when p_id is null then 'forecast.item_created' else 'forecast.item_updated' end,
    'scheduled_item', v_row.id, case when p_id is null then null else to_jsonb(v_before) end, to_jsonb(v_row), null, p_correlation_id);

  v_response := jsonb_build_object('item', to_jsonb(v_row));
  perform sme_idem_finish(p_org, p_idem, 'forecast.item.save', jsonb_build_object('id', p_id, 'item', p_item), v_response);
  return v_response;
end;
$$;

create or replace function sme_archive_scheduled_item(p_org uuid, p_id uuid, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_row sme_scheduled_items;
  v_response jsonb;
begin
  perform sme_require(p_org, 'sme.forecast.scenario');
  v_replay := sme_idem_begin(p_org, p_idem, 'forecast.item.archive', jsonb_build_object('id', p_id));
  if v_replay is not null then return v_replay; end if;

  update sme_scheduled_items set status = 'archived', updated_by = auth.uid(), updated_at = now()
   where id = p_id and org_id = p_org and status = 'active'
  returning * into v_row;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"scheduled_item"}'); end if;

  perform sme_emit(p_org, 'ScheduledItemChanged', jsonb_build_object('itemId', v_row.id), 'scheduled:' || v_row.id || ':archived');
  perform sme_audit(p_org, 'forecast.item_archived', 'scheduled_item', v_row.id, null, null, null, p_correlation_id);

  v_response := jsonb_build_object('item', to_jsonb(v_row));
  perform sme_idem_finish(p_org, p_idem, 'forecast.item.archive', jsonb_build_object('id', p_id), v_response);
  return v_response;
end;
$$;

-- ── Scenarios (the baseline is never overwritten by one) ────

create or replace function sme_save_scenario(p_org uuid, p_id uuid, p_name text, p_overrides jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_row sme_scenarios;
  v_request jsonb := jsonb_build_object('id', p_id, 'name', p_name, 'overrides', p_overrides);
  v_response jsonb;
begin
  perform sme_require(p_org, 'sme.forecast.scenario');
  v_replay := sme_idem_begin(p_org, p_idem, 'forecast.scenario.save', v_request);
  if v_replay is not null then return v_replay; end if;

  begin
    if p_id is null then
      insert into sme_scenarios (org_id, name, overrides, created_by)
      values (p_org, btrim(p_name), coalesce(p_overrides, '[]'), auth.uid())
      returning * into v_row;
    else
      update sme_scenarios set name = btrim(p_name), overrides = coalesce(p_overrides, '[]'), updated_at = now()
       where id = p_id and org_id = p_org and status = 'active'
      returning * into v_row;
      if not found then perform sme_fail('NOT_FOUND', '{"entity":"scenario"}'); end if;
    end if;
  exception
    when check_violation or not_null_violation then
      perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid_scenario'));
  end;

  perform sme_audit(p_org, case when p_id is null then 'forecast.scenario_created' else 'forecast.scenario_updated' end,
    'scenario', v_row.id, null, jsonb_build_object('name', v_row.name, 'overrides', v_row.overrides), null, p_correlation_id);

  v_response := jsonb_build_object('scenario', to_jsonb(v_row));
  perform sme_idem_finish(p_org, p_idem, 'forecast.scenario.save', v_request, v_response);
  return v_response;
end;
$$;

create or replace function sme_archive_scenario(p_org uuid, p_id uuid, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_row sme_scenarios;
  v_response jsonb;
begin
  perform sme_require(p_org, 'sme.forecast.scenario');
  v_replay := sme_idem_begin(p_org, p_idem, 'forecast.scenario.archive', jsonb_build_object('id', p_id));
  if v_replay is not null then return v_replay; end if;

  update sme_scenarios set status = 'archived', updated_at = now()
   where id = p_id and org_id = p_org and status = 'active'
  returning * into v_row;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"scenario"}'); end if;
  perform sme_audit(p_org, 'forecast.scenario_archived', 'scenario', v_row.id, null, null, null, p_correlation_id);

  v_response := jsonb_build_object('scenario', to_jsonb(v_row));
  perform sme_idem_finish(p_org, p_idem, 'forecast.scenario.archive', jsonb_build_object('id', p_id), v_response);
  return v_response;
end;
$$;

-- ── Settings: the cash buffer and removed detected series ───

create or replace function sme_set_forecast_settings(p_org uuid, p_settings jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_before sme_forecast_settings;
  v_row sme_forecast_settings;
  v_buffer bigint;
  v_dismissed text[];
  v_response jsonb;
begin
  perform sme_require(p_org, 'sme.forecast.scenario');
  if jsonb_typeof(p_settings) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'forecast.settings', p_settings);
  if v_replay is not null then return v_replay; end if;

  select * into v_before from sme_forecast_settings where org_id = p_org for update;
  v_buffer := case when p_settings ? 'buffer_minor' then sme_json_minor(p_settings, 'buffer_minor', true) else coalesce(v_before.buffer_minor, 0) end;
  if p_settings ? 'dismissed_series' then
    if jsonb_typeof(p_settings -> 'dismissed_series') <> 'array' then
      perform sme_fail('VALIDATION_FAILED', '{"field":"dismissed_series"}');
    end if;
    select coalesce(array_agg(distinct value), '{}') into v_dismissed from jsonb_array_elements_text(p_settings -> 'dismissed_series');
    if exists (select 1 from unnest(v_dismissed) k where length(k) not between 1 and 200) then
      perform sme_fail('VALIDATION_FAILED', '{"field":"dismissed_series"}');
    end if;
  else
    v_dismissed := coalesce(v_before.dismissed_series, '{}');
  end if;

  begin
    insert into sme_forecast_settings (org_id, buffer_minor, dismissed_series, updated_by, updated_at)
    values (p_org, v_buffer, v_dismissed, auth.uid(), now())
    on conflict (org_id) do update
      set buffer_minor = excluded.buffer_minor, dismissed_series = excluded.dismissed_series,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at
    returning * into v_row;
  exception
    when check_violation then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid_settings'));
  end;

  perform sme_audit(p_org, 'forecast.settings_changed', 'forecast_settings', null,
    case when v_before.org_id is null then null else to_jsonb(v_before) end, to_jsonb(v_row), null, p_correlation_id);

  v_response := jsonb_build_object('settings', to_jsonb(v_row));
  perform sme_idem_finish(p_org, p_idem, 'forecast.settings', p_settings, v_response);
  return v_response;
end;
$$;

-- ── Runs ────────────────────────────────────────────────────
-- Stores a run once per (scenario, engine version, input digest). A new baseline run emits
-- ForecastRecalculated, which the action centre (W3a-09) consumes.

create or replace function sme_forecast_run_insert(p_org uuid, p_run jsonb, p_trigger text, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scenario uuid;
  v_row sme_forecast_runs;
  v_created boolean := true;
begin
  if jsonb_typeof(p_run) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  v_scenario := sme_json_uuid(p_run, 'scenario_id', false);
  if v_scenario is not null and not exists (select 1 from sme_scenarios where id = v_scenario and org_id = p_org) then
    perform sme_fail('NOT_FOUND', '{"entity":"scenario"}');
  end if;

  begin
    insert into sme_forecast_runs (org_id, scenario_id, engine_version, as_of, input_digest, assumptions, result, data_quality, trigger, created_by)
    values (
      p_org, v_scenario,
      sme_json_text(p_run, 'engine_version', 20, true),
      sme_json_date(p_run, 'as_of'),
      sme_json_text(p_run, 'input_digest', 64, true),
      coalesce(p_run -> 'assumptions', '[]'),
      p_run -> 'result',
      coalesce(p_run -> 'data_quality', '{}'),
      p_trigger, p_user)
    on conflict (org_id, scenario_id, engine_version, input_digest) do nothing
    returning * into v_row;
  exception
    when check_violation or not_null_violation then
      perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid_run'));
  end;

  if v_row.id is null then
    v_created := false;
    select * into v_row from sme_forecast_runs
     where org_id = p_org and scenario_id is not distinct from v_scenario
       and engine_version = p_run ->> 'engine_version' and input_digest = p_run ->> 'input_digest';
  elsif v_scenario is null then
    perform sme_emit(p_org, 'ForecastRecalculated', jsonb_build_object('runId', v_row.id), 'forecast:' || v_row.id);
  end if;

  return jsonb_build_object('id', v_row.id, 'created', v_created, 'created_at', v_row.created_at);
end;
$$;

create or replace function sme_record_forecast_run(p_org uuid, p_run jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform sme_require(p_org, 'sme.forecast.read');
  return sme_forecast_run_insert(p_org, p_run, 'request', auth.uid());
end;
$$;

-- Worker path (outbox handler, service role, rule R11).
create or replace function sme_record_forecast_run_worker(p_org uuid, p_run jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not sme_enabled(p_org) then
    raise exception using errcode = 'P0001', message = 'FEATURE_NOT_ENABLED';
  end if;
  return sme_forecast_run_insert(p_org, p_run, 'event', null);
end;
$$;

revoke all on function sme_forecast_run_insert(uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function sme_record_forecast_run_worker(uuid, jsonb) from public, anon, authenticated;
grant execute on function sme_record_forecast_run_worker(uuid, jsonb) to service_role;
revoke all on function sme_save_scheduled_item(uuid, uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_archive_scheduled_item(uuid, uuid, uuid, text) from public, anon;
revoke all on function sme_save_scenario(uuid, uuid, text, jsonb, uuid, text) from public, anon;
revoke all on function sme_archive_scenario(uuid, uuid, uuid, text) from public, anon;
revoke all on function sme_set_forecast_settings(uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_record_forecast_run(uuid, jsonb) from public, anon;
grant execute on function sme_save_scheduled_item(uuid, uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_archive_scheduled_item(uuid, uuid, uuid, text) to authenticated;
grant execute on function sme_save_scenario(uuid, uuid, text, jsonb, uuid, text) to authenticated;
grant execute on function sme_archive_scenario(uuid, uuid, uuid, text) to authenticated;
grant execute on function sme_set_forecast_settings(uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_record_forecast_run(uuid, jsonb) to authenticated;
