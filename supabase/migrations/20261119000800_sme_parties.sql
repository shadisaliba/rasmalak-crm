-- ============================================================
-- SME CUSTOMERS AND SUPPLIERS (W3a-01)
-- ============================================================
-- CRM companies and contacts are the party master. Official identifiers sit in their own table;
-- their values can be read only through sme_reveal_identifier, which audits every reveal.

alter table crm_companies add column party_roles text[] not null default '{}'
  check (party_roles <@ array['customer', 'supplier']::text[]);
alter table crm_contacts add column party_roles text[] not null default '{}'
  check (party_roles <@ array['customer', 'supplier']::text[]);
create index crm_companies_party_roles_idx on crm_companies using gin (party_roles);
create index crm_contacts_party_roles_idx on crm_contacts using gin (party_roles);

create table sme_party_identifiers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  company_id uuid references crm_companies(id) on delete cascade,
  contact_id uuid references crm_contacts(id) on delete cascade,
  kind text not null check (kind in ('tax_number', 'national_establishment_number', 'commercial_registration', 'national_id')),
  value text not null check (length(value) between 1 and 64),
  last4 text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((company_id is null) <> (contact_id is null)),
  unique nulls not distinct (org_id, company_id, contact_id, kind)
);

alter table sme_party_identifiers enable row level security;
create policy sme_party_identifiers_select on sme_party_identifiers for select to authenticated
  using (sme_has_perm(org_id, 'sme.parties.identifiers'));
-- The value column is not selectable at all; lists and exports can only ever see last4.
revoke all on sme_party_identifiers from anon, authenticated;
grant select (id, org_id, company_id, contact_id, kind, last4, created_by, created_at) on sme_party_identifiers to authenticated;

-- ── Finance roles work with parties without other CRM rights ─

create or replace function crm_finance_role_permissions(p_role text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'contacts.read', true, 'contacts.write', p_role = 'bookkeeper', 'contacts.delete', false,
    'companies.read', true, 'companies.write', p_role = 'bookkeeper', 'companies.delete', false,
    'deals.read', false, 'deals.write', false, 'deals.delete', false,
    'tasks.read', p_role = 'bookkeeper', 'tasks.write', p_role = 'bookkeeper', 'tasks.delete', false,
    'pipeline.configure', false, 'team.manage', false, 'team.invite', false,
    'reports.view', true, 'reports.export', true, 'settings.manage', false,
    'import.execute', false, 'audit.view', false, 'fields.manage', false);
$$;

update org_roles
   set permissions = permissions || jsonb_build_object('contacts.write', true, 'companies.write', true)
 where name = 'bookkeeper' and is_system;

-- ── Identifiers ─────────────────────────────────────────────

create or replace function sme_set_party_identifier(p_org uuid, p_party jsonb, p_kind text, p_value text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The value is not part of the stored request hash input in clear: only its digest is.
  v_input jsonb := jsonb_build_object('party', p_party, 'kind', p_kind, 'value_sha256', encode(extensions.digest(coalesce(p_value, ''), 'sha256'), 'hex'));
  v_replay jsonb;
  v_company uuid := sme_json_uuid(p_party, 'company_id');
  v_contact uuid := sme_json_uuid(p_party, 'contact_id');
  v_value text := upper(regexp_replace(translate(coalesce(p_value, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\s+', '', 'g'));
  v_before sme_party_identifiers;
  v_row sme_party_identifiers;
begin
  perform sme_require(p_org, 'sme.parties.identifiers');
  v_replay := sme_idem_begin(p_org, p_idem, 'party.identifier.set', v_input);
  if v_replay is not null then return v_replay; end if;

  if (v_company is null) = (v_contact is null) then
    perform sme_fail('VALIDATION_FAILED', '{"field":"party","reason":"exactly_one"}');
  end if;
  if v_company is not null and not exists (select 1 from crm_companies where id = v_company and org_id = p_org) then
    perform sme_fail('NOT_FOUND', '{"entity":"company"}');
  end if;
  if v_contact is not null and not exists (select 1 from crm_contacts where id = v_contact and org_id = p_org) then
    perform sme_fail('NOT_FOUND', '{"entity":"contact"}');
  end if;
  if p_kind is null or p_kind not in ('tax_number', 'national_establishment_number', 'commercial_registration', 'national_id') then
    perform sme_fail('VALIDATION_FAILED', '{"field":"kind"}');
  end if;
  if v_value !~ '^[A-Z0-9/-]{1,64}$' then
    perform sme_fail('VALIDATION_FAILED', '{"field":"value","reason":"format"}');
  end if;

  select * into v_before from sme_party_identifiers
  where org_id = p_org and company_id is not distinct from v_company and contact_id is not distinct from v_contact and kind = p_kind
  for update;
  if found then
    delete from sme_party_identifiers where id = v_before.id;
  end if;
  insert into sme_party_identifiers (org_id, company_id, contact_id, kind, value, last4, created_by)
  values (p_org, v_company, v_contact, p_kind, v_value, right(v_value, 4), auth.uid())
  returning * into v_row;

  -- Audit holds hashes of the rows and the last four characters, never the value itself.
  perform sme_audit(p_org, 'party.identifier.set', 'party_identifier', v_row.id,
    case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_row),
    jsonb_build_object('kind', p_kind, 'last4', v_row.last4, 'company_id', v_company, 'contact_id', v_contact), p_correlation_id);
  return sme_idem_finish(p_org, p_idem, 'party.identifier.set', v_input, jsonb_build_object('id', v_row.id, 'last4', v_row.last4));
end;
$$;

create or replace function sme_remove_party_identifier(p_org uuid, p_id uuid, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('id', p_id);
  v_replay jsonb;
  v_row sme_party_identifiers;
begin
  perform sme_require(p_org, 'sme.parties.identifiers');
  v_replay := sme_idem_begin(p_org, p_idem, 'party.identifier.remove', v_input);
  if v_replay is not null then return v_replay; end if;
  delete from sme_party_identifiers where id = p_id and org_id = p_org returning * into v_row;
  if v_row.id is null then perform sme_fail('NOT_FOUND', '{"entity":"party_identifier"}'); end if;
  perform sme_audit(p_org, 'party.identifier.removed', 'party_identifier', p_id, to_jsonb(v_row), null,
    jsonb_build_object('kind', v_row.kind, 'last4', v_row.last4), p_correlation_id);
  return sme_idem_finish(p_org, p_idem, 'party.identifier.remove', v_input, jsonb_build_object('id', p_id));
end;
$$;

-- Every reveal is audited, so who saw which identifier and when is always known.
create or replace function sme_reveal_identifier(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row sme_party_identifiers;
begin
  select * into v_row from sme_party_identifiers where id = p_id;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"party_identifier"}'); end if;
  perform sme_require(v_row.org_id, 'sme.parties.identifiers');
  perform sme_audit(v_row.org_id, 'party.identifier.revealed', 'party_identifier', v_row.id, null, null,
    jsonb_build_object('kind', v_row.kind, 'last4', v_row.last4), null);
  return v_row.value;
end;
$$;

revoke all on function sme_set_party_identifier(uuid, jsonb, text, text, uuid, text) from public, anon;
revoke all on function sme_remove_party_identifier(uuid, uuid, uuid, text) from public, anon;
revoke all on function sme_reveal_identifier(uuid) from public, anon;
grant execute on function sme_set_party_identifier(uuid, jsonb, text, text, uuid, text) to authenticated;
grant execute on function sme_remove_party_identifier(uuid, uuid, uuid, text) to authenticated;
grant execute on function sme_reveal_identifier(uuid) to authenticated;
