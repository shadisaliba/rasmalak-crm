-- ============================================================
-- SME PROFILE (W2-03): business profile, regulatory facts, consent, missing-information actions
-- ============================================================
-- Facts are what the owner tells us. Nothing here infers a fact from revenue or transactions
-- (blueprint §4), and nothing states a compliance conclusion.

-- ── Reference data ──────────────────────────────────────────

create table sme_lookup_values (
  kind          text not null check (kind in ('legal_form', 'governorate', 'municipality', 'premises_type', 'sector')),
  code          text not null,
  name_en       text not null,
  name_ar       text not null,
  active        boolean not null default true,
  sort          int not null default 0,
  -- Jordan-specific lists stay needs_review until the Jordan reviewer approves them (gate G2).
  review_state  text not null check (review_state in ('needs_review', 'approved')),
  primary key (kind, code)
);
alter table sme_lookup_values enable row level security;
create policy sme_lookup_values_select on sme_lookup_values for select to authenticated using (true);

insert into sme_lookup_values (kind, code, name_en, name_ar, sort, review_state) values
  ('premises_type', 'home', 'Home-based', 'من المنزل', 1, 'approved'),
  ('premises_type', 'office', 'Office', 'مكتب', 2, 'approved'),
  ('premises_type', 'retail', 'Shop or showroom', 'محل أو معرض', 3, 'approved'),
  ('premises_type', 'online_only', 'Online only', 'عبر الإنترنت فقط', 4, 'approved'),
  ('premises_type', 'other', 'Other', 'أخرى', 9, 'approved'),

  ('sector', 'professional_services', 'Professional services', 'خدمات مهنية', 1, 'approved'),
  ('sector', 'trading', 'Trading and retail', 'تجارة وبيع بالتجزئة', 2, 'approved'),
  ('sector', 'food_beverage', 'Food and beverage', 'أغذية ومشروبات', 3, 'approved'),
  ('sector', 'construction', 'Construction and contracting', 'إنشاءات ومقاولات', 4, 'approved'),
  ('sector', 'manufacturing', 'Manufacturing', 'تصنيع', 5, 'approved'),
  ('sector', 'technology', 'Technology', 'تكنولوجيا', 6, 'approved'),
  ('sector', 'transport_logistics', 'Transport and logistics', 'نقل وخدمات لوجستية', 7, 'approved'),
  ('sector', 'health', 'Health', 'صحة', 8, 'approved'),
  ('sector', 'education', 'Education and training', 'تعليم وتدريب', 9, 'approved'),
  ('sector', 'tourism_hospitality', 'Tourism and hospitality', 'سياحة وضيافة', 10, 'approved'),
  ('sector', 'agriculture', 'Agriculture', 'زراعة', 11, 'approved'),
  ('sector', 'other', 'Other', 'أخرى', 99, 'approved'),

  ('legal_form', 'sole_establishment', 'Sole establishment', 'مؤسسة فردية', 1, 'needs_review'),
  ('legal_form', 'freelancer', 'Freelancer (no registered entity)', 'عامل مستقل (دون كيان مسجّل)', 2, 'needs_review'),
  ('legal_form', 'general_partnership', 'General partnership', 'شركة تضامن', 3, 'needs_review'),
  ('legal_form', 'limited_partnership', 'Limited partnership', 'شركة توصية بسيطة', 4, 'needs_review'),
  ('legal_form', 'llc', 'Limited liability company', 'شركة ذات مسؤولية محدودة', 5, 'needs_review'),
  ('legal_form', 'private_shareholding', 'Private shareholding company', 'شركة مساهمة خاصة', 6, 'needs_review'),
  ('legal_form', 'other', 'Other', 'أخرى', 99, 'needs_review'),

  ('governorate', 'amman', 'Amman', 'العاصمة (عمّان)', 1, 'needs_review'),
  ('governorate', 'irbid', 'Irbid', 'إربد', 2, 'needs_review'),
  ('governorate', 'zarqa', 'Zarqa', 'الزرقاء', 3, 'needs_review'),
  ('governorate', 'balqa', 'Balqa', 'البلقاء', 4, 'needs_review'),
  ('governorate', 'madaba', 'Madaba', 'مادبا', 5, 'needs_review'),
  ('governorate', 'mafraq', 'Mafraq', 'المفرق', 6, 'needs_review'),
  ('governorate', 'jerash', 'Jerash', 'جرش', 7, 'needs_review'),
  ('governorate', 'ajloun', 'Ajloun', 'عجلون', 8, 'needs_review'),
  ('governorate', 'karak', 'Karak', 'الكرك', 9, 'needs_review'),
  ('governorate', 'tafilah', 'Tafilah', 'الطفيلة', 10, 'needs_review'),
  ('governorate', 'maan', 'Ma''an', 'معان', 11, 'needs_review'),
  ('governorate', 'aqaba', 'Aqaba', 'العقبة', 12, 'needs_review'),

  ('municipality', 'greater_amman', 'Greater Amman Municipality', 'أمانة عمّان الكبرى', 1, 'needs_review'),
  ('municipality', 'other', 'Another municipality', 'بلدية أخرى', 99, 'needs_review');

