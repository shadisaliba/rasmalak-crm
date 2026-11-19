-- ============================================================
-- SME LEDGER SERVICE (W2-05): FX rates, posting, reversal, transfers, classification, listing
-- ============================================================
-- Every write RPC: sme_require → idempotency → work → audit + outbox → stored response, all in
-- the caller's transaction. Base amounts are rounded once, half away from zero (numeric round()
-- semantics), and the computation is recorded in the audit payload (R5).

-- ── FX rates (global; public read, written only by the refresh cron) ─
-- rate: 1 unit of from_currency = rate units of to_currency, as published by the source.

create table fx_rates (
  date          date not null,
  from_currency char(3) not null references sme_currencies(code),
  to_currency   char(3) not null references sme_currencies(code),
  rate          numeric(24,12) not null check (rate > 0),
  source        text not null,
  fetched_at    timestamptz not null default now(),
  primary key (date, from_currency, to_currency)
);
alter table fx_rates enable row level security;
create policy fx_rates_select on fx_rates for select to anon, authenticated using (true);

-- ── Input parsing (RPCs are callable directly, so they validate their own input) ─

create or replace function sme_fail(p_code text, p_detail jsonb default null)
returns void
language plpgsql
volatile
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '{}'::jsonb)::text;
end;
$$;

create or replace function sme_json_uuid(p_obj jsonb, p_key text, p_required boolean default false)
returns uuid
language plpgsql
immutable
as $$
declare
  v text := nullif(btrim(coalesce(p_obj ->> p_key, '')), '');
begin
  if v is null then
    if p_required then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', p_key, 'reason', 'required')); end if;
    return null;
  end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', p_key, 'reason', 'invalid_uuid'));
  end if;
  return v::uuid;
end;
$$;

-- Minor units arrive as JSON strings or integers; at most 16 digits keeps them inside the
-- ±9e15 ledger bound and inside JavaScript's safe integer range.
create or replace function sme_json_minor(p_obj jsonb, p_key text, p_required boolean default true)
returns bigint
language plpgsql
immutable
as $$
declare
  v text := nullif(btrim(coalesce(p_obj ->> p_key, '')), '');
begin
  if v is null then
    if p_required then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', p_key, 'reason', 'required')); end if;
    return null;
  end if;
  if v !~ '^-?[0-9]{1,16}$' or abs(v::bigint) > 9000000000000000 then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', p_key, 'reason', 'invalid_amount'));
  end if;
  return v::bigint;
end;
$$;

create or replace function sme_json_date(p_obj jsonb, p_key text, p_required boolean default true)
returns date
language plpgsql
immutable
as $$
declare
  v text := nullif(btrim(coalesce(p_obj ->> p_key, '')), '');
  d date;
begin
  if v is null then
    if p_required then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', p_key, 'reason', 'required')); end if;
    return null;
  end if;
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', p_key, 'reason', 'invalid_date'));
  end if;
  begin
    d := v::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', p_key, 'reason', 'invalid_date'));
  end;
  return d;
end;
$$;

create or replace function sme_json_text(p_obj jsonb, p_key text, p_max int, p_required boolean default false)
returns text
language plpgsql
immutable
as $$
declare
  v text := nullif(btrim(coalesce(p_obj ->> p_key, '')), '');
begin
  if v is null and p_required then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', p_key, 'reason', 'required'));
  end if;
  if length(v) > p_max then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', p_key, 'reason', 'too_long', 'max', p_max));
  end if;
  return v;
end;
$$;

-- ── Base-currency conversion ────────────────────────────────

create or replace function sme_currency_minor_units(p_code text)
returns int
language sql
stable
as $$ select minor_units::int from sme_currencies where code = p_code; $$;

