-- ============================================================
-- SME ACCESS (W2-02): roles, permissions, module scopes, feature gate
-- ============================================================

-- ── Country codes ───────────────────────────────────────────
-- Organization setup stored country names ('jordan'); SME gating and profiles use ISO codes.
update organizations
   set country = case lower(trim(country))
     when 'jordan' then 'JO' when 'uae' then 'AE' when 'ksa' then 'SA' when 'egypt' then 'EG'
     when 'iraq' then 'IQ' when 'kuwait' then 'KW' when 'qatar' then 'QA' when 'bahrain' then 'BH'
     when 'oman' then 'OM' else country end
 where country is not null;

-- ── Permission vocabulary ───────────────────────────────────

create or replace function sme_permission_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'sme.profile.read', 'sme.profile.manage', 'sme.ledger.read', 'sme.ledger.post', 'sme.ledger.reverse',
    'sme.imports.execute', 'sme.parties.read', 'sme.parties.identifiers', 'sme.receivables.read',
    'sme.receivables.write', 'sme.payables.read', 'sme.payables.write', 'sme.forecast.read',
    'sme.forecast.scenario', 'sme.reports.export', 'sme.calc.run', 'sme.calc.save', 'sme.assistant.use',
    'sme.learn.use', 'sme.compliance.read', 'sme.compliance.confirm', 'sme.audit.read', 'sme.access.manage'
  ];
$$;

-- Module names are the second segment of the permission keys (sme.<module>.<action>).
create or replace function sme_module_names()
returns text[]
language sql
immutable
as $$
  select array_agg(distinct split_part(k, '.', 2) order by split_part(k, '.', 2)) from unnest(sme_permission_keys()) k;
$$;

-- Every SME key explicitly, true where the role holds it by default.
create or replace function sme_role_permissions(p_role text)
returns jsonb
language sql
immutable
as $$
  select jsonb_object_agg(k, k = any (
    case p_role
      when 'owner' then sme_permission_keys()
      when 'admin' then sme_permission_keys()
      when 'bookkeeper' then array[
        'sme.profile.read', 'sme.ledger.read', 'sme.ledger.post', 'sme.ledger.reverse', 'sme.imports.execute',
        'sme.parties.read', 'sme.receivables.read', 'sme.receivables.write', 'sme.payables.read',
        'sme.payables.write', 'sme.forecast.read', 'sme.forecast.scenario', 'sme.reports.export',
        'sme.calc.run', 'sme.calc.save', 'sme.assistant.use', 'sme.learn.use', 'sme.compliance.read']
      when 'adviser' then array[
        'sme.profile.read', 'sme.ledger.read', 'sme.parties.read', 'sme.receivables.read', 'sme.payables.read',
        'sme.forecast.read', 'sme.reports.export', 'sme.calc.run', 'sme.assistant.use', 'sme.learn.use',
        'sme.compliance.read']
      else array[]::text[]
    end))
  from unnest(sme_permission_keys()) k;
$$;

-- CRM permissions for the two finance roles: they read the customer and supplier records they
-- work with (W3a-01 adds write access for bookkeepers) and nothing else in the CRM.
create or replace function crm_finance_role_permissions(p_role text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'contacts.read', true, 'contacts.write', false, 'contacts.delete', false,
    'companies.read', true, 'companies.write', false, 'companies.delete', false,
    'deals.read', false, 'deals.write', false, 'deals.delete', false,
    'tasks.read', p_role = 'bookkeeper', 'tasks.write', p_role = 'bookkeeper', 'tasks.delete', false,
    'pipeline.configure', false, 'team.manage', false, 'team.invite', false,
    'reports.view', true, 'reports.export', true, 'settings.manage', false,
    'import.execute', false, 'audit.view', false, 'fields.manage', false);
$$;

