-- ============================================================
-- SME DEMO ORGANIZATIONS AND DATA QUALITY (W2-07)
-- ============================================================
-- Sample data lives in a separate organization of its own, so it can never mix with live data
-- (blueprint §4). Nothing copies rows between organizations: every SME RPC takes one p_org and
-- checks that every referenced row belongs to it.

alter table organizations add column is_demo boolean not null default false;
comment on column organizations.is_demo is 'Sample-data organization. Excluded from product analytics; can never become live.';

-- One demo per user, created only by sme_create_demo_org, and never switched either way.
create unique index organizations_one_demo_per_creator on organizations (created_by) where is_demo;

create or replace function sme_demo_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_demo and coalesce(current_setting('sme.creating_demo', true), '') <> 'on' then
      raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"is_demo","reason":"created_by_rpc_only"}';
    end if;
  elsif new.is_demo is distinct from old.is_demo then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"field":"is_demo","reason":"immutable"}';
  end if;
  return new;
end;
$$;

create trigger organizations_demo_guard
  before insert or update on organizations
  for each row execute function sme_demo_guard();

-- Demo organizations have the SME suite without a subscription; their data is synthetic.
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
    where o.id = p_org
      and o.country = 'JO'
      and (
        o.is_demo
        or exists (
          select 1 from subscriptions s
          where s.org_id = o.id
            and s.plan in ('organization', 'enterprise', 'custom')
            and (s.status in ('active', 'trialing') or (s.status = 'past_due' and s.grace_period_ends_at > now()))
        )
      )
  );
$$;

-- ── Seeding ─────────────────────────────────────────────────
-- Thirteen weeks of synthetic activity ending today: sales, cash takings, supplies, monthly rent,
-- salaries and bills, transfers from the cash box, and the last four weeks of the bank account
-- arriving as an imported statement. A few lines are left uncategorized on purpose.