create table sme_currencies (
  code         char(3) primary key,
  minor_units  smallint not null check (minor_units between 0 and 4),
  name_en      text not null,
  name_ar      text not null
);
alter table sme_currencies enable row level security;
create policy sme_currencies_select on sme_currencies for select to authenticated using (true);

-- Mirrors CURRENCY_TABLE in src/sme/money/currencies.ts; a unit test keeps them identical.
insert into sme_currencies (code, minor_units, name_en, name_ar) values
  ('JOD', 3, 'Jordanian dinar', 'دينار أردني'),
  ('KWD', 3, 'Kuwaiti dinar', 'دينار كويتي'),
  ('BHD', 3, 'Bahraini dinar', 'دينار بحريني'),
  ('OMR', 3, 'Omani rial', 'ريال عماني'),
  ('IQD', 3, 'Iraqi dinar', 'دينار عراقي'),
  ('TND', 3, 'Tunisian dinar', 'دينار تونسي'),
  ('LYD', 3, 'Libyan dinar', 'دينار ليبي'),
  ('USD', 2, 'US dollar', 'دولار أمريكي'),
  ('EUR', 2, 'Euro', 'يورو'),
  ('GBP', 2, 'Pound sterling', 'جنيه إسترليني'),
  ('SAR', 2, 'Saudi riyal', 'ريال سعودي'),
  ('AED', 2, 'UAE dirham', 'درهم إماراتي'),
  ('QAR', 2, 'Qatari riyal', 'ريال قطري'),
  ('EGP', 2, 'Egyptian pound', 'جنيه مصري');

-- ── Profile and facts ───────────────────────────────────────

create table sme_business_profiles (
  org_id                   uuid primary key references organizations(id) on delete restrict,
  country                  char(2) not null default 'JO' check (country = 'JO'),
  base_currency            char(3) not null default 'JOD' check (base_currency = 'JOD') references sme_currencies(code),
  legal_name               text,
  trade_name               text,
  trade_name_ar            text,
  legal_form               text,
  sector                   text,
  activity_code            text,
  activity_description     text,
  governorate              text,
  municipality             text,
  premises_type            text,
  fiscal_year_start_month  smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  week_start               smallint not null default 0 check (week_start between 0 and 6),  -- 0 = Sunday
  profile_version          int not null default 1,
  updated_by               uuid references auth.users(id),
  updated_at               timestamptz not null default now()
);
alter table sme_business_profiles enable row level security;
create policy sme_business_profiles_select on sme_business_profiles
  for select to authenticated using (sme_has_perm(org_id, 'sme.profile.read'));

create table sme_profile_facts (
  org_id        uuid not null references organizations(id) on delete restrict,
  fact_key      text not null,
  value         jsonb,
  status        text not null check (status in ('known', 'unknown', 'needs_confirmation')),
  source        text not null check (source in ('owner', 'document', 'import', 'system')),
  confirmed_by  uuid references auth.users(id),
  confirmed_at  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (org_id, fact_key)
);
alter table sme_profile_facts enable row level security;
create policy sme_profile_facts_select on sme_profile_facts
  for select to authenticated using (sme_has_perm(org_id, 'sme.profile.read'));

-- Mirrors src/sme/profile/factKeys.ts.
create or replace function sme_fact_keys()
returns text[]
language sql
immutable
as $$
  select array['legal.form', 'income_tax.registered', 'income_tax.number_known', 'sales_tax.registered',
               'jofotara.status', 'employees.count', 'ssc.registered', 'premises.licensed', 'activity.regulated'];
$$;

create or replace function sme_fact_value_valid(p_key text, p_value jsonb)
returns boolean
language sql
immutable
as $$
  select case p_key
    when 'legal.form' then jsonb_typeof(p_value) = 'string'
    when 'jofotara.status' then p_value #>> '{}' in ('unknown', 'not_registered', 'registered_unsure', 'registered_active')
    when 'employees.count' then jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric >= 0
                                and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
    else jsonb_typeof(p_value) = 'boolean'
  end;
$$;

-- ── Consent ─────────────────────────────────────────────────