create or replace function sme_apply_role_defaults(p_org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update org_roles
     set permissions = permissions || sme_role_permissions(name)
   where org_id = p_org and name in ('owner', 'admin', 'manager', 'sales_rep', 'viewer');
  insert into org_roles (org_id, name, name_ar, permissions, is_system) values
    (p_org, 'bookkeeper', 'محاسب', crm_finance_role_permissions('bookkeeper') || sme_role_permissions('bookkeeper'), true),
    (p_org, 'adviser', 'مستشار', crm_finance_role_permissions('adviser') || sme_role_permissions('adviser'), true)
  on conflict (org_id, name) do nothing;
$$;
revoke all on function sme_apply_role_defaults(uuid) from public, anon, authenticated;

create or replace function sme_roles_on_org_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform sme_apply_role_defaults(new.id);
  return new;
end;
$$;

-- Fires after on_org_created_roles (triggers run in name order), so the system roles exist.
create trigger on_org_created_sme_roles
  after insert on organizations
  for each row execute function sme_roles_on_org_created();

select sme_apply_role_defaults(id) from organizations;

-- ── Membership columns ──────────────────────────────────────

alter table org_members
  add column allowed_modules text[],
  add column approved_by uuid references auth.users(id),
  add column granted_at timestamptz not null default now(),
  add column revoked_at timestamptz,
  add column revoked_by uuid references auth.users(id);

alter table org_members add constraint org_members_allowed_modules_known check (
  allowed_modules is null or allowed_modules <@ array[
    'access', 'assistant', 'audit', 'calc', 'compliance', 'forecast', 'imports', 'learn', 'ledger',
    'parties', 'payables', 'profile', 'receivables', 'reports']
);

-- Access grants must be audited, so their columns (and per-member permission overrides) change
-- only through the SECURITY DEFINER functions below. Role and is_active stay directly
-- updatable under the W0-04 rank policies, for the CRM team screen.
revoke update on org_members from authenticated;
grant update (role, display_name, display_name_ar, is_active) on org_members to authenticated;

alter table org_invitations add column allowed_modules text[];

-- ── Checks used by every SME table and RPC ──────────────────

create or replace function sme_has_perm(p_org uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from org_members m
    left join org_roles r on r.org_id = m.org_id and r.name = m.role
    where m.org_id = p_org and m.user_id = auth.uid()
      and m.is_active and m.revoked_at is null
      and (
        m.role = 'owner'
        or (
          coalesce((m.permissions ->> p_perm)::boolean, (r.permissions ->> p_perm)::boolean, false)
          and (m.allowed_modules is null or split_part(p_perm, '.', 2) = any (m.allowed_modules))
        )
      )
  );
$$;

-- The caller's effective CRM and SME permissions, as the UI should see them. Module scopes
-- apply to sme.* keys only.
create or replace function sme_my_permissions(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_member_perms jsonb;
  v_role_perms jsonb;
  v_modules text[];
  v_result jsonb := '{}'::jsonb;
  k text;
begin
  select m.role, coalesce(m.permissions, '{}'), coalesce(r.permissions, '{}'), m.allowed_modules
    into v_role, v_member_perms, v_role_perms, v_modules
  from org_members m
  left join org_roles r on r.org_id = m.org_id and r.name = m.role
  where m.org_id = p_org and m.user_id = auth.uid() and m.is_active and m.revoked_at is null;
  if v_role is null then
    return v_result;
  end if;

  for k in
    select jsonb_object_keys(v_role_perms) union select jsonb_object_keys(v_member_perms) union select unnest(sme_permission_keys())
  loop
    v_result := v_result || jsonb_build_object(k,
      v_role = 'owner' or (
        coalesce((v_member_perms ->> k)::boolean, (v_role_perms ->> k)::boolean, false)
        and (k not like 'sme.%' or v_modules is null or split_part(k, '.', 2) = any (v_modules))
      ));
  end loop;
  return v_result;
end;
$$;

-- Keep in step with PLAN_FEATURE_MAP.sme_suite in src/types/crm.ts.
create or replace function sme_enabled(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organizations o
    join subscriptions s on s.org_id = o.id
    where o.id = p_org
      and o.country = 'JO'
      and s.plan in ('organization', 'enterprise', 'custom')
      and (s.status in ('active', 'trialing') or (s.status = 'past_due' and s.grace_period_ends_at > now()))
  );
$$;

-- Common guard for SME RPCs: authenticated, feature enabled, permission held.
create or replace function sme_require(p_org uuid, p_perm text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;
  if not sme_enabled(p_org) then
    raise exception using errcode = 'P0001', message = 'FEATURE_NOT_ENABLED';
  end if;
  if not sme_has_perm(p_org, p_perm) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED', detail = jsonb_build_object('permission', p_perm)::text;
  end if;
end;
$$;

-- ── Audit read access ───────────────────────────────────────

create policy sme_audit_events_select on sme_audit_events
  for select to authenticated
  using (org_id is not null and sme_has_perm(org_id, 'sme.audit.read'));

-- ── Managing access ─────────────────────────────────────────

create or replace function sme_check_member_target(p_org uuid, p_user uuid)
returns org_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member org_members;
begin
  select * into v_member from org_members where org_id = p_org and user_id = p_user for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if p_user = auth.uid() then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"self"}';
  end if;
  -- Same rank rules as the members_update policy (W0-04).
  if (v_member.role = 'owner' and get_org_role(p_org) <> 'owner')
     or org_role_rank(v_member.role) > org_role_rank(get_org_role(p_org)) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED', detail = '{"reason":"rank"}';
  end if;
  return v_member;
end;
$$;
revoke all on function sme_check_member_target(uuid, uuid) from public, anon, authenticated;

-- Revocation works even when SME is not enabled: removing access must never be blocked.
create or replace function sme_revoke_member(p_org uuid, p_user uuid, p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('user', p_user, 'reason', p_reason);
  v_replay jsonb;
  v_member org_members;
  v_after org_members;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;
  if not sme_has_perm(p_org, 'sme.access.manage') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"reason"}';
  end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'access.member.revoke', v_input);
  if v_replay is not null then return v_replay; end if;

  v_member := sme_check_member_target(p_org, p_user);
  if v_member.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'ALREADY_REVERSED';
  end if;

  update org_members
     set revoked_at = now(), revoked_by = auth.uid(), is_active = false
   where id = v_member.id
  returning * into v_after;

  perform sme_audit(p_org, 'access.member.revoked', 'org_member', v_member.id,
    to_jsonb(v_member), to_jsonb(v_after), jsonb_build_object('user_id', p_user), p_correlation_id, p_reason);
  perform sme_emit(p_org, 'RoleRevoked', jsonb_build_object('userId', p_user), 'revoked:' || v_member.id || ':' || v_after.revoked_at);

  v_result := jsonb_build_object('member_id', v_member.id, 'revoked_at', v_after.revoked_at);
  return sme_idem_finish(p_org, p_idem, 'access.member.revoke', v_input, v_result);
end;
$$;

-- null restores the role's default modules.
create or replace function sme_set_member_modules(p_org uuid, p_user uuid, p_modules text[], p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('user', p_user, 'modules', to_jsonb(p_modules), 'reason', p_reason);
  v_replay jsonb;
  v_member org_members;
  v_after org_members;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;
  if not sme_has_perm(p_org, 'sme.access.manage') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  if p_modules is not null and not (p_modules <@ sme_module_names()) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"modules"}';
  end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'access.member.modules', v_input);
  if v_replay is not null then return v_replay; end if;

  v_member := sme_check_member_target(p_org, p_user);
  if not v_member.is_active or v_member.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"inactive_member"}';
  end if;

  update org_members
     set allowed_modules = (select array_agg(distinct m order by m) from unnest(p_modules) m),
         approved_by = auth.uid(),
         granted_at = now()
   where id = v_member.id
  returning * into v_after;

  perform sme_audit(p_org, 'access.member.modules_changed', 'org_member', v_member.id,
    to_jsonb(v_member), to_jsonb(v_after),
    jsonb_build_object('user_id', p_user, 'from', to_jsonb(v_member.allowed_modules), 'to', to_jsonb(v_after.allowed_modules)),
    p_correlation_id, p_reason);

  v_result := jsonb_build_object('member_id', v_member.id, 'allowed_modules', to_jsonb(v_after.allowed_modules));
  return sme_idem_finish(p_org, p_idem, 'access.member.modules', v_input, v_result);