-- Recorded with every posting so a reviewer can recompute the base amount (R5).
create or replace function sme_base_trace(p_tx sme_transactions)
returns jsonb
language sql
stable
as $$
  select case when p_tx.currency = 'JOD' then
    jsonb_build_object('currency', 'JOD', 'amount_minor', p_tx.amount_minor::text, 'base_amount_minor', p_tx.base_amount_minor::text, 'conversion', 'none')
  else
    jsonb_build_object(
      'currency', p_tx.currency,
      'amount_minor', p_tx.amount_minor::text,
      'minor_units', sme_currency_minor_units(p_tx.currency),
      'rate', p_tx.fx_rate::text,
      'rate_date', p_tx.fx_rate_date,
      'source', p_tx.fx_source,
      'unrounded', (p_tx.amount_minor::numeric * p_tx.fx_rate * power(10::numeric, 3 - sme_currency_minor_units(p_tx.currency)))::text,
      'base_amount_minor', p_tx.base_amount_minor::text,
      'rounding', case when p_tx.fx_source = 'transfer:implied' then 'rate_implied_by_transfer' else 'half_away_from_zero' end)
  end;
$$;

-- Replaced in Wave 3a when payment allocations to invoices and bills exist.
create or replace function sme_transaction_allocated(p_tx uuid)
returns boolean
language sql
stable
as $$ select false; $$;

-- ── Internal: insert one ledger row ─────────────────────────
-- p_base_override is the base amount a cross-currency transfer implies for its foreign leg; the
-- stored rate is then derived from it and labelled 'transfer:implied'.

create or replace function sme_ledger_insert(
  p_org uuid, p_account_id uuid, p_value_date date, p_amount_minor bigint, p_currency text,
  p_description text, p_external_ref text, p_source_kind text, p_fx jsonb, p_is_estimate boolean,
  p_transfer_group uuid, p_key text, p_base_override bigint default null
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
      -- A sourced rate must be the stored one, so the label cannot be attached to any number.
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
    description, external_ref, source_kind, fingerprint, transfer_group_id, is_estimate, idempotency_key, created_by
  ) values (
    p_org, p_account_id, p_value_date, p_amount_minor, v_account.currency, v_base, v_rate, v_rate_date, v_source,
    coalesce(p_description, ''), p_external_ref, p_source_kind,
    sme_fingerprint(p_org, p_account_id, p_value_date, p_amount_minor, p_description, p_external_ref),
    p_transfer_group, coalesce(p_is_estimate, false), p_key, auth.uid()
  ) returning * into v_row;
  return v_row;
end;
$$;

-- ── Internal: append a classification ───────────────────────
-- p_rule_kind is the source kind whose category rules apply (a reversal follows its original).

create or replace function sme_ledger_classify(p_org uuid, p_tx sme_transactions, p_rule_kind text, p_c jsonb)
returns sme_transaction_classifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category sme_categories;
  v_company uuid := sme_json_uuid(p_c, 'counterparty_company_id');
  v_contact uuid := sme_json_uuid(p_c, 'counterparty_contact_id');
  v_category_id uuid := sme_json_uuid(p_c, 'category_id');
  v_channel text := coalesce(nullif(p_c ->> 'channel', ''), 'unknown');
  v_row sme_transaction_classifications;
