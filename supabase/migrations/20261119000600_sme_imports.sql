-- ============================================================
-- SME STATEMENT IMPORTS (W2-06)
-- ============================================================
-- Upload (signed URL, private bucket) → parse (outbox worker) → review (a person decides every
-- row) → commit, which posts every accepted row in one transaction or none (blueprint §12).

create table sme_import_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  account_id uuid not null references sme_accounts(id),
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null,
  source_hash text not null,                 -- sha256 of file bytes
  parser_version text not null,
  column_mapping jsonb,
  parse_options jsonb,                       -- date format, amount mode, decimal separator
  status text not null default 'uploaded' check (status in
    ('uploaded','parsing','in_review','committing','committed','failed','cancelled')),
  row_count int, accepted_count int, excluded_count int,
  error_code text, error_detail jsonb,
  uploaded_by uuid not null references auth.users(id),
  committed_by uuid references auth.users(id),
  committed_at timestamptz,
  retention_until date,
  created_at timestamptz not null default now()
);
create unique index sme_import_batches_live_hash
  on sme_import_batches (org_id, account_id, source_hash)
  where status not in ('failed','cancelled');
create index sme_import_batches_org_idx on sme_import_batches (org_id, created_at desc);

create table sme_import_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  batch_id uuid not null references sme_import_batches(id),
  row_number int not null,
  raw jsonb not null,
  value_date date, amount_minor bigint, currency char(3),
  description text, external_ref text, fingerprint text,
  suggested_category_id uuid references sme_categories(id),
  category_id uuid references sme_categories(id),
  channel text,
  status text not null check (status in
    ('valid','invalid','duplicate_existing','duplicate_suspected','duplicate_in_file','accepted','excluded')),
  issues jsonb not null default '[]',
  override_reason text,
  posted_transaction_id uuid references sme_transactions(id),
  unique (batch_id, row_number)
);
create index sme_import_rows_fingerprint_idx on sme_import_rows (batch_id, fingerprint);
create index sme_import_rows_status_idx on sme_import_rows (batch_id, status, row_number);

alter table sme_transactions add constraint sme_transactions_import_batch_fk foreign key (import_batch_id) references sme_import_batches(id);
alter table sme_transactions add constraint sme_transactions_import_row_fk foreign key (import_row_id) references sme_import_rows(id);

-- Reads through RLS; every write goes through the RPCs below (R10). Ledger readers see batches and
-- rows because posted transactions show which file and row they came from.
alter table sme_import_batches enable row level security;
alter table sme_import_rows enable row level security;
create policy sme_import_batches_select on sme_import_batches for select to authenticated
  using (sme_has_perm(org_id, 'sme.imports.execute') or sme_has_perm(org_id, 'sme.ledger.read'));
create policy sme_import_rows_select on sme_import_rows for select to authenticated
  using (sme_has_perm(org_id, 'sme.imports.execute') or sme_has_perm(org_id, 'sme.ledger.read'));

-- ── Storage: private bucket, one object per batch ───────────
-- An upload is allowed only to the path of a batch that is waiting for its file, so the path
-- cannot be chosen freely and the first folder is always the batch's organization.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sme-imports', 'sme-imports', false, 10485760,
        array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false;

create or replace function sme_import_upload_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from sme_import_batches b
    where b.storage_path = p_name and b.status = 'uploaded'
      and split_part(p_name, '/', 1) = b.org_id::text
      and sme_has_perm(b.org_id, 'sme.imports.execute'));
$$;

create or replace function sme_import_read_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from sme_import_batches b
    where b.storage_path = p_name and split_part(p_name, '/', 1) = b.org_id::text
      and sme_has_perm(b.org_id, 'sme.imports.execute'));
$$;

create policy sme_imports_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sme-imports' and sme_import_upload_allowed(name));
create policy sme_imports_select on storage.objects for select to authenticated
  using (bucket_id = 'sme-imports' and sme_import_read_allowed(name));

-- ── FX for imported foreign-currency rows ───────────────────

create or replace function sme_fx_stored(p_currency text, p_date date)
returns fx_rates
language sql
stable
as $$
  select * from fx_rates
  where from_currency = p_currency and to_currency = 'JOD' and date <= p_date
  order by date desc limit 1;
$$;

-- ── sme_ledger_insert gains import provenance ───────────────
-- Same rules as W2-05; posted rows cannot be updated, so the batch and row references must be
-- written by the insert itself.

drop function sme_ledger_insert(uuid, uuid, date, bigint, text, text, text, text, jsonb, boolean, uuid, text, bigint);