end;
$$;

revoke all on function sme_revoke_member(uuid, uuid, text, uuid, text) from public, anon;
revoke all on function sme_set_member_modules(uuid, uuid, text[], text, uuid, text) from public, anon;
grant execute on function sme_revoke_member(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function sme_set_member_modules(uuid, uuid, text[], text, uuid, text) to authenticated;

-- ── Invitations carry module scopes ─────────────────────────

drop function org_invite(uuid, text, text);

create or replace function org_invite(p_org uuid, p_email text, p_role text, p_modules text[] default null)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(p_email));
  v_token text;
  v_id    uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;
  if not org_has_permission(p_org, 'team.invite') or not org_can_grant_role(p_org, p_role) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  -- Narrowing an invitee to modules is an access decision, so it needs access.manage.
  if p_modules is not null and not sme_has_perm(p_org, 'sme.access.manage') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED', detail = '{"permission":"sme.access.manage"}';
  end if;
  if p_modules is not null and not (p_modules <@ sme_module_names()) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"modules"}';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"email"}';
  end if;
  if not exists (select 1 from org_roles where org_id = p_org and name = p_role) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"role"}';
  end if;
  if exists (
    select 1 from org_members m join auth.users u on u.id = m.user_id
    where m.org_id = p_org and m.is_active and lower(u.email) = v_email
  ) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"already_member"}';
  end if;

  update org_invitations
     set revoked_at = now()
   where org_id = p_org and email = v_email and accepted_at is null and revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into org_invitations (org_id, email, role, token_hash, invited_by, allowed_modules)
  values (p_org, v_email, p_role, encode(digest(v_token, 'sha256'), 'hex'), auth.uid(),
          (select array_agg(distinct m order by m) from unnest(p_modules) m))
  returning id into v_id;

  insert into crm_audit_log (org_id, user_id, action, entity_type, entity_id, changes)
  values (p_org, auth.uid(), 'member.invited', 'org_invitation', v_id,
          jsonb_build_object('email', v_email, 'role', p_role, 'modules', to_jsonb(p_modules)));

  return v_token;