begin
  if v_category_id is null and p_rule_kind in ('transfer', 'opening_balance') then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'category_id', 'reason', 'required'));
  end if;
  if v_category_id is not null then
    select * into v_category from sme_categories where id = v_category_id and (org_id is null or org_id = p_org) and active;
    if not found then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'category_id', 'reason', 'unknown_category')); end if;
    -- R7: an own-account transfer is never income or expense; opening balances never count as income.
    if (p_rule_kind = 'transfer' and v_category.kind <> 'transfer')
       or (p_rule_kind = 'opening_balance' and v_category.kind <> 'opening_balance')
       or (p_rule_kind not in ('transfer', 'opening_balance') and v_category.kind = 'opening_balance') then
      perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'category_id', 'reason', 'category_kind_not_allowed', 'kind', v_category.kind));
    end if;
  end if;
  if v_channel not in ('cash','bank_transfer','cliq','wallet','pos_card','cheque','efawateercom','direct_debit','other','unknown') then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'channel', 'reason', 'unknown_channel'));
  end if;
  if v_company is not null and not exists (select 1 from crm_companies where id = v_company and org_id = p_org) then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'counterparty_company_id', 'reason', 'not_found'));
  end if;
  if v_contact is not null and not exists (select 1 from crm_contacts where id = v_contact and org_id = p_org) then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'counterparty_contact_id', 'reason', 'not_found'));
  end if;

  -- clock_timestamp, not now(): several classifications of one row can happen in one transaction
  -- (posting then reclassifying, or a pair), and the latest must sort last.
  insert into sme_transaction_classifications (org_id, transaction_id, category_id, counterparty_company_id, counterparty_contact_id, channel, note, classified_by, classified_at)
  values (p_org, p_tx.id, v_category_id, v_company, v_contact, v_channel, sme_json_text(p_c, 'note', 1000), auth.uid(), clock_timestamp())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function sme_system_category(p_code text)
returns uuid
language sql
stable
as $$ select id from sme_categories where org_id is null and code = p_code; $$;

-- ── Accounts ────────────────────────────────────────────────

create or replace function sme_create_account(p_org uuid, p_account jsonb, p_opening jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('account', p_account, 'opening', p_opening);
  v_replay jsonb;
  v_kind text;
  v_name text;
  v_currency text;
  v_account sme_accounts;
  v_tx sme_transactions;
  v_cls sme_transaction_classifications;
  v_amount bigint;
begin
  perform sme_require(p_org, 'sme.ledger.post');
  if jsonb_typeof(p_account) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'ledger.account.create', v_input);
  if v_replay is not null then return v_replay; end if;

  v_kind := p_account ->> 'kind';
  v_name := sme_json_text(p_account, 'name', 120, true);
  v_currency := upper(coalesce(p_account ->> 'currency', ''));
  if v_kind is null or v_kind not in ('bank','cash','wallet','card','other') then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'kind', 'reason', 'invalid'));
  end if;
  if not exists (select 1 from sme_currencies where code = v_currency) then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'currency', 'reason', 'unsupported'));
  end if;
  if exists (select 1 from sme_accounts where org_id = p_org and name = v_name) then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'name', 'reason', 'duplicate'));
  end if;

  insert into sme_accounts (org_id, kind, name, name_ar, institution, currency, created_by)
  values (p_org, v_kind, v_name, sme_json_text(p_account, 'name_ar', 120), sme_json_text(p_account, 'institution', 120), v_currency, auth.uid())
  returning * into v_account;
  perform sme_audit(p_org, 'ledger.account.created', 'account', v_account.id, null, to_jsonb(v_account), '{}'::jsonb, p_correlation_id);
  perform sme_emit(p_org, 'AccountCreated', jsonb_build_object('accountId', v_account.id, 'currency', v_account.currency, 'kind', v_account.kind), 'account:' || v_account.id);

  v_amount := case when jsonb_typeof(p_opening) = 'object' then sme_json_minor(p_opening, 'amount_minor', false) end;
  if v_amount is not null and v_amount <> 0 then
    v_tx := sme_ledger_insert(p_org, v_account.id, sme_json_date(p_opening, 'value_date'), v_amount, null,
      '', null, 'opening_balance', p_opening -> 'fx',
      coalesce(p_opening -> 'is_estimate' <> 'false'::jsonb, true), null, p_idem || ':opening');
    v_cls := sme_ledger_classify(p_org, v_tx, 'opening_balance', jsonb_build_object('category_id', sme_system_category('opening_balance')));
    perform sme_audit(p_org, 'ledger.transaction.posted', 'transaction', v_tx.id, null, to_jsonb(v_tx),
      jsonb_build_object('base', sme_base_trace(v_tx), 'classification_id', v_cls.id), p_correlation_id, p_opening -> 'fx' ->> 'reason');
    perform sme_emit(p_org, 'TransactionPosted', jsonb_build_object('transactionId', v_tx.id, 'accountId', v_tx.account_id,
      'valueDate', v_tx.value_date, 'amountMinor', v_tx.amount_minor::text, 'currency', v_tx.currency, 'sourceKind', v_tx.source_kind), 'tx:' || v_tx.id);
  end if;

  return sme_idem_finish(p_org, p_idem, 'ledger.account.create', v_input,
    jsonb_build_object('account_id', v_account.id, 'opening_transaction_id', v_tx.id));