create or replace function sme_ledger_insert(
  p_org uuid, p_account_id uuid, p_value_date date, p_amount_minor bigint, p_currency text,
  p_description text, p_external_ref text, p_source_kind text, p_fx jsonb, p_is_estimate boolean,
  p_transfer_group uuid, p_key text, p_base_override bigint default null,
  p_import_batch uuid default null, p_import_row uuid default null
)
returns sme_transactions
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account sme_accounts;
  v_minor int;
  v_rate numeric(24,12);
  v_rate_text text;
  v_rate_date date;
  v_source text;
  v_base bigint;
  v_row sme_transactions;
begin
  select * into v_account from sme_accounts where id = p_account_id and org_id = p_org;
  if not found then perform sme_fail('NOT_FOUND', jsonb_build_object('entity', 'account')); end if;
  if v_account.status <> 'active' then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'account_id', 'reason', 'account_archived')); end if;
  if p_currency is not null and p_currency <> v_account.currency then
    perform sme_fail('CURRENCY_MISMATCH', jsonb_build_object('account_currency', v_account.currency, 'currency', p_currency));
  end if;
  if p_amount_minor is null or p_amount_minor = 0 then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'amount_minor', 'reason', 'zero'));
  end if;
  if p_value_date < date '1990-01-01' or p_value_date > current_date + 366 then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'value_date', 'reason', 'out_of_range'));
  end if;
  if exists (select 1 from sme_transactions where org_id = p_org and idempotency_key = p_key) then
    perform sme_fail('IDEMPOTENCY_CONFLICT');
  end if;

  v_minor := sme_currency_minor_units(v_account.currency);
  if v_account.currency = 'JOD' then
    v_base := p_amount_minor;
  elsif p_base_override is not null then
    v_base := p_base_override;
    v_rate := round(abs(p_base_override)::numeric * power(10::numeric, v_minor - 3) / abs(p_amount_minor), 12);
    if v_rate <= 0 then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'to_amount_minor', 'reason', 'implied_rate_zero')); end if;
    v_rate_date := p_value_date;
    v_source := 'transfer:implied';
  else
    v_rate_text := nullif(btrim(coalesce(p_fx ->> 'rate', '')), '');
    if v_rate_text is null then
      perform sme_fail('FX_RATE_REQUIRED', jsonb_build_object('currency', v_account.currency));
    end if;
    if v_rate_text !~ '^[0-9]{1,12}(\.[0-9]{1,12})?$' or v_rate_text::numeric <= 0 then
      perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'fx.rate', 'reason', 'invalid_rate'));
    end if;
    v_rate := v_rate_text::numeric;
    v_rate_date := sme_json_date(p_fx, 'rate_date');
    v_source := p_fx ->> 'source';
    if v_source = 'aggregator:open.er-api.com' then
      if not exists (select 1 from fx_rates where date = v_rate_date and from_currency = v_account.currency
                       and to_currency = 'JOD' and rate = v_rate and source = v_source) then
        perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'fx.rate', 'reason', 'rate_not_found'));
      end if;
    elsif v_source = 'manual' then
      perform sme_json_text(p_fx, 'reason', 500, true);
    else
      perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'fx.source', 'reason', 'unknown_source'));
    end if;
    v_base := round(p_amount_minor::numeric * v_rate * power(10::numeric, 3 - v_minor))::bigint;
  end if;

  insert into sme_transactions (
    org_id, account_id, value_date, amount_minor, currency, base_amount_minor, fx_rate, fx_rate_date, fx_source,
    description, external_ref, source_kind, import_batch_id, import_row_id, fingerprint, transfer_group_id,
    is_estimate, idempotency_key, created_by
  ) values (
    p_org, p_account_id, p_value_date, p_amount_minor, v_account.currency, v_base, v_rate, v_rate_date, v_source,
    coalesce(p_description, ''), p_external_ref, p_source_kind, p_import_batch, p_import_row,
    sme_fingerprint(p_org, p_account_id, p_value_date, p_amount_minor, p_description, p_external_ref),
    p_transfer_group, coalesce(p_is_estimate, false), p_key, auth.uid()
  ) returning * into v_row;
  return v_row;
end;
$$;

revoke all on function sme_ledger_insert(uuid, uuid, date, bigint, text, text, text, text, jsonb, boolean, uuid, text, bigint, uuid, uuid) from public, anon, authenticated;

-- ── Row evaluation ──────────────────────────────────────────
-- Decides valid / invalid / duplicate for rows nobody has decided yet. Duplicates: a bank
-- reference already posted on the account; a fingerprint already posted; or a fingerprint that
-- appears earlier in the same file. Reversed transactions and reversals do not count.