end;
$$;

create or replace function org_accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inv  org_invitations;
  v_user auth.users;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  select * into v_inv from org_invitations
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
   for update;
  if not found or v_inv.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND', detail = '{"reason":"invalid"}';
  end if;
  if v_inv.accepted_at is not null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND', detail = '{"reason":"used"}';
  end if;
  if v_inv.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND', detail = '{"reason":"expired"}';
  end if;

  select * into v_user from auth.users where id = auth.uid();
  if v_user.email_confirmed_at is null
     or lower(coalesce(auth.jwt() ->> 'email', '')) <> lower(v_inv.email::text)
     or lower(coalesce(v_user.email, '')) <> lower(v_inv.email::text) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED', detail = '{"reason":"email_mismatch"}';
  end if;

  if exists (select 1 from org_members where org_id = v_inv.org_id and user_id = auth.uid() and is_active) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"already_member"}';
  end if;

  insert into org_members (org_id, user_id, role, invited_by, invited_at, joined_at, is_active,
                           allowed_modules, approved_by, granted_at)
  values (v_inv.org_id, auth.uid(), v_inv.role, v_inv.invited_by, v_inv.created_at, now(), true,
          v_inv.allowed_modules, v_inv.invited_by, now())
  on conflict (org_id, user_id) do update
     set role = excluded.role, invited_by = excluded.invited_by, invited_at = excluded.invited_at,
         joined_at = now(), is_active = true, permissions = '{}',
         allowed_modules = excluded.allowed_modules, approved_by = excluded.approved_by,
         granted_at = now(), revoked_at = null, revoked_by = null
  returning id into v_member_id;

  update org_invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;

  insert into crm_audit_log (org_id, user_id, action, entity_type, entity_id, changes)
  values (v_inv.org_id, auth.uid(), 'member.joined', 'org_invitation', v_inv.id, jsonb_build_object('role', v_inv.role));
  perform sme_audit(v_inv.org_id, 'access.member.granted', 'org_member', v_member_id, null,
    jsonb_build_object('role', v_inv.role, 'allowed_modules', to_jsonb(v_inv.allowed_modules)),
    jsonb_build_object('invitation_id', v_inv.id, 'approved_by', v_inv.invited_by), gen_random_uuid());

  return v_inv.org_id;
end;
$$;

revoke all on function org_invite(uuid, text, text, text[]) from public, anon;
grant execute on function org_invite(uuid, text, text, text[]) to authenticated;
