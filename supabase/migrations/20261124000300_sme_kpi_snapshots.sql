-- ============================================================
-- SME KPI SNAPSHOTS (W3a-08): cached financial summaries, one per organization, period and version
-- ============================================================
-- The summary is computed in the app (src/sme/kpi/domain/summary.ts). The worker stores it after
-- ledger and register events; the route serves it while its input digest still matches.

create table sme_kpi_snapshots (
  org_id uuid not null references organizations(id) on delete restrict,
  period_key text not null check (period_key ~ '^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$'),
  kpi_version text not null check (length(kpi_version) <= 40),
  input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  computed_at timestamptz not null default now(),
  primary key (org_id, period_key, kpi_version)
);

alter table sme_kpi_snapshots enable row level security;
create policy sme_kpi_snapshots_select on sme_kpi_snapshots for select to authenticated using (sme_has_perm(org_id, 'sme.ledger.read'));
revoke all on sme_kpi_snapshots from anon, authenticated;
grant select on sme_kpi_snapshots to authenticated;

-- Worker path (outbox handler, service role, rule R11).
create or replace function sme_store_kpi_snapshot_worker(p_org uuid, p_period_key text, p_version text, p_digest text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not sme_enabled(p_org) then
    raise exception using errcode = 'P0001', message = 'FEATURE_NOT_ENABLED';
  end if;
  insert into sme_kpi_snapshots (org_id, period_key, kpi_version, input_digest, payload, computed_at)
  values (p_org, p_period_key, p_version, p_digest, p_payload, now())
  on conflict (org_id, period_key, kpi_version) do update
     set input_digest = excluded.input_digest, payload = excluded.payload, computed_at = excluded.computed_at;
end;
$$;

revoke all on function sme_store_kpi_snapshot_worker(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function sme_store_kpi_snapshot_worker(uuid, text, text, text, jsonb) to service_role;