create or replace function sme_import_evaluate(p_batch uuid, p_row uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch sme_import_batches;
begin
  select * into v_batch from sme_import_batches where id = p_batch;

  update sme_import_rows r
     set fingerprint = case when r.value_date is not null and coalesce(r.amount_minor, 0) <> 0
                            then sme_fingerprint(r.org_id, v_batch.account_id, r.value_date, r.amount_minor, r.description, r.external_ref) end
   where r.batch_id = p_batch and (p_row is null or r.id = p_row) and r.status not in ('accepted', 'excluded');

  update sme_import_rows r
     set override_reason = null,
         status = case
           when r.value_date is null or coalesce(r.amount_minor, 0) = 0 or jsonb_array_length(r.issues) > 0 then 'invalid'
           when r.external_ref is not null and exists (
             select 1 from sme_transactions t
             where t.org_id = r.org_id and t.account_id = v_batch.account_id and t.external_ref = r.external_ref
               and t.source_kind <> 'reversal' and not exists (select 1 from sme_transactions x where x.reversal_of = t.id)) then 'duplicate_existing'
           when exists (
             select 1 from sme_transactions t
             where t.org_id = r.org_id and t.fingerprint = r.fingerprint
               and t.source_kind <> 'reversal' and not exists (select 1 from sme_transactions x where x.reversal_of = t.id)) then 'duplicate_suspected'
           when exists (
             select 1 from sme_import_rows e
             where e.batch_id = r.batch_id and e.fingerprint = r.fingerprint and e.row_number < r.row_number and e.status <> 'invalid') then 'duplicate_in_file'
           else 'valid'
         end
   where r.batch_id = p_batch and (p_row is null or r.id = p_row) and r.status not in ('accepted', 'excluded');
end;
$$;

create or replace function sme_import_counts(p_batch uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
  from (select status, count(*)::int as n from sme_import_rows where batch_id = p_batch group by status) s;
$$;

-- What the review screen shows: counts by status, rows still awaiting a decision, and the net
-- amount the accepted rows will post. Runs as the caller, so RLS applies.
create or replace function sme_import_summary(p_batch uuid)
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'counts', sme_import_counts(p_batch),
    'pending', count(*) filter (where status not in ('accepted', 'excluded', 'invalid')),
    'accepted_total_minor', coalesce(sum(amount_minor) filter (where status = 'accepted'), 0)::text)
  from sme_import_rows where batch_id = p_batch;
$$;

-- Locks a batch that is open for review, or explains why it is not.
create or replace function sme_import_lock(p_org uuid, p_batch uuid)
returns sme_import_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch sme_import_batches;
begin
  select * into v_batch from sme_import_batches where id = p_batch and org_id = p_org for update;
  if not found then perform sme_fail('NOT_FOUND', jsonb_build_object('entity', 'import_batch')); end if;
  if v_batch.status = 'committed' then
    perform sme_fail('BATCH_ALREADY_COMMITTED', jsonb_build_object('batch_id', v_batch.id, 'committed_at', v_batch.committed_at));
  end if;
  if v_batch.status <> 'in_review' then
    perform sme_fail('BATCH_NOT_REVIEWED', jsonb_build_object('status', v_batch.status));
  end if;
  return v_batch;
end;
$$;

-- ── Create ──────────────────────────────────────────────────

create or replace function sme_create_import_batch(p_org uuid, p_account uuid, p_file jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('account', p_account, 'file', p_file);
  v_replay jsonb;
  v_account sme_accounts;
  v_existing sme_import_batches;
  v_name text;
  v_hash text;
  v_size bigint;
  v_kind text;
  v_mime text;
  v_safe text;
  v_id uuid := gen_random_uuid();
  v_batch sme_import_batches;
begin
  perform sme_require(p_org, 'sme.imports.execute');
  if jsonb_typeof(p_file) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'import.batch.create', v_input);
  if v_replay is not null then return v_replay; end if;

  select * into v_account from sme_accounts where id = p_account and org_id = p_org;
  if not found then perform sme_fail('NOT_FOUND', jsonb_build_object('entity', 'account')); end if;
  if v_account.status <> 'active' then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'account_id', 'reason', 'account_archived')); end if;

  v_name := sme_json_text(p_file, 'file_name', 255, true);
  v_hash := lower(coalesce(p_file ->> 'sha256', ''));
  if v_hash !~ '^[0-9a-f]{64}$' then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'sha256', 'reason', 'invalid')); end if;
  v_size := sme_json_minor(p_file, 'byte_size');
  if v_size <= 0 then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'byte_size', 'reason', 'empty')); end if;

  -- The extension decides the parser; browsers report CSV under several media types.
  v_kind := case when lower(v_name) ~ '\.csv$' then 'csv' when lower(v_name) ~ '\.xlsx$' then 'xlsx' end;
  v_mime := lower(coalesce(p_file ->> 'mime_type', ''));
  if v_kind is null
     or (v_kind = 'csv' and v_mime not in ('', 'text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'))
     or (v_kind = 'xlsx' and v_mime not in ('', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) then
    perform sme_fail('UNSUPPORTED_FILE_TYPE', jsonb_build_object('accepted', jsonb_build_array('text/csv', '.xlsx')));
  end if;

  select * into v_existing from sme_import_batches
  where org_id = p_org and account_id = p_account and source_hash = v_hash and status not in ('failed', 'cancelled')
  limit 1;
  if found then
    perform sme_fail('DUPLICATE_IMPORT', jsonb_build_object('batch_id', v_existing.id, 'status', v_existing.status, 'committed_at', v_existing.committed_at));
  end if;

  v_safe := left(regexp_replace(v_name, '[^A-Za-z0-9._-]+', '_', 'g'), 100);
  if v_safe !~ '[A-Za-z0-9]' then v_safe := 'statement.' || v_kind; end if;

  insert into sme_import_batches (id, org_id, account_id, file_name, storage_path, mime_type, byte_size, source_hash, parser_version, uploaded_by)
  values (v_id, p_org, p_account, v_name, p_org || '/' || v_id || '/' || v_safe,
          case v_kind when 'csv' then 'text/csv' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' end,
          v_size, v_hash, 'sme-import/1', auth.uid())
  returning * into v_batch;

  perform sme_audit(p_org, 'import.batch.created', 'import_batch', v_batch.id, null, to_jsonb(v_batch), '{}'::jsonb, p_correlation_id);
  return sme_idem_finish(p_org, p_idem, 'import.batch.create', v_input, jsonb_build_object(
    'batch_id', v_batch.id, 'storage_path', v_batch.storage_path, 'mime_type', v_batch.mime_type, 'file_kind', v_kind));
exception when unique_violation then
  -- Two uploads of the same file raced; the loser sees the same answer as a sequential repeat.
  perform sme_fail('DUPLICATE_IMPORT', jsonb_build_object('reason', 'concurrent_upload'));
end;
$$;

-- ── Parse request (the outbox worker does the parsing) ──────

create or replace function sme_request_import_parse(p_org uuid, p_batch uuid, p_mapping jsonb, p_options jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('batch', p_batch, 'mapping', p_mapping, 'options', p_options);
  v_replay jsonb;
  v_batch sme_import_batches;
begin
  perform sme_require(p_org, 'sme.imports.execute');
  if jsonb_typeof(p_mapping) is distinct from 'object' or jsonb_typeof(p_options) is distinct from 'object' then
    perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}');
  end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'import.parse.request', v_input);
  if v_replay is not null then return v_replay; end if;

  select * into v_batch from sme_import_batches where id = p_batch and org_id = p_org for update;
  if not found then perform sme_fail('NOT_FOUND', jsonb_build_object('entity', 'import_batch')); end if;
  if v_batch.status = 'committed' then
    perform sme_fail('BATCH_ALREADY_COMMITTED', jsonb_build_object('batch_id', v_batch.id, 'committed_at', v_batch.committed_at));
  end if;
  if v_batch.status not in ('uploaded', 'in_review') then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'batch_status', 'status', v_batch.status));
  end if;

  delete from sme_import_rows where batch_id = p_batch;
  update sme_import_batches
     set status = 'parsing', column_mapping = p_mapping, parse_options = p_options,
         row_count = null, accepted_count = null, excluded_count = null, error_code = null, error_detail = null
   where id = p_batch;
  perform sme_audit(p_org, 'import.parse.requested', 'import_batch', p_batch, null, null,
    jsonb_build_object('mapping', p_mapping, 'options', p_options), p_correlation_id);
  perform sme_emit(p_org, 'ImportParseRequested', jsonb_build_object('batchId', p_batch), 'parse:' || p_batch || ':' || p_idem);
  return sme_idem_finish(p_org, p_idem, 'import.parse.request', v_input, jsonb_build_object('batch_id', p_batch, 'status', 'parsing'));