end;
$$;

-- ── Posting ─────────────────────────────────────────────────

create or replace function sme_post_transaction(p_org uuid, p_tx jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_tx sme_transactions;
  v_cls sme_transaction_classifications;
  v_duplicate boolean;
begin
  perform sme_require(p_org, 'sme.ledger.post');
  if jsonb_typeof(p_tx) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'ledger.transaction.post', p_tx);
  if v_replay is not null then return v_replay; end if;

  v_tx := sme_ledger_insert(p_org, sme_json_uuid(p_tx, 'account_id', true), sme_json_date(p_tx, 'value_date'),
    sme_json_minor(p_tx, 'amount_minor'), nullif(upper(coalesce(p_tx ->> 'currency', '')), ''),
    coalesce(sme_json_text(p_tx, 'description', 500), ''), sme_json_text(p_tx, 'external_ref', 120),
    'manual', p_tx -> 'fx', false, null, p_idem);
  v_cls := sme_ledger_classify(p_org, v_tx, 'manual', coalesce(p_tx -> 'classification', '{}'::jsonb));
  v_duplicate := exists (select 1 from sme_transactions where org_id = p_org and fingerprint = v_tx.fingerprint and id <> v_tx.id);

  perform sme_audit(p_org, 'ledger.transaction.posted', 'transaction', v_tx.id, null, to_jsonb(v_tx),
    jsonb_build_object('base', sme_base_trace(v_tx), 'classification_id', v_cls.id), p_correlation_id, p_tx -> 'fx' ->> 'reason');
  perform sme_emit(p_org, 'TransactionPosted', jsonb_build_object('transactionId', v_tx.id, 'accountId', v_tx.account_id,
    'valueDate', v_tx.value_date, 'amountMinor', v_tx.amount_minor::text, 'currency', v_tx.currency, 'sourceKind', v_tx.source_kind), 'tx:' || v_tx.id);

  return sme_idem_finish(p_org, p_idem, 'ledger.transaction.post', p_tx, jsonb_build_object(
    'transaction_id', v_tx.id, 'base_amount_minor', v_tx.base_amount_minor::text, 'possible_duplicate', v_duplicate));
end;
$$;

-- ── Reversal ────────────────────────────────────────────────
-- A transfer is reversed as a pair, so cash stays consistent across both accounts. The reversal
-- keeps the original value date: balances on every date then read as if it never happened.

