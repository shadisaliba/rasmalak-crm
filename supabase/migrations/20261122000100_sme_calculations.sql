-- ============================================================
-- SME CALCULATION RECORDS (W3a-05, blueprint §8, CAL-01 to CAL-04)
-- ============================================================
-- Calculators run in one TypeScript service (src/sme/calc). Every successful run is recorded with
-- its calculator version, inputs, which inputs were prefilled or overridden, the output, the
-- trace and the assumptions. Records are immutable: a re-run is a new record. A saved record is a
-- named scenario (CAL-04).

create table sme_calculation_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  calculator_code text not null check (calculator_code ~ '^[a-z][a-z_]{1,39}$'),
  calculator_version text not null check (calculator_version ~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$'),
  as_of date not null,
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object'),
  prefill_refs jsonb not null default '[]' check (jsonb_typeof(prefill_refs) = 'array'),
  overrides jsonb not null default '[]' check (jsonb_typeof(overrides) = 'array'),
  output jsonb not null check (jsonb_typeof(output) = 'object'),
  trace jsonb not null default '[]' check (jsonb_typeof(trace) = 'array'),
  assumptions jsonb not null default '[]' check (jsonb_typeof(assumptions) = 'array'),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  rule_version_ids uuid[] not null default '{}',
  name text check (name is null or length(name) between 1 and 120),
  is_saved boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (not is_saved or name is not null)
);

create index sme_calculation_records_saved_idx on sme_calculation_records (org_id, created_at desc) where is_saved;
create index sme_calculation_records_code_idx on sme_calculation_records (org_id, calculator_code, created_at desc);

alter table sme_calculation_records enable row level security;
create policy sme_calculation_records_select on sme_calculation_records for select to authenticated
  using (sme_has_perm(org_id, 'sme.calc.run'));
revoke all on sme_calculation_records from anon, authenticated;
grant select on sme_calculation_records to authenticated;

create or replace function sme_calculation_records_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = 'LEDGER_IMMUTABLE',
    detail = '{"table":"sme_calculation_records"}';
end;
$$;

create trigger sme_calculation_records_no_update_delete
  before update or delete on sme_calculation_records
  for each row execute function sme_calculation_records_immutable();

-- ── Context for a run ───────────────────────────────────────
-- The date and the regulated parameters a calculator may use. Parameters come only from
-- published, effective-dated rule versions (R16); the rule register arrives with W3b-04, so
-- until then the list is empty and regulated calculators fail closed with RULE_NOT_VERIFIED.

create or replace function sme_calc_context(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform sme_require(p_org, 'sme.calc.run');
  return jsonb_build_object(
    'as_of', (now() at time zone 'Asia/Amman')::date,
    'params', '[]'::jsonb
  );
end;
$$;

-- ── Record a run ────────────────────────────────────────────

create or replace function sme_record_calculation(p_org uuid, p_record jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_saved boolean;
  v_name text;
  v_rule_ids uuid[];
  v_row sme_calculation_records;
  v_response jsonb;
begin
  perform sme_require(p_org, 'sme.calc.run');
  if jsonb_typeof(p_record) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  if p_record ? 'is_saved' and jsonb_typeof(p_record -> 'is_saved') <> 'boolean' then
    perform sme_fail('VALIDATION_FAILED', '{"field":"is_saved"}');
  end if;
  v_saved := coalesce((p_record ->> 'is_saved')::boolean, false);
  if v_saved then perform sme_require(p_org, 'sme.calc.save'); end if;

  v_replay := sme_idem_begin(p_org, p_idem, 'calc.record', p_record);
  if v_replay is not null then return v_replay; end if;

  v_name := sme_json_text(p_record, 'name', 120, v_saved);
  if jsonb_typeof(p_record -> 'rule_version_ids') = 'array' then
    begin
      select coalesce(array_agg(value::uuid), '{}') into v_rule_ids from jsonb_array_elements_text(p_record -> 'rule_version_ids');
    exception when invalid_text_representation then
      perform sme_fail('VALIDATION_FAILED', '{"field":"rule_version_ids"}');
    end;
  else
    v_rule_ids := '{}';
  end if;

  begin
    insert into sme_calculation_records (
      org_id, calculator_code, calculator_version, as_of, input_snapshot, prefill_refs, overrides,
      output, trace, assumptions, warnings, rule_version_ids, name, is_saved, created_by)
    values (
      p_org,
      sme_json_text(p_record, 'calculator_code', 40, true),
      sme_json_text(p_record, 'calculator_version', 20, true),
      sme_json_date(p_record, 'as_of'),
      p_record -> 'input',
      coalesce(p_record -> 'prefill_refs', '[]'),
      coalesce(p_record -> 'overrides', '[]'),
      p_record -> 'output',
      coalesce(p_record -> 'trace', '[]'),
      coalesce(p_record -> 'assumptions', '[]'),
      coalesce(p_record -> 'warnings', '[]'),
      v_rule_ids,
      v_name,
      v_saved,
      auth.uid())
    returning * into v_row;
  exception
    when check_violation or not_null_violation then
      perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid_record'));
  end;

  if v_saved then
    perform sme_audit(p_org, 'calc.saved', 'calculation', v_row.id, null, null,
      jsonb_build_object('calculator', v_row.calculator_code, 'version', v_row.calculator_version, 'name', v_row.name), p_correlation_id);
  end if;

  v_response := jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at, 'is_saved', v_row.is_saved, 'name', v_row.name);
  return sme_idem_finish(p_org, p_idem, 'calc.record', p_record, v_response);
end;
$$;

revoke all on function sme_calc_context(uuid) from public, anon;
revoke all on function sme_record_calculation(uuid, jsonb, uuid, text) from public, anon;
grant execute on function sme_calc_context(uuid) to authenticated;
grant execute on function sme_record_calculation(uuid, jsonb, uuid, text) to authenticated;