end;
$$;

-- ── Worker side (service role only) ─────────────────────────

create or replace function sme_import_store_rows(p_org uuid, p_batch uuid, p_rows jsonb, p_final boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch sme_import_batches;
  v_currency text;
begin
  select * into v_batch from sme_import_batches where id = p_batch and org_id = p_org for update;
  if not found or v_batch.status <> 'parsing' then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'batch_not_parsing'));
  end if;
  select currency into v_currency from sme_accounts where id = v_batch.account_id;

  insert into sme_import_rows (org_id, batch_id, row_number, raw, value_date, amount_minor, currency, description, external_ref,
                               suggested_category_id, category_id, channel, status, issues)
  select p_org, p_batch, (r ->> 'row_number')::int, coalesce(r -> 'raw', '{}'::jsonb),
         nullif(r ->> 'value_date', '')::date, nullif(r ->> 'amount_minor', '')::bigint, v_currency,
         coalesce(r ->> 'description', ''), nullif(btrim(coalesce(r ->> 'external_ref', '')), ''),
         c.id, c.id, coalesce(nullif(r ->> 'channel', ''), 'unknown'), 'valid',
         coalesce(r -> 'issues', '[]'::jsonb)
           || case when v_currency <> 'JOD' and nullif(r ->> 'value_date', '') is not null
                        and (sme_fx_stored(v_currency, (r ->> 'value_date')::date)).rate is null
                   then '[{"field":"fx","code":"rate_missing"}]'::jsonb else '[]'::jsonb end
  from jsonb_array_elements(p_rows) r
  left join sme_categories c on c.org_id is null and c.code = r ->> 'suggested_category_code' and c.active;

  if p_final then
    perform sme_import_evaluate(p_batch);
    update sme_import_batches
       set status = 'in_review', row_count = (select count(*) from sme_import_rows where batch_id = p_batch),
           accepted_count = 0, excluded_count = 0
     where id = p_batch;
  end if;
  return sme_import_counts(p_batch);