create or replace function sme_reverse_transaction(p_org uuid, p_tx_id uuid, p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_input jsonb := jsonb_build_object('transaction_id', p_tx_id, 'reason', p_reason);
  v_replay jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_orig sme_transactions;
  v_leg sme_transactions;
  v_new sme_transactions;
  v_current sme_transaction_classifications;
  v_ids uuid[] := '{}';
begin
  perform sme_require(p_org, 'sme.ledger.reverse');
  if v_reason = '' or length(v_reason) > 500 then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'reason', 'reason', case when v_reason = '' then 'required' else 'too_long' end));
  end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'ledger.transaction.reverse', v_input);
  if v_replay is not null then return v_replay; end if;

  select * into v_orig from sme_transactions where id = p_tx_id and org_id = p_org for update;
  if not found then perform sme_fail('NOT_FOUND', jsonb_build_object('entity', 'transaction')); end if;
  if v_orig.source_kind = 'reversal' then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'transaction_id', 'reason', 'is_reversal'));
  end if;

  for v_leg in
    select * from sme_transactions
    where org_id = p_org and (id = p_tx_id or (v_orig.transfer_group_id is not null and transfer_group_id = v_orig.transfer_group_id))
    order by amount_minor, id
    for update
  loop
    if exists (select 1 from sme_transactions where reversal_of = v_leg.id) then
      perform sme_fail('ALREADY_REVERSED', jsonb_build_object('transaction_id', v_leg.id));
    end if;
    if sme_transaction_allocated(v_leg.id) then
      perform sme_fail('ALLOCATED_REVERSE_FIRST', jsonb_build_object('transaction_id', v_leg.id));
    end if;
    if exists (select 1 from sme_transactions where org_id = p_org and idempotency_key = p_idem || ':' || v_leg.id) then
      perform sme_fail('IDEMPOTENCY_CONFLICT');
    end if;

    insert into sme_transactions (
      org_id, account_id, value_date, amount_minor, currency, base_amount_minor, fx_rate, fx_rate_date, fx_source,
      description, source_kind, fingerprint, reversal_of, reason, is_estimate, idempotency_key, created_by
    ) values (
      p_org, v_leg.account_id, v_leg.value_date, -v_leg.amount_minor, v_leg.currency, -v_leg.base_amount_minor,
      v_leg.fx_rate, v_leg.fx_rate_date, v_leg.fx_source, v_leg.description, 'reversal',
      sme_fingerprint(p_org, v_leg.account_id, v_leg.value_date, -v_leg.amount_minor, v_leg.description, null),
      v_leg.id, v_reason, v_leg.is_estimate, p_idem || ':' || v_leg.id, auth.uid()
    ) returning * into v_new;

    -- The reversal carries the original's category so per-category totals net to zero.
    select * into v_current from sme_transaction_classifications where transaction_id = v_leg.id order by classified_at desc, id desc limit 1;
    insert into sme_transaction_classifications (org_id, transaction_id, category_id, counterparty_company_id, counterparty_contact_id, channel, note, classified_by, classified_at)
    values (p_org, v_new.id, v_current.category_id, v_current.counterparty_company_id, v_current.counterparty_contact_id,
            coalesce(v_current.channel, 'unknown'), v_current.note, auth.uid(), clock_timestamp());

    perform sme_audit(p_org, 'ledger.transaction.reversed', 'transaction', v_leg.id, to_jsonb(v_leg), to_jsonb(v_new),
      jsonb_build_object('reversal_id', v_new.id, 'base', sme_base_trace(v_new)), p_correlation_id, v_reason);
    perform sme_emit(p_org, 'TransactionReversed', jsonb_build_object('transactionId', v_leg.id, 'reversalId', v_new.id,
      'accountId', v_leg.account_id), 'reversal:' || v_leg.id);
    v_ids := array_append(v_ids, v_new.id);
  end loop;

  return sme_idem_finish(p_org, p_idem, 'ledger.transaction.reverse', v_input, jsonb_build_object('reversal_ids', to_jsonb(v_ids)));
end;
$$;

-- ── Transfers between own accounts ──────────────────────────
-- Same currency: the legs net to zero. Cross currency: both amounts are given; the JOD leg (or,
-- with neither in JOD, the converted source leg) fixes the base amount, so a transfer never
-- changes total cash in the base currency.

