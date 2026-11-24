-- ============================================================
-- SME PRODUCT EVENTS (W3a-11): what people do on the screens, for the pilot KPIs (Wave 4)
-- ============================================================
-- Domain events go through sme_outbox; these only count usage. Props carry codes and flags,
-- never amounts, names or free text, and demo organizations are never recorded.

create table sme_product_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  event_name text not null,
  props jsonb not null default '{}' check (jsonb_typeof(props) = 'object'),
  created_at timestamptz not null default now()
);
create index sme_product_events_org_idx on sme_product_events (org_id, event_name, created_at desc);

alter table sme_product_events enable row level security;
-- Read by platform staff for the pilot dashboard only; no organization reads its own usage log.
create policy sme_product_events_staff_select on sme_product_events for select to authenticated using (is_staff());
revoke all on sme_product_events from anon, authenticated;
grant select on sme_product_events to authenticated;

-- The event names in the blueprint's screen tables (§5–§10).
create or replace function sme_product_event_names()
returns text[]
language sql
immutable
as $$
  select array['DashboardViewed', 'TransactionPosted', 'ImportReviewed', 'InvoiceStatusChanged', 'BillStatusChanged',
               'ForecastRecalculated', 'ScenarioSaved', 'ReportExported', 'EvidenceOpened', 'CalculatorOpened',
               'CalculationRequested', 'CalculationCompleted', 'LessonOpened', 'LessonCompleted', 'LessonActionOpened',
               'AssistantQueryCreated', 'DocumentReviewed', 'LegalSourceViewed', 'ApplicabilityEvaluated',
               'ObligationConfirmed', 'ObligationCompleted', 'EventReminderRequested', 'ListingViewed',
               'ReferralRequested', 'BusinessProfileUpdated'];
$$;

create or replace function sme_track(p_org uuid, p_event text, p_props jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demo boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;
  if not is_org_member(p_org) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED';
  end if;
  if not (p_event = any (sme_product_event_names())) then
    perform sme_fail('VALIDATION_FAILED', '{"field":"event"}');
  end if;
  if jsonb_typeof(coalesce(p_props, '{}')) <> 'object'
     or (select count(*) from jsonb_object_keys(coalesce(p_props, '{}'))) > 10
     or exists (
       select 1 from jsonb_each(coalesce(p_props, '{}')) e
        where e.key !~ '^[a-z_]{1,40}$'
           or not (jsonb_typeof(e.value) = 'boolean'
                   or (jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '^[a-z0-9_.:-]{1,64}$'))) then
    perform sme_fail('VALIDATION_FAILED', '{"field":"props","reason":"codes_and_flags_only"}');
  end if;

  select is_demo into v_demo from organizations where id = p_org;
  if v_demo then return false; end if;
  insert into sme_product_events (org_id, user_id, event_name, props) values (p_org, auth.uid(), p_event, coalesce(p_props, '{}'));
  return true;
end;
$$;

revoke all on function sme_track(uuid, text, jsonb) from public, anon;
grant execute on function sme_track(uuid, text, jsonb) to authenticated;