end;
$$;

-- A failed parse shows no rows at all.
create or replace function sme_import_fail(p_org uuid, p_batch uuid, p_code text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from sme_import_rows where batch_id = p_batch and org_id = p_org and posted_transaction_id is null;
  update sme_import_batches
     set status = 'failed', error_code = p_code, error_detail = coalesce(p_detail, '{}'::jsonb)
   where id = p_batch and org_id = p_org and status = 'parsing';
end;
$$;

-- ── Review ──────────────────────────────────────────────────

create or replace function sme_review_import_rows(p_org uuid, p_batch uuid, p_changes jsonb, p_bulk text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('batch', p_batch, 'changes', p_changes, 'bulk', p_bulk);
  v_replay jsonb;
  v_batch sme_import_batches;
  v_currency text;
  v_change jsonb;
  v_row sme_import_rows;
  v_issues jsonb;
  v_date date;
  v_amount bigint;
  v_category sme_categories;
  v_category_id uuid;
  v_channel text;
  v_action text;
  v_edited boolean;
  v_count int := 0;
begin
  perform sme_require(p_org, 'sme.imports.execute');
  if p_changes is not null and jsonb_typeof(p_changes) <> 'array' then perform sme_fail('VALIDATION_FAILED', '{"field":"changes"}'); end if;
  if jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) > 1000 then perform sme_fail('VALIDATION_FAILED', '{"field":"changes","reason":"too_many"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'import.rows.review', v_input);
  if v_replay is not null then return v_replay; end if;

  v_batch := sme_import_lock(p_org, p_batch);
  select currency into v_currency from sme_accounts where id = v_batch.account_id;

  if p_bulk = 'accept_valid' then
    -- The default path: valid rows are posted, suspected duplicates stay out.
    update sme_import_rows set status = 'accepted' where batch_id = p_batch and status = 'valid';
    update sme_import_rows set status = 'excluded' where batch_id = p_batch and status in ('duplicate_existing', 'duplicate_suspected', 'duplicate_in_file');
  elsif p_bulk = 'exclude_duplicates' then
    update sme_import_rows set status = 'excluded' where batch_id = p_batch and status in ('duplicate_existing', 'duplicate_suspected', 'duplicate_in_file');
  elsif p_bulk = 'reset' then
    update sme_import_rows set status = 'valid', override_reason = null where batch_id = p_batch and status in ('accepted', 'excluded');
    perform sme_import_evaluate(p_batch);
  elsif p_bulk is not null then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'bulk', 'reason', 'unknown'));
  end if;

  for v_change in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    select * into v_row from sme_import_rows where id = sme_json_uuid(v_change, 'row_id', true) and batch_id = p_batch for update;
    if not found then perform sme_fail('NOT_FOUND', jsonb_build_object('entity', 'import_row')); end if;
    v_issues := v_row.issues;
    v_edited := false;

    if v_change ? 'value_date' then
      v_date := sme_json_date(v_change, 'value_date', false);
      select coalesce(jsonb_agg(i), '[]'::jsonb) into v_issues from jsonb_array_elements(v_issues) i where i ->> 'field' not in ('value_date', 'fx');
      if v_date is null then
        v_issues := v_issues || '[{"field":"value_date","code":"required"}]'::jsonb;
      elsif v_date > current_date or v_date < current_date - interval '10 years' then
        v_issues := v_issues || '[{"field":"value_date","code":"out_of_range"}]'::jsonb;
      elsif v_currency <> 'JOD' and (sme_fx_stored(v_currency, v_date)).rate is null then
        v_issues := v_issues || '[{"field":"fx","code":"rate_missing"}]'::jsonb;
      end if;
      update sme_import_rows set value_date = v_date where id = v_row.id;
      v_edited := true;
    end if;
    if v_change ? 'amount_minor' then
      v_amount := sme_json_minor(v_change, 'amount_minor', false);
      select coalesce(jsonb_agg(i), '[]'::jsonb) into v_issues from jsonb_array_elements(v_issues) i where i ->> 'field' <> 'amount';
      if coalesce(v_amount, 0) = 0 then v_issues := v_issues || '[{"field":"amount","code":"required"}]'::jsonb; end if;
      update sme_import_rows set amount_minor = v_amount where id = v_row.id;
      v_edited := true;
    end if;
    if v_change ? 'category_id' then
      v_category_id := sme_json_uuid(v_change, 'category_id');
      if v_category_id is not null then
        select * into v_category from sme_categories where id = v_category_id and (org_id is null or org_id = p_org) and active;
        if not found or v_category.kind = 'opening_balance' then
          perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'category_id', 'row_number', v_row.row_number));
        end if;
      end if;
      update sme_import_rows set category_id = v_category_id where id = v_row.id;
    end if;
    if v_change ? 'channel' then
      v_channel := coalesce(nullif(v_change ->> 'channel', ''), 'unknown');
      if v_channel not in ('cash','bank_transfer','cliq','wallet','pos_card','cheque','efawateercom','direct_debit','other','unknown') then
        perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'channel', 'row_number', v_row.row_number));
      end if;
      update sme_import_rows set channel = v_channel where id = v_row.id;
    end if;

    v_action := v_change ->> 'action';
    -- An edit, or including a previously excluded row, re-decides the row before the action.
    if v_edited or (v_action = 'accept' and v_row.status = 'excluded') then
      update sme_import_rows set issues = v_issues, status = 'valid' where id = v_row.id;
      perform sme_import_evaluate(p_batch, v_row.id);
    end if;
    select * into v_row from sme_import_rows where id = v_row.id;

    if v_action = 'accept' then
      if v_row.status = 'invalid' then
        perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invalid_row', 'row_number', v_row.row_number));
      end if;
      if v_row.status in ('duplicate_existing', 'duplicate_suspected', 'duplicate_in_file') then
        update sme_import_rows set override_reason = sme_json_text(v_change, 'override_reason', 500, true) where id = v_row.id;
      end if;
      update sme_import_rows set status = 'accepted' where id = v_row.id;
    elsif v_action = 'exclude' then
      update sme_import_rows set status = 'excluded', override_reason = null where id = v_row.id;
    elsif v_action is not null then
      perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'action', 'row_number', v_row.row_number));
    end if;
    v_count := v_count + 1;
  end loop;

  update sme_import_batches
     set accepted_count = (select count(*) from sme_import_rows where batch_id = p_batch and status = 'accepted'),
         excluded_count = (select count(*) from sme_import_rows where batch_id = p_batch and status = 'excluded')
   where id = p_batch;
  perform sme_audit(p_org, 'import.rows.reviewed', 'import_batch', p_batch, null, null,
    jsonb_build_object('changed', v_count, 'bulk', p_bulk, 'counts', sme_import_counts(p_batch)), p_correlation_id);
  return sme_idem_finish(p_org, p_idem, 'import.rows.review', v_input, jsonb_build_object('counts', sme_import_counts(p_batch)));
