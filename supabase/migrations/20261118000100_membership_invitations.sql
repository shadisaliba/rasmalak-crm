-- ============================================================
-- MEMBERSHIP: invitations only, and no role above your own (D2)
-- ============================================================
-- Before this migration any signed-in user could insert themselves into any
-- organization with any role, and a manager could add an owner.

create extension if not exists citext with schema extensions;

-- ── Role ranks ──────────────────────────────────────────────

-- Unknown (custom) roles rank at admin level so that only owners and admins can grant them;
-- a custom role's permissions are not bounded by its name.
create or replace function org_role_rank(p_role text)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_role
    when 'owner'      then 50
    when 'admin'      then 40
    when 'manager'    then 30
    when 'bookkeeper' then 30
    when 'sales_rep'  then 20
    when 'adviser'    then 10
    when 'viewer'     then 10
    else 40
  end;
$$;

-- Effective CRM permission for the caller: member override, then role default; owners hold all.
create or replace function org_has_permission(p_org uuid, p_perm text)
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
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.is_active
      and (
        m.role = 'owner'
        or coalesce((m.permissions ->> p_perm)::boolean, (r.permissions ->> p_perm)::boolean, false)
      )
  );
$$;

-- Owner and admin are granted only by an owner; any other role only up to the granter's own rank.
create or replace function org_can_grant_role(p_org uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when get_org_role(p_org) is null then false
    when p_role in ('owner', 'admin') then get_org_role(p_org) = 'owner'
    else org_role_rank(p_role) <= org_role_rank(get_org_role(p_org))
  end;
$$;

-- ── Invitations ─────────────────────────────────────────────

create table org_invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  email        extensions.citext not null,
  role         text not null,
  token_hash   text not null unique,
  invited_by   uuid not null references auth.users(id),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index org_invitations_org_idx on org_invitations (org_id, created_at desc);

alter table org_invitations enable row level security;

create policy org_invitations_select on org_invitations
  for select to authenticated
  using (get_org_role(org_id) in ('owner', 'admin'));
-- No insert, update or delete policies: invitations change only through the functions below.

create or replace function org_invite(p_org uuid, p_email text, p_role text)
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

  -- A new invitation replaces any pending one for the same address.
  update org_invitations
     set revoked_at = now()
   where org_id = p_org and email = v_email and accepted_at is null and revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into org_invitations (org_id, email, role, token_hash, invited_by)
  values (p_org, v_email, p_role, encode(digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;

  insert into crm_audit_log (org_id, user_id, action, entity_type, entity_id, changes)
  values (p_org, auth.uid(), 'member.invited', 'org_invitation', v_id, jsonb_build_object('email', v_email, 'role', p_role));

  return v_token;
end;
$$;

create or replace function org_revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from org_invitations
   where id = p_invitation and accepted_at is null and revoked_at is null
   for update;
  if v_org is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND';
  end if;
  if not org_has_permission(v_org, 'team.invite') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  update org_invitations set revoked_at = now() where id = p_invitation;
  insert into crm_audit_log (org_id, user_id, action, entity_type, entity_id)
  values (v_org, auth.uid(), 'member.invitation_revoked', 'org_invitation', p_invitation);
end;
$$;

-- Returns the organization joined.
create or replace function org_accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inv  org_invitations;
  v_user auth.users;
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
  -- An unconfirmed address proves nothing about who holds the inbox the invitation went to.
  if v_user.email_confirmed_at is null
     or lower(coalesce(auth.jwt() ->> 'email', '')) <> lower(v_inv.email::text)
     or lower(coalesce(v_user.email, '')) <> lower(v_inv.email::text) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED', detail = '{"reason":"email_mismatch"}';
  end if;

  if exists (select 1 from org_members where org_id = v_inv.org_id and user_id = auth.uid() and is_active) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"already_member"}';
  end if;

  insert into org_members (org_id, user_id, role, invited_by, invited_at, joined_at, is_active)
  values (v_inv.org_id, auth.uid(), v_inv.role, v_inv.invited_by, v_inv.created_at, now(), true)
  on conflict (org_id, user_id) do update
     set role = excluded.role, invited_by = excluded.invited_by, invited_at = excluded.invited_at,
         joined_at = now(), is_active = true, permissions = '{}';

  update org_invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;

  insert into crm_audit_log (org_id, user_id, action, entity_type, entity_id, changes)
  values (v_inv.org_id, auth.uid(), 'member.joined', 'org_invitation', v_inv.id, jsonb_build_object('role', v_inv.role));

  return v_inv.org_id;
end;
$$;

revoke all on function org_invite(uuid, text, text) from public, anon;
revoke all on function org_revoke_invitation(uuid) from public, anon;
revoke all on function org_accept_invitation(text) from public, anon;
grant execute on function org_invite(uuid, text, text) to authenticated;
grant execute on function org_revoke_invitation(uuid) to authenticated;
grant execute on function org_accept_invitation(text) to authenticated;

-- ── Member policies ─────────────────────────────────────────

drop policy "members_insert" on org_members;
-- Members are added only by the organization-creator trigger and org_accept_invitation,
-- both SECURITY DEFINER, so the authenticated role may insert nothing directly.
create policy "members_insert" on org_members
  for insert to authenticated
  with check (false);

drop policy "members_update" on org_members;
create policy "members_update" on org_members
  for update to authenticated
  using (
    get_org_role(org_id) in ('owner', 'admin')
    and (role <> 'owner' or get_org_role(org_id) = 'owner')
    and org_role_rank(role) <= org_role_rank(get_org_role(org_id))
  )
  with check (
    get_org_role(org_id) in ('owner', 'admin')
    and org_can_grant_role(org_id, role)
  );

drop policy "members_delete" on org_members;
create policy "members_delete" on org_members
  for delete to authenticated
  using (
    get_org_role(org_id) in ('owner', 'admin')
    and (role <> 'owner' or get_org_role(org_id) = 'owner')
    and org_role_rank(role) <= org_role_rank(get_org_role(org_id))
  );