create or replace function sme_post_transfer(p_org uuid, p_from uuid, p_to uuid, p_transfer jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('from', p_from, 'to', p_to, 'transfer', p_transfer);
  v_replay jsonb;
  v_from sme_accounts;
  v_to sme_accounts;
  v_amount bigint;
  v_to_amount bigint;
  v_date date;
  v_desc text;
  v_group uuid := gen_random_uuid();
  v_out sme_transactions;
  v_in sme_transactions;
  v_cls jsonb;
begin
  perform sme_require(p_org, 'sme.ledger.post');
  if jsonb_typeof(p_transfer) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'ledger.transfer.post', v_input);
  if v_replay is not null then return v_replay; end if;

  if p_from is null or p_to is null or p_from = p_to then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'to_account_id', 'reason', 'same_account'));
  end if;
  select * into v_from from sme_accounts where id = p_from and org_id = p_org;
  if not found then perform sme_fail('NOT_FOUND', jsonb_build_object('entity', 'account', 'field', 'from_account_id')); end if;
  select * into v_to from sme_accounts where id = p_to and org_id = p_org;
  if not found then perform sme_fail('NOT_FOUND', jsonb_build_object('entity', 'account', 'field', 'to_account_id')); end if;

  v_amount := sme_json_minor(p_transfer, 'amount_minor');
  if v_amount <= 0 then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'amount_minor', 'reason', 'must_be_positive')); end if;
  v_date := sme_json_date(p_transfer, 'value_date');
  v_desc := coalesce(sme_json_text(p_transfer, 'description', 500), '');
  v_cls := jsonb_build_object('category_id', sme_system_category('transfer'), 'channel', coalesce(p_transfer ->> 'channel', 'bank_transfer'));

  if v_from.currency = v_to.currency then
    v_out := sme_ledger_insert(p_org, p_from, v_date, -v_amount, null, v_desc, null, 'transfer', p_transfer -> 'fx', false, v_group, p_idem || ':out');
    v_in := sme_ledger_insert(p_org, p_to, v_date, v_amount, null, v_desc, null, 'transfer', p_transfer -> 'fx', false, v_group, p_idem || ':in');
  else
    v_to_amount := sme_json_minor(p_transfer, 'to_amount_minor');
    if v_to_amount <= 0 then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'to_amount_minor', 'reason', 'must_be_positive')); end if;
    if v_from.currency = 'JOD' then
      v_out := sme_ledger_insert(p_org, p_from, v_date, -v_amount, null, v_desc, null, 'transfer', null, false, v_group, p_idem || ':out');
      v_in := sme_ledger_insert(p_org, p_to, v_date, v_to_amount, null, v_desc, null, 'transfer', null, false, v_group, p_idem || ':in', v_amount);
    elsif v_to.currency = 'JOD' then
      v_out := sme_ledger_insert(p_org, p_from, v_date, -v_amount, null, v_desc, null, 'transfer', null, false, v_group, p_idem || ':out', -v_to_amount);
      v_in := sme_ledger_insert(p_org, p_to, v_date, v_to_amount, null, v_desc, null, 'transfer', null, false, v_group, p_idem || ':in');
    else
      v_out := sme_ledger_insert(p_org, p_from, v_date, -v_amount, null, v_desc, null, 'transfer', p_transfer -> 'fx', false, v_group, p_idem || ':out');
      v_in := sme_ledger_insert(p_org, p_to, v_date, v_to_amount, null, v_desc, null, 'transfer', null, false, v_group, p_idem || ':in', -v_out.base_amount_minor);
    end if;
  end if;

  perform sme_ledger_classify(p_org, v_out, 'transfer', v_cls);
  perform sme_ledger_classify(p_org, v_in, 'transfer', v_cls);
  perform sme_audit(p_org, 'ledger.transfer.posted', 'transfer', v_group, null,
    jsonb_build_object('out', to_jsonb(v_out), 'in', to_jsonb(v_in)),
    jsonb_build_object('out_base', sme_base_trace(v_out), 'in_base', sme_base_trace(v_in)), p_correlation_id, p_transfer -> 'fx' ->> 'reason');
  perform sme_emit(p_org, 'TransactionPosted', jsonb_build_object('transactionId', v_out.id, 'accountId', v_out.account_id,
    'valueDate', v_out.value_date, 'amountMinor', v_out.amount_minor::text, 'currency', v_out.currency, 'sourceKind', 'transfer', 'transferGroupId', v_group), 'tx:' || v_out.id);
  perform sme_emit(p_org, 'TransactionPosted', jsonb_build_object('transactionId', v_in.id, 'accountId', v_in.account_id,
    'valueDate', v_in.value_date, 'amountMinor', v_in.amount_minor::text, 'currency', v_in.currency, 'sourceKind', 'transfer', 'transferGroupId', v_group), 'tx:' || v_in.id);

  return sme_idem_finish(p_org, p_idem, 'ledger.transfer.post', v_input, jsonb_build_object(
    'transfer_group_id', v_group, 'out_transaction_id', v_out.id, 'in_transaction_id', v_in.id));