end;
$$;

-- ── Commit ──────────────────────────────────────────────────
-- All accepted rows post in one subtransaction. On any failure nothing is posted, the batch stays
-- in review with the error recorded, and the response carries the error (the key is not stored,
-- so the same request can be retried).

create or replace function sme_commit_import(p_org uuid, p_batch uuid, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('batch', p_batch);
  v_replay jsonb;
  v_batch sme_import_batches;
  v_row sme_import_rows;
  v_tx sme_transactions;
  v_fx fx_rates;
  v_pending int;
  v_accepted int;
  v_posted int := 0;
  v_conflicts int[];
  -- Test hook (pgTAP): fail after this many postings to prove the commit is all or nothing.
  v_fail_after int := nullif(current_setting('sme.test_fail_import_after', true), '')::int;
  v_state text;
  v_message text;
  v_detail text;
  v_code text;
begin
  perform sme_require(p_org, 'sme.imports.execute');
  if not sme_has_perm(p_org, 'sme.ledger.post') then
    perform sme_fail('ACCESS_DENIED', jsonb_build_object('permission', 'sme.ledger.post'));
  end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'import.commit', v_input);
  if v_replay is not null then return v_replay; end if;

  v_batch := sme_import_lock(p_org, p_batch);
  select count(*) filter (where status not in ('accepted', 'excluded', 'invalid')),
         count(*) filter (where status = 'accepted')
    into v_pending, v_accepted
  from sme_import_rows where batch_id = p_batch;
  if v_pending > 0 then perform sme_fail('BATCH_NOT_REVIEWED', jsonb_build_object('pending', v_pending)); end if;
  if v_accepted = 0 then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'nothing_to_commit')); end if;

  -- One commit per account at a time; then re-check bank references posted since parsing.
  perform pg_advisory_xact_lock(hashtextextended('sme_account:' || v_batch.account_id, 0));
  select array_agg(r.row_number order by r.row_number) into v_conflicts
  from sme_import_rows r
  where r.batch_id = p_batch and r.status = 'accepted' and r.override_reason is null and r.external_ref is not null
    and exists (select 1 from sme_transactions t
                where t.org_id = p_org and t.account_id = v_batch.account_id and t.external_ref = r.external_ref
                  and t.source_kind <> 'reversal' and not exists (select 1 from sme_transactions x where x.reversal_of = t.id));
  if v_conflicts is not null then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'duplicates_since_review', 'rows', to_jsonb(v_conflicts)));
  end if;

  begin
    for v_row in select * from sme_import_rows where batch_id = p_batch and status = 'accepted' order by row_number loop
      if v_fail_after is not null and v_posted >= v_fail_after then
        raise exception using errcode = 'P0001', message = 'INTERNAL', detail = '{"reason":"test_hook"}';
      end if;
      if v_row.currency <> 'JOD' then v_fx := sme_fx_stored(v_row.currency, v_row.value_date); end if;
      v_tx := sme_ledger_insert(p_org, v_batch.account_id, v_row.value_date, v_row.amount_minor, null,
        v_row.description, v_row.external_ref, 'import',
        case when v_row.currency <> 'JOD' then jsonb_build_object('rate', v_fx.rate::text, 'rate_date', v_fx.date, 'source', v_fx.source) end,
        false, null, p_idem || ':' || v_row.row_number, null, p_batch, v_row.id);
      perform sme_ledger_classify(p_org, v_tx, 'import',
        jsonb_build_object('category_id', v_row.category_id, 'channel', coalesce(v_row.channel, 'unknown')));
      update sme_import_rows set posted_transaction_id = v_tx.id where id = v_row.id;
      v_posted := v_posted + 1;
    end loop;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    v_code := case when v_state = 'P0001' and v_message ~ '^[A-Z_]+$' then v_message else 'INTERNAL' end;
    update sme_import_batches
       set error_code = v_code,
           error_detail = jsonb_build_object('sqlstate', v_state, 'detail', case when v_state = 'P0001' then v_detail end, 'at', now())
     where id = p_batch;
    return jsonb_build_object('error', jsonb_build_object('code', v_code,
      'details', case when v_state = 'P0001' and v_detail ~ '^\{' then v_detail::jsonb end));
  end;

  update sme_import_batches
     set status = 'committed', committed_by = auth.uid(), committed_at = now(), accepted_count = v_posted,
         excluded_count = (select count(*) from sme_import_rows where batch_id = p_batch and status = 'excluded'),
         error_code = null, error_detail = null
   where id = p_batch;
  perform sme_audit(p_org, 'import.committed', 'import_batch', p_batch, null, null,
    jsonb_build_object('account_id', v_batch.account_id, 'posted', v_posted, 'counts', sme_import_counts(p_batch),
                       'source_hash', v_batch.source_hash, 'file_name', v_batch.file_name), p_correlation_id);
  perform sme_emit(p_org, 'ImportCommitted', jsonb_build_object('batchId', p_batch, 'accountId', v_batch.account_id, 'posted', v_posted),
    'import:' || p_batch);
  return sme_idem_finish(p_org, p_idem, 'import.commit', v_input,
    jsonb_build_object('batch_id', p_batch, 'posted', v_posted, 'committed_at', now()));