create table user_consents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  org_id            uuid references organizations(id) on delete cascade,  -- null: account-level (terms, privacy notice)
  purpose           text not null check (purpose in ('terms', 'privacy_notice', 'bank_data_processing', 'document_processing', 'ai_processing')),
  document_version  text not null,
  granted_at        timestamptz not null default now(),
  revoked_at        timestamptz
);
create unique index user_consents_active_idx on user_consents (user_id, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), purpose)
  where revoked_at is null;
alter table user_consents enable row level security;
create policy user_consents_select on user_consents for select to authenticated using (user_id = auth.uid());

-- ── Actions (created here for profile.missing_fact; W3a-09 adds the other rules) ─

create table sme_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  rule_code text not null, rule_version text not null,
  dedupe_key text not null,
  subject_type text, subject_id uuid,
  severity text not null check (severity in ('info','warning','critical')),
  title_key text not null, body_key text not null, params jsonb not null default '{}',
  evidence jsonb not null default '[]',
  competency_tags text[] not null default '{}',
  status text not null default 'open' check (status in ('open','snoozed','resolved','dismissed')),
  snooze_until timestamptz, decided_by uuid, decided_at timestamptz, decision_reason text,
  crm_task_id uuid references crm_tasks(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
alter table sme_actions enable row level security;
create policy sme_actions_select on sme_actions
  for select to authenticated
  using (sme_has_perm(org_id, 'sme.profile.read') or sme_has_perm(org_id, 'sme.ledger.read'));

-- One open action per missing item; resolved automatically once the owner answers it.
create or replace function sme_sync_profile_actions(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile sme_business_profiles;
  v_missing text[] := '{}';
  k text;
begin
  select * into v_profile from sme_business_profiles where org_id = p_org;
  if v_profile.governorate is null then v_missing := array_append(v_missing, 'profile.governorate'); end if;
  if v_profile.municipality is null then v_missing := array_append(v_missing, 'profile.municipality'); end if;
  if v_profile.sector is null then v_missing := array_append(v_missing, 'profile.sector'); end if;
  if v_profile.premises_type is null then v_missing := array_append(v_missing, 'profile.premises_type'); end if;
  foreach k in array sme_fact_keys() loop
    if not exists (select 1 from sme_profile_facts where org_id = p_org and fact_key = k and status = 'known') then
      v_missing := array_append(v_missing, ('fact.' || k));
    end if;
  end loop;

  insert into sme_actions (org_id, rule_code, rule_version, dedupe_key, subject_type, severity, title_key, body_key, params)
  select p_org, 'profile.missing_fact', '1', 'profile.missing_fact:' || item, 'business_profile', 'info',
         'sme.action.profile_missing_fact.title', 'sme.action.profile_missing_fact.body', jsonb_build_object('item', item)
  from unnest(v_missing) item
  on conflict (org_id, dedupe_key) do update
     set status = 'open', decided_by = null, decided_at = null, decision_reason = null, updated_at = now()
   where sme_actions.status = 'resolved';

  update sme_actions
     set status = 'resolved', decided_at = now(), decision_reason = 'condition_cleared', updated_at = now()
   where org_id = p_org and rule_code = 'profile.missing_fact' and status in ('open', 'snoozed')
     and params ->> 'item' <> all (v_missing);
end;
$$;
revoke all on function sme_sync_profile_actions(uuid) from public, anon, authenticated;

-- ── Writes ──────────────────────────────────────────────────

create or replace function sme_lookup_valid(p_kind text, p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_code is null or exists (select 1 from sme_lookup_values where kind = p_kind and code = p_code and active);
$$;

create or replace function sme_update_profile(p_org uuid, p_patch jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed constant text[] := array['legal_name', 'trade_name', 'trade_name_ar', 'legal_form', 'sector', 'activity_code',
    'activity_description', 'governorate', 'municipality', 'premises_type', 'fiscal_year_start_month', 'week_start'];
  v_replay jsonb;
  v_before sme_business_profiles;
  v_after sme_business_profiles;
  v_changed text[];
  v_result jsonb;
  k text;
begin
  perform sme_require(p_org, 'sme.profile.manage');
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"patch"}';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not k = any (v_allowed) then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = jsonb_build_object('field', k)::text;
    end if;
  end loop;
  if (p_patch ? 'fiscal_year_start_month' and coalesce(p_patch ->> 'fiscal_year_start_month', '') !~ '^(1[0-2]|[1-9])$')
     or (p_patch ? 'week_start' and coalesce(p_patch ->> 'week_start', '') !~ '^[0-6]$') then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"invalid_value"}';
  end if;
  if not (sme_lookup_valid('legal_form', p_patch ->> 'legal_form') and sme_lookup_valid('sector', p_patch ->> 'sector')
          and sme_lookup_valid('governorate', p_patch ->> 'governorate') and sme_lookup_valid('municipality', p_patch ->> 'municipality')
          and sme_lookup_valid('premises_type', p_patch ->> 'premises_type')) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"unknown_lookup_value"}';
  end if;

  v_replay := sme_idem_begin(p_org, p_idem, 'profile.update', p_patch);
  if v_replay is not null then return v_replay; end if;

  insert into sme_business_profiles (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into v_before from sme_business_profiles where org_id = p_org for update;

  update sme_business_profiles p set
    legal_name = case when p_patch ? 'legal_name' then nullif(trim(p_patch ->> 'legal_name'), '') else p.legal_name end,
    trade_name = case when p_patch ? 'trade_name' then nullif(trim(p_patch ->> 'trade_name'), '') else p.trade_name end,
    trade_name_ar = case when p_patch ? 'trade_name_ar' then nullif(trim(p_patch ->> 'trade_name_ar'), '') else p.trade_name_ar end,
    legal_form = case when p_patch ? 'legal_form' then p_patch ->> 'legal_form' else p.legal_form end,
    sector = case when p_patch ? 'sector' then p_patch ->> 'sector' else p.sector end,
    activity_code = case when p_patch ? 'activity_code' then nullif(trim(p_patch ->> 'activity_code'), '') else p.activity_code end,
    activity_description = case when p_patch ? 'activity_description' then nullif(trim(p_patch ->> 'activity_description'), '') else p.activity_description end,
    governorate = case when p_patch ? 'governorate' then p_patch ->> 'governorate' else p.governorate end,
    municipality = case when p_patch ? 'municipality' then p_patch ->> 'municipality' else p.municipality end,
    premises_type = case when p_patch ? 'premises_type' then p_patch ->> 'premises_type' else p.premises_type end,
    fiscal_year_start_month = case when p_patch ? 'fiscal_year_start_month' then (p_patch ->> 'fiscal_year_start_month')::smallint else p.fiscal_year_start_month end,
    week_start = case when p_patch ? 'week_start' then (p_patch ->> 'week_start')::smallint else p.week_start end
  where org_id = p_org
  returning * into v_after;

  select coalesce(array_agg(key order by key), '{}') into v_changed
  from jsonb_each(to_jsonb(v_after)) a
  where key not in ('profile_version', 'updated_by', 'updated_at') and a.value is distinct from to_jsonb(v_before) -> key;

  if array_length(v_changed, 1) > 0 then
    update sme_business_profiles set profile_version = profile_version + 1, updated_by = auth.uid(), updated_at = now()
     where org_id = p_org returning * into v_after;
    -- Compliance rules read legal form as a fact, so keep the two in step.
    if 'legal_form' = any (v_changed) then
      insert into sme_profile_facts (org_id, fact_key, value, status, source, confirmed_by, confirmed_at)
      values (p_org, 'legal.form', to_jsonb(v_after.legal_form),
              case when v_after.legal_form is null then 'needs_confirmation' else 'known' end, 'owner',
              case when v_after.legal_form is null then null else auth.uid() end,
              case when v_after.legal_form is null then null else now() end)
      on conflict (org_id, fact_key) do update set value = excluded.value, status = excluded.status, source = 'owner',
        confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at, updated_at = now();
    end if;
    perform sme_audit(p_org, 'profile.updated', 'business_profile', null, to_jsonb(v_before), to_jsonb(v_after),
      jsonb_build_object('changed', to_jsonb(v_changed)), p_correlation_id);
    perform sme_emit(p_org, 'BusinessProfileUpdated',
      jsonb_build_object('changed', to_jsonb(v_changed), 'profileVersion', v_after.profile_version),
      'profile:' || p_org || ':' || v_after.profile_version);
  end if;
  perform sme_sync_profile_actions(p_org);

  v_result := jsonb_build_object('profile_version', v_after.profile_version, 'changed', to_jsonb(v_changed));
  return sme_idem_finish(p_org, p_idem, 'profile.update', p_patch, v_result);
end;
$$;

create or replace function sme_set_fact(p_org uuid, p_fact_key text, p_value jsonb, p_status text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('key', p_fact_key, 'value', p_value, 'status', p_status);
  v_replay jsonb;
  v_before sme_profile_facts;
  v_after sme_profile_facts;
  v_version int;
  v_result jsonb;
begin
  perform sme_require(p_org, 'sme.profile.manage');
  if not p_fact_key = any (sme_fact_keys()) or p_fact_key = 'legal.form' then
    -- Legal form is set through the profile so the two never disagree.
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"fact_key"}';
  end if;
  if p_status not in ('known', 'unknown', 'needs_confirmation') then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"status"}';
  end if;
  if p_status = 'known' and (p_value is null or not sme_fact_value_valid(p_fact_key, p_value)) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"value"}';
  end if;

  v_replay := sme_idem_begin(p_org, p_idem, 'profile.fact', v_input);
  if v_replay is not null then return v_replay; end if;

  insert into sme_business_profiles (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into v_before from sme_profile_facts where org_id = p_org and fact_key = p_fact_key for update;

  insert into sme_profile_facts (org_id, fact_key, value, status, source, confirmed_by, confirmed_at)
  values (p_org, p_fact_key, case when p_status = 'known' then p_value end, p_status, 'owner',
          case when p_status = 'known' then auth.uid() end, case when p_status = 'known' then now() end)
  on conflict (org_id, fact_key) do update
     set value = excluded.value, status = excluded.status, source = 'owner',
         confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at, updated_at = now()
  returning * into v_after;

  update sme_business_profiles set profile_version = profile_version + 1, updated_by = auth.uid(), updated_at = now()
   where org_id = p_org returning profile_version into v_version;

  perform sme_audit(p_org, 'profile.fact_set', 'profile_fact', null,
    case when v_before.fact_key is null then null else to_jsonb(v_before) end, to_jsonb(v_after),
    jsonb_build_object('fact_key', p_fact_key, 'status', p_status), p_correlation_id);
  perform sme_emit(p_org, 'BusinessProfileUpdated',
    jsonb_build_object('changed', jsonb_build_array('fact:' || p_fact_key), 'profileVersion', v_version),
    'profile:' || p_org || ':' || v_version);
  perform sme_sync_profile_actions(p_org);

  v_result := jsonb_build_object('profile_version', v_version, 'fact_key', p_fact_key, 'status', p_status);
  return sme_idem_finish(p_org, p_idem, 'profile.fact', v_input, v_result);
end;
$$;

-- Consent is personal: a user records their own. Grants are idempotent by construction (one
-- active row per purpose); a new document version replaces the previous grant.
create or replace function sme_record_consent(p_org uuid, p_purpose text, p_document_version text, p_grant boolean, p_correlation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing user_consents;
  v_row user_consents;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;
  if p_org is not null and not is_org_member(p_org) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  if p_purpose not in ('terms', 'privacy_notice', 'bank_data_processing', 'document_processing', 'ai_processing')
     or coalesce(trim(p_document_version), '') = '' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED';
  end if;

  select * into v_existing from user_consents
   where user_id = auth.uid() and org_id is not distinct from p_org and purpose = p_purpose and revoked_at is null
   for update;

  if p_grant then
    if v_existing.id is not null and v_existing.document_version = p_document_version then
      return to_jsonb(v_existing);
    end if;
    if v_existing.id is not null then
      update user_consents set revoked_at = now() where id = v_existing.id;
    end if;
    insert into user_consents (user_id, org_id, purpose, document_version)
    values (auth.uid(), p_org, p_purpose, p_document_version) returning * into v_row;
    perform sme_audit(p_org, 'consent.granted', 'user_consent', v_row.id, null, to_jsonb(v_row),
      jsonb_build_object('purpose', p_purpose, 'document_version', p_document_version), p_correlation_id);
  else
    if v_existing.id is null then
      return jsonb_build_object('purpose', p_purpose, 'active', false);
    end if;
    update user_consents set revoked_at = now() where id = v_existing.id returning * into v_row;
    perform sme_audit(p_org, 'consent.revoked', 'user_consent', v_row.id, to_jsonb(v_existing), to_jsonb(v_row),
      jsonb_build_object('purpose', p_purpose), p_correlation_id);
  end if;
  return to_jsonb(v_row);
end;
$$;

-- Used by later prompts (assistant, document extraction) to honour revocation on the next request.
create or replace function sme_has_consent(p_org uuid, p_purpose text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from user_consents where user_id = auth.uid() and org_id is not distinct from p_org
                 and purpose = p_purpose and revoked_at is null);
$$;

revoke all on function sme_update_profile(uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_set_fact(uuid, text, jsonb, text, uuid, text) from public, anon;
revoke all on function sme_record_consent(uuid, text, text, boolean, uuid) from public, anon;
grant execute on function sme_update_profile(uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_set_fact(uuid, text, jsonb, text, uuid, text) to authenticated;
grant execute on function sme_record_consent(uuid, text, text, boolean, uuid) to authenticated;