end;
$$;

-- ── Classification ──────────────────────────────────────────
-- A transaction and its reversal are classified together so their totals keep netting out.

create or replace function sme_classify_transaction(p_org uuid, p_tx_id uuid, p_classification jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('transaction_id', p_tx_id, 'classification', p_classification);
  v_replay jsonb;
  v_tx sme_transactions;
  v_orig sme_transactions;
  v_reversal sme_transactions;
  v_before sme_transaction_classifications;
  v_cls sme_transaction_classifications;
begin
  perform sme_require(p_org, 'sme.ledger.post');
  if jsonb_typeof(p_classification) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'ledger.transaction.classify', v_input);
  if v_replay is not null then return v_replay; end if;

  select * into v_tx from sme_transactions where id = p_tx_id and org_id = p_org;
  if not found then perform sme_fail('NOT_FOUND', jsonb_build_object('entity', 'transaction')); end if;
  if v_tx.source_kind = 'reversal' then
    select * into v_orig from sme_transactions where id = v_tx.reversal_of;
  else
    v_orig := v_tx;
  end if;
  select * into v_reversal from sme_transactions where reversal_of = v_orig.id;
  select * into v_before from sme_transaction_classifications where transaction_id = v_orig.id order by classified_at desc, id desc limit 1;

  v_cls := sme_ledger_classify(p_org, v_orig, v_orig.source_kind, p_classification);
  if v_reversal.id is not null then
    perform sme_ledger_classify(p_org, v_reversal, v_orig.source_kind, p_classification);
  end if;

  perform sme_audit(p_org, 'ledger.transaction.classified', 'transaction', v_orig.id,
    case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_cls),
    jsonb_build_object('reversal_id', v_reversal.id), p_correlation_id);
  perform sme_emit(p_org, 'TransactionClassified', jsonb_build_object('transactionId', v_orig.id, 'classificationId', v_cls.id,
    'categoryId', v_cls.category_id), 'classification:' || v_cls.id);

  return sme_idem_finish(p_org, p_idem, 'ledger.transaction.classify', v_input, jsonb_build_object('classification_id', v_cls.id));
end;
$$;

-- ── Listing (security invoker: RLS decides what the caller sees) ─
-- Keyset pagination on (value_date, created_at, id) descending. Returns up to p_limit + 1 rows
-- so the caller knows whether another page exists. W2-06 adds import file names here.

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
  where t.org_id = p_org
    and (v_account is null or t.account_id = v_account)
    and (v_category is null or t.category_id = v_category)
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

revoke all on function sme_ledger_insert(uuid, uuid, date, bigint, text, text, text, text, jsonb, boolean, uuid, text, bigint) from public, anon, authenticated;
revoke all on function sme_ledger_classify(uuid, sme_transactions, text, jsonb) from public, anon, authenticated;
revoke all on function sme_create_account(uuid, jsonb, jsonb, uuid, text) from public, anon;
revoke all on function sme_post_transaction(uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_reverse_transaction(uuid, uuid, text, uuid, text) from public, anon;
revoke all on function sme_post_transfer(uuid, uuid, uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_classify_transaction(uuid, uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_transactions_page(uuid, jsonb, int) from public, anon;
grant execute on function sme_create_account(uuid, jsonb, jsonb, uuid, text) to authenticated;
grant execute on function sme_post_transaction(uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_reverse_transaction(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function sme_post_transfer(uuid, uuid, uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_classify_transaction(uuid, uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_transactions_page(uuid, jsonb, int) to authenticated;