end;
$$;

-- ── Cancel ──────────────────────────────────────────────────

create or replace function sme_cancel_import(p_org uuid, p_batch uuid, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('batch', p_batch);
  v_replay jsonb;
  v_batch sme_import_batches;
begin
  perform sme_require(p_org, 'sme.imports.execute');
  v_replay := sme_idem_begin(p_org, p_idem, 'import.cancel', v_input);
  if v_replay is not null then return v_replay; end if;

  select * into v_batch from sme_import_batches where id = p_batch and org_id = p_org for update;
  if not found then perform sme_fail('NOT_FOUND', jsonb_build_object('entity', 'import_batch')); end if;
  if v_batch.status = 'committed' then
    perform sme_fail('BATCH_ALREADY_COMMITTED', jsonb_build_object('batch_id', v_batch.id, 'committed_at', v_batch.committed_at));
  end if;
  delete from sme_import_rows where batch_id = p_batch;
  update sme_import_batches set status = 'cancelled' where id = p_batch;
  perform sme_audit(p_org, 'import.cancelled', 'import_batch', p_batch, to_jsonb(v_batch), null, '{}'::jsonb, p_correlation_id);
  return sme_idem_finish(p_org, p_idem, 'import.cancel', v_input, jsonb_build_object('batch_id', p_batch, 'status', 'cancelled'));
end;
$$;

-- ── Listing gains import provenance (file name and row number) ─

create or replace function sme_transactions_page(p_org uuid, p_filter jsonb, p_limit int default 50)
returns setof jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_account uuid := sme_json_uuid(p_filter, 'account_id');
  v_category uuid := sme_json_uuid(p_filter, 'category_id');
  v_batch uuid := sme_json_uuid(p_filter, 'import_batch_id');
  v_from date := sme_json_date(p_filter, 'from', false);
  v_to date := sme_json_date(p_filter, 'to', false);
  v_channel text := nullif(p_filter ->> 'channel', '');
  v_q text := sme_json_text(p_filter, 'q', 100);
  v_after_date date := sme_json_date(p_filter -> 'after', 'value_date', false);
  v_after_created timestamptz := nullif(p_filter -> 'after' ->> 'created_at', '')::timestamptz;
  v_after_id uuid := sme_json_uuid(p_filter -> 'after', 'id');
  v_pattern text;
begin
  if v_q is not null then
    v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  select jsonb_build_object(
      'id', t.id, 'account_id', t.account_id, 'account_name', a.name, 'account_name_ar', a.name_ar,
      'value_date', t.value_date, 'amount_minor', t.amount_minor::text, 'currency', t.currency,
      'base_amount_minor', t.base_amount_minor::text, 'fx_rate', t.fx_rate::text, 'fx_rate_date', t.fx_rate_date, 'fx_source', t.fx_source,
      'description', t.description, 'external_ref', t.external_ref, 'source_kind', t.source_kind,
      'import_batch_id', t.import_batch_id, 'import_row_id', t.import_row_id, 'document_id', t.document_id,
      'import_file_name', b.file_name, 'import_row_number', ir.row_number,
      'transfer_group_id', t.transfer_group_id, 'reversal_of', t.reversal_of, 'reason', t.reason,
      'is_estimate', t.is_estimate, 'is_reversed', t.is_reversed, 'is_reversal', t.is_reversal,
      'reversal_id', (select r.id from sme_transactions r where r.reversal_of = t.id),
      'created_by', t.created_by, 'created_at', t.created_at,
      'classification', jsonb_build_object('id', t.classification_id, 'category_id', t.category_id,
        'category_code', c.code, 'category_name_en', c.name_en, 'category_name_ar', c.name_ar, 'category_kind', c.kind,
        'channel', coalesce(t.channel, 'unknown'), 'counterparty_company_id', t.counterparty_company_id,
        'counterparty_contact_id', t.counterparty_contact_id, 'note', t.classification_note,
        'classified_by', t.classified_by, 'classified_at', t.classified_at))
  from sme_transactions_current t
  join sme_accounts a on a.id = t.account_id
  left join sme_categories c on c.id = t.category_id
  left join sme_import_batches b on b.id = t.import_batch_id
  left join sme_import_rows ir on ir.id = t.import_row_id
  where t.org_id = p_org
    and (v_account is null or t.account_id = v_account)
    and (v_category is null or t.category_id = v_category)
    and (v_batch is null or t.import_batch_id = v_batch)
    and (v_from is null or t.value_date >= v_from)
    and (v_to is null or t.value_date <= v_to)
    and (v_channel is null or coalesce(t.channel, 'unknown') = v_channel)
    and (v_pattern is null or t.description ilike v_pattern or t.external_ref ilike v_pattern
         or sme_normalize_description(t.description) like '%' || sme_normalize_description(v_q) || '%')
    and (v_after_id is null or (t.value_date, t.created_at, t.id) < (v_after_date, v_after_created, v_after_id))
  order by t.value_date desc, t.created_at desc, t.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) + 1;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────