create or replace function sme_seed_demo(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_d0 date := current_date - 90;
  v_import_from date := current_date - 27;
  v_bank uuid;
  v_cash uuid;
  v_batch uuid := gen_random_uuid();
  v_item record;
  v_tx sme_transactions;
  v_in sme_transactions;
  v_row uuid;
  v_group uuid;
  v_n int := 0;
  v_row_number int := 1;
begin
  if not exists (select 1 from organizations where id = p_org and is_demo) then
    perform sme_fail('VALIDATION_FAILED', '{"reason":"not_a_demo_organization"}');
  end if;

  insert into sme_business_profiles (org_id, trade_name, trade_name_ar, updated_by)
  values (p_org, 'Sample Trading (demo)', 'منشأة تجريبية للتجارة', auth.uid())
  on conflict (org_id) do nothing;

  insert into sme_accounts (org_id, kind, name, name_ar, institution, currency, created_by)
  values (p_org, 'bank', 'Main bank account (sample)', 'الحساب البنكي الرئيسي (نموذجي)', 'Sample bank', 'JOD', auth.uid())
  returning id into v_bank;
  insert into sme_accounts (org_id, kind, name, name_ar, currency, created_by)
  values (p_org, 'cash', 'Cash box (sample)', 'الصندوق (نموذجي)', 'JOD', auth.uid())
  returning id into v_cash;

  v_tx := sme_ledger_insert(p_org, v_bank, v_d0, 8000000, null, '', null, 'opening_balance', null, false, null, 'demo:opening:bank');
  perform sme_ledger_classify(p_org, v_tx, 'opening_balance', jsonb_build_object('category_id', sme_system_category('opening_balance')));
  v_tx := sme_ledger_insert(p_org, v_cash, v_d0, 300000, null, '', null, 'opening_balance', null, false, null, 'demo:opening:cash');
  perform sme_ledger_classify(p_org, v_tx, 'opening_balance', jsonb_build_object('category_id', sme_system_category('opening_balance')));

  insert into sme_import_batches (id, org_id, account_id, file_name, storage_path, mime_type, byte_size, source_hash, parser_version,
                                  status, uploaded_by, committed_by, committed_at)
  values (v_batch, p_org, v_bank, 'sample_bank_statement.csv', p_org || '/' || v_batch || '/sample_bank_statement.csv', 'text/csv', 2048,
          encode(digest('demo:' || p_org::text, 'sha256'), 'hex'), 'demo', 'in_review', auth.uid(), null, null);

  for v_item in
    select * from (
      select v_d0 + 7 * w + 1 as d, 'bank' as acct, (1150000 + ((w * 73) % 400) * 1000)::bigint as amt, 'POS settlement' as descr, 'sales' as cat, 'pos_card' as ch from generate_series(0, 12) w
      union all
      select v_d0 + 7 * w + 2, 'cash', (220000 + ((w * 31) % 90) * 1000)::bigint, 'مبيعات نقدية', 'sales', 'cash' from generate_series(0, 12) w
      union all
      select v_d0 + 7 * w + 3, 'bank', -(180000 + ((w * 47) % 120) * 1000)::bigint, 'شراء مستلزمات', case when w % 5 = 2 then null else 'supplies' end, 'bank_transfer' from generate_series(0, 12) w
      union all
      select v_d0 + 7 * w + 4, 'bank', -650000::bigint, 'دفعة إيجار المحل', 'rent', 'bank_transfer' from generate_series(0, 12, 4) w
      union all
      select v_d0 + 7 * w + 5, 'bank', -1800000::bigint, 'رواتب الموظفين', 'salaries_wages', 'bank_transfer' from generate_series(0, 12, 4) w
      union all
      select v_d0 + 7 * w + 5, 'bank', -(85000 + w * 1000)::bigint, 'فاتورة كهرباء', 'utilities', 'efawateercom' from generate_series(0, 12, 4) w
      union all
      select v_d0 + 7 * w + 6, 'bank', -35000::bigint, 'Zain - mobile and internet', case when w = 8 then null else 'telecom' end, 'direct_debit' from generate_series(0, 12, 4) w
      union all
      select v_d0 + 7 * w + 6, 'bank', -2500::bigint, 'رسوم بنكية', 'bank_fees', 'other' from generate_series(0, 12, 4) w
      union all
      select v_d0 + 7 * w + 6, 'transfer', 400000::bigint, 'Cash deposited at the bank', 'transfer', 'cash' from generate_series(2, 12, 4) w
    ) x
    where d <= current_date
    order by d, acct, descr
  loop
    v_n := v_n + 1;
    if v_item.acct = 'transfer' then
      v_group := gen_random_uuid();
      v_tx := sme_ledger_insert(p_org, v_cash, v_item.d, -v_item.amt, null, v_item.descr, null, 'transfer', null, false, v_group, 'demo:' || v_n || ':out');
      v_in := sme_ledger_insert(p_org, v_bank, v_item.d, v_item.amt, null, v_item.descr, null, 'transfer', null, false, v_group, 'demo:' || v_n || ':in');
      perform sme_ledger_classify(p_org, v_tx, 'transfer', jsonb_build_object('category_id', sme_system_category('transfer'), 'channel', v_item.ch));
      perform sme_ledger_classify(p_org, v_in, 'transfer', jsonb_build_object('category_id', sme_system_category('transfer'), 'channel', v_item.ch));
    elsif v_item.acct = 'bank' and v_item.d >= v_import_from then
      insert into sme_import_rows (org_id, batch_id, row_number, raw, value_date, amount_minor, currency, description, category_id, channel, status)
      values (p_org, v_batch, v_row_number + 1, jsonb_build_object('sample', true), v_item.d, v_item.amt, 'JOD', v_item.descr,
              sme_system_category(v_item.cat), v_item.ch, 'accepted')
      returning id into v_row;
      v_tx := sme_ledger_insert(p_org, v_bank, v_item.d, v_item.amt, null, v_item.descr, null, 'import', null, false, null,
                                'demo:' || v_n, null, v_batch, v_row);
      perform sme_ledger_classify(p_org, v_tx, 'import', jsonb_build_object('category_id', sme_system_category(v_item.cat), 'channel', v_item.ch));
      update sme_import_rows set posted_transaction_id = v_tx.id, fingerprint = v_tx.fingerprint where id = v_row;
      v_row_number := v_row_number + 1;
    else
      v_tx := sme_ledger_insert(p_org, case v_item.acct when 'cash' then v_cash else v_bank end, v_item.d, v_item.amt, null,
                                v_item.descr, null, 'manual', null, false, null, 'demo:' || v_n);
      perform sme_ledger_classify(p_org, v_tx, 'manual', jsonb_build_object('category_id', sme_system_category(v_item.cat), 'channel', v_item.ch));
    end if;
  end loop;

  update sme_import_batches
     set status = 'committed', committed_by = auth.uid(), committed_at = now(),
         row_count = v_row_number - 1, accepted_count = v_row_number - 1, excluded_count = 0
   where id = v_batch;

  perform sme_audit(p_org, 'demo.seeded', 'organization', p_org, null, null,
    jsonb_build_object('entries', v_n, 'imported_rows', v_row_number - 1), null);
  return jsonb_build_object('entries', v_n, 'imported_rows', v_row_number - 1);
end;
$$;

create or replace function sme_create_demo_org()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_org uuid;
begin
  if auth.uid() is null then perform sme_fail('UNAUTHENTICATED'); end if;
  select o.id into v_existing
  from organizations o
  join org_members m on m.org_id = o.id and m.user_id = auth.uid() and m.is_active and m.revoked_at is null
  where o.is_demo and o.created_by = auth.uid()
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('org_id', v_existing, 'created', false);
  end if;

  perform set_config('sme.creating_demo', 'on', true);
  insert into organizations (name, name_ar, country, currency, is_demo, created_by)
  values ('Sample business', 'منشأة تجريبية', 'JO', 'JOD', true, auth.uid())
  returning id into v_org;
  perform set_config('sme.creating_demo', '', true);

  perform sme_seed_demo(v_org);
  perform sme_audit(v_org, 'demo.created', 'organization', v_org, null, null, '{}'::jsonb, null);
  return jsonb_build_object('org_id', v_org, 'created', true);
end;
$$;

-- ── Data-quality inputs (security invoker: RLS decides what the caller sees) ─

create or replace function sme_data_quality_inputs(p_org uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'as_of', now(),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', a.id, 'first_date', s.first_date, 'last_date', s.last_date,
        'last_import_date', (select max(b.committed_at)::date from sme_import_batches b
                             where b.account_id = a.id and b.status = 'committed')) order by a.created_at)
      from sme_accounts a
      left join lateral (select min(t.value_date) as first_date, max(t.value_date) as last_date
                         from sme_transactions t where t.account_id = a.id) s on true
      where a.org_id = p_org and a.status = 'active'), '[]'::jsonb),
    -- Reversed pairs cancel out; they are neither evidence of activity nor of categorization.
    'transaction_count', (select count(*) from sme_transactions_current t
                          where t.org_id = p_org and not t.is_reversal and not t.is_reversed),
    'categorized_count', (select count(*) from sme_transactions_current t
                          where t.org_id = p_org and not t.is_reversal and not t.is_reversed and t.category_id is not null),
    'unresolved_import_rows', (select count(*) from sme_import_rows r join sme_import_batches b on b.id = r.batch_id
                               where b.org_id = p_org and b.status in ('parsing', 'in_review')
                                 and r.status not in ('accepted', 'excluded')));
$$;

revoke all on function sme_seed_demo(uuid) from public, anon, authenticated;
revoke all on function sme_create_demo_org() from public, anon;
grant execute on function sme_create_demo_org() to authenticated;
revoke all on function sme_data_quality_inputs(uuid) from public, anon;
grant execute on function sme_data_quality_inputs(uuid) to authenticated;