revoke all on function sme_import_evaluate(uuid, uuid) from public, anon, authenticated;
revoke all on function sme_import_lock(uuid, uuid) from public, anon, authenticated;
revoke all on function sme_import_store_rows(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function sme_import_fail(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function sme_import_store_rows(uuid, uuid, jsonb, boolean) to service_role;
grant execute on function sme_import_fail(uuid, uuid, text, jsonb) to service_role;
revoke all on function sme_create_import_batch(uuid, uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_request_import_parse(uuid, uuid, jsonb, jsonb, uuid, text) from public, anon;
revoke all on function sme_review_import_rows(uuid, uuid, jsonb, text, uuid, text) from public, anon;
revoke all on function sme_commit_import(uuid, uuid, uuid, text) from public, anon;
revoke all on function sme_cancel_import(uuid, uuid, uuid, text) from public, anon;
grant execute on function sme_create_import_batch(uuid, uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_request_import_parse(uuid, uuid, jsonb, jsonb, uuid, text) to authenticated;
grant execute on function sme_review_import_rows(uuid, uuid, jsonb, text, uuid, text) to authenticated;
grant execute on function sme_commit_import(uuid, uuid, uuid, text) to authenticated;
grant execute on function sme_cancel_import(uuid, uuid, uuid, text) to authenticated;
