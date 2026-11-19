-- ============================================================
-- SME RECEIVABLES REGISTER (W3a-02)
-- ============================================================
-- Records of invoices issued elsewhere (§1.3 default, pending gate G6): not tax invoices and
-- never submitted to JoFotara. Invoices never change cash (R7); only allocating a posted receipt
-- reduces what is outstanding.

create table sme_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  number text not null,
  customer_company_id uuid references crm_companies(id),
  customer_contact_id uuid references crm_contacts(id),
  issue_date date not null,
  due_date date not null,
  currency char(3) not null references sme_currencies(code),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),   -- as entered by the user
  total_minor bigint not null check (total_minor > 0),
  status text not null default 'draft' check (status in ('draft','open','void','written_off')),
  source_document_id uuid references crm_documents(id),
  notes text,
  status_reason text,
  status_changed_by uuid references auth.users(id),
  status_changed_at timestamptz,
  idempotency_key text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, number),
  unique (org_id, idempotency_key),
  check (customer_company_id is not null or customer_contact_id is not null),
  check (due_date >= issue_date),
  check (total_minor = subtotal_minor + tax_minor)
);
create index sme_invoices_org_due_idx on sme_invoices (org_id, status, due_date);

create table sme_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, invoice_id uuid not null references sme_invoices(id),
  position int not null,
  description text not null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  tax_rate_bp int not null default 0 check (tax_rate_bp between 0 and 10000),
  line_subtotal_minor bigint not null,
  line_tax_minor bigint not null,
  unique (invoice_id, position)
);

create table sme_invoice_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  invoice_id uuid not null references sme_invoices(id),
  transaction_id uuid not null references sme_transactions(id),
  amount_minor bigint not null check (amount_minor <> 0),
  reversal_of uuid unique references sme_invoice_allocations(id),
  reason text,
  idempotency_key text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key),
  check ((reversal_of is null) = (amount_minor > 0))
);
create index sme_invoice_allocations_tx_idx on sme_invoice_allocations (transaction_id);
create index sme_invoice_allocations_invoice_idx on sme_invoice_allocations (invoice_id);

alter table sme_invoices enable row level security;
alter table sme_invoice_lines enable row level security;
alter table sme_invoice_allocations enable row level security;
create policy sme_invoices_select on sme_invoices for select to authenticated using (sme_has_perm(org_id, 'sme.receivables.read'));
create policy sme_invoice_lines_select on sme_invoice_lines for select to authenticated using (sme_has_perm(org_id, 'sme.receivables.read'));
create policy sme_invoice_allocations_select on sme_invoice_allocations for select to authenticated using (sme_has_perm(org_id, 'sme.receivables.read'));

-- ── Immutability once issued ────────────────────────────────

create or replace function sme_invoice_lines_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from sme_invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'draft' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"invoice_not_draft"}';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger sme_invoice_lines_guard before insert or update or delete on sme_invoice_lines
  for each row execute function sme_invoice_lines_guard();

-- Once open, only the status fields may change.
create or replace function sme_invoices_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'LEDGER_IMMUTABLE', detail = '{"table":"sme_invoices"}';
  end if;
  if old.status <> 'draft' and (
       new.number, new.customer_company_id, new.customer_contact_id, new.issue_date, new.due_date, new.currency,
       new.subtotal_minor, new.tax_minor, new.total_minor, new.source_document_id, new.notes, new.org_id, new.created_by, new.idempotency_key)
     is distinct from (
       old.number, old.customer_company_id, old.customer_contact_id, old.issue_date, old.due_date, old.currency,
       old.subtotal_minor, old.tax_minor, old.total_minor, old.source_document_id, old.notes, old.org_id, old.created_by, old.idempotency_key) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"invoice_not_draft"}';
  end if;
  return new;
end;
$$;
create trigger sme_invoices_guard before update or delete on sme_invoices
  for each row execute function sme_invoices_guard();

create trigger sme_invoice_allocations_immutable before update or delete on sme_invoice_allocations
  for each row execute function sme_ledger_immutable();
create trigger sme_invoice_allocations_no_truncate before truncate on sme_invoice_allocations
  for each statement execute function sme_ledger_immutable();

-- ── Derived balances (paid and overdue are never stored) ────

create view sme_invoice_balances with (security_invoker = true) as
select
  i.id as invoice_id, i.org_id, i.number, i.customer_company_id, i.customer_contact_id,
  i.issue_date, i.due_date, i.currency, i.total_minor, i.status,
  coalesce(a.allocated, 0)::bigint as allocated_minor,
  (i.total_minor - coalesce(a.allocated, 0))::bigint as outstanding_minor,
  case
    when i.status in ('draft', 'void', 'written_off') then i.status
    when i.total_minor - coalesce(a.allocated, 0) <= 0 then 'paid'
    when i.due_date < current_date then 'overdue'
    when coalesce(a.allocated, 0) > 0 then 'partially_paid'
    else 'open'
  end as derived_status,
  case when i.status = 'open' and i.total_minor - coalesce(a.allocated, 0) > 0 and i.due_date < current_date
       then current_date - i.due_date else 0 end as days_overdue
from sme_invoices i
left join (select invoice_id, sum(amount_minor) as allocated from sme_invoice_allocations group by invoice_id) a on a.invoice_id = i.id;

-- Net amount of a transaction already allocated to invoices (bills join in W3a-03).
create or replace function sme_transaction_allocated_minor(p_tx uuid)
returns bigint
language sql
stable
as $$ select coalesce(sum(amount_minor), 0)::bigint from sme_invoice_allocations where transaction_id = p_tx; $$;

-- W2-05 seam: a transaction with live allocations is reversed only after they are.
create or replace function sme_transaction_allocated(p_tx uuid)
returns boolean
language sql
stable
as $$ select sme_transaction_allocated_minor(p_tx) <> 0; $$;

-- Receipts that still have an unallocated amount, for the allocation picker (RLS applies).
create or replace function sme_unallocated_receipts(p_org uuid, p_currency text)
returns table (transaction_id uuid, account_id uuid, account_name text, value_date date, description text,
               amount_minor text, unallocated_minor text)
language sql
stable
security invoker
set search_path = public
as $$
  select t.id, t.account_id, a.name, t.value_date, t.description, t.amount_minor::text,
         (t.amount_minor - sme_transaction_allocated_minor(t.id))::text
  from sme_transactions_current t
  join sme_accounts a on a.id = t.account_id
  where t.org_id = p_org and t.currency = p_currency and t.amount_minor > 0
    and t.source_kind in ('manual', 'import', 'document') and not t.is_reversed and not t.is_reversal
    and t.amount_minor - sme_transaction_allocated_minor(t.id) > 0
  order by t.value_date desc, t.created_at desc
  limit 200;
$$;

-- Finance tab of a customer: open invoices, outstanding per currency, and the median number of
-- days from issue to full payment over paid invoices (the latest receipt's value date).
create or replace function sme_party_receivables_summary(p_org uuid, p_company uuid, p_contact uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with mine as (
    select b.* from sme_invoice_balances b
    where b.org_id = p_org
      and ((p_company is not null and b.customer_company_id = p_company) or (p_contact is not null and b.customer_contact_id = p_contact))
  ), paid as (
    select m.invoice_id, max(t.value_date) - m.issue_date as days
    from mine m
    join sme_invoice_allocations a on a.invoice_id = m.invoice_id and a.reversal_of is null
      and not exists (select 1 from sme_invoice_allocations r where r.reversal_of = a.id)
    join sme_transactions t on t.id = a.transaction_id
    where m.derived_status = 'paid'
    group by m.invoice_id, m.issue_date
  )
  select jsonb_build_object(
    'open_count', (select count(*) from mine where derived_status in ('open', 'partially_paid', 'overdue')),
    'overdue_count', (select count(*) from mine where derived_status = 'overdue'),
    'outstanding', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'minor', total::text)) from (
        select currency, sum(outstanding_minor) as total from mine
        where derived_status in ('open', 'partially_paid', 'overdue') group by currency) o), '[]'::jsonb),
    'paid_count', (select count(*) from paid),
    'median_days_to_pay', (select percentile_disc(0.5) within group (order by days) from paid));
$$;

-- ── Helpers ─────────────────────────────────────────────────

create or replace function sme_require_party_in_org(p_org uuid, p_company uuid, p_contact uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_company is null and p_contact is null then
    perform sme_fail('VALIDATION_FAILED', '{"field":"party","reason":"required"}');
  end if;
  if p_company is not null and not exists (select 1 from crm_companies where id = p_company and org_id = p_org) then
    perform sme_fail('NOT_FOUND', '{"entity":"company"}');
  end if;
  if p_contact is not null and not exists (select 1 from crm_contacts where id = p_contact and org_id = p_org) then
    perform sme_fail('NOT_FOUND', '{"entity":"contact"}');
  end if;
end;
$$;

create or replace function sme_next_invoice_number(p_org uuid, p_year int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_number text;
begin
  select coalesce(max(substring(number from '^INV-' || p_year || '-([0-9]+)$')::int), 0) + 1 into v_n
  from sme_invoices where org_id = p_org and number ~ ('^INV-' || p_year || '-[0-9]+$');
  v_number := 'INV-' || p_year || '-' || lpad(v_n::text, 4, '0');
  return v_number;
end;
$$;

-- Line arithmetic in SQL: quantity × unit price, then tax at the line's rate, each rounded once
-- half away from zero (numeric round). The rate is whatever the user entered; none is supplied.
create or replace function sme_invoice_line_amounts(p_quantity numeric, p_unit_price_minor bigint, p_tax_rate_bp int)
returns table (line_subtotal_minor bigint, line_tax_minor bigint)
language sql
immutable
as $$
  select round(p_quantity * p_unit_price_minor)::bigint,
         round(round(p_quantity * p_unit_price_minor) * p_tax_rate_bp / 10000.0)::bigint;
$$;

-- ── Create ──────────────────────────────────────────────────

create or replace function sme_create_invoice(p_org uuid, p_invoice jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_company uuid;
  v_contact uuid;
  v_issue date;
  v_due date;
  v_currency text;
  v_status text;
  v_number text;
  v_lines jsonb;
  v_line jsonb;
  v_position int := 0;
  v_qty numeric;
  v_price bigint;
  v_rate int;
  v_amounts record;
  v_subtotal bigint := 0;
  v_tax bigint := 0;
  v_invoice sme_invoices;
begin
  perform sme_require(p_org, 'sme.receivables.write');
  if jsonb_typeof(p_invoice) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'receivables.invoice.create', p_invoice);
  if v_replay is not null then return v_replay; end if;

  v_company := sme_json_uuid(p_invoice, 'customer_company_id');
  v_contact := sme_json_uuid(p_invoice, 'customer_contact_id');
  perform sme_require_party_in_org(p_org, v_company, v_contact);
  v_issue := sme_json_date(p_invoice, 'issue_date');
  v_due := sme_json_date(p_invoice, 'due_date');
  if v_due < v_issue then perform sme_fail('VALIDATION_FAILED', '{"field":"due_date","reason":"before_issue_date"}'); end if;
  v_currency := upper(coalesce(p_invoice ->> 'currency', 'JOD'));
  if not exists (select 1 from sme_currencies where code = v_currency) then perform sme_fail('VALIDATION_FAILED', '{"field":"currency"}'); end if;
  v_status := coalesce(p_invoice ->> 'status', 'draft');
  if v_status not in ('draft', 'open') then perform sme_fail('VALIDATION_FAILED', '{"field":"status"}'); end if;
  v_number := sme_json_text(p_invoice, 'number', 60);
  if v_number is null then v_number := sme_next_invoice_number(p_org, extract(year from v_issue)::int); end if;
  if exists (select 1 from sme_invoices where org_id = p_org and number = v_number) then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'number', 'reason', 'duplicate'));
  end if;

  v_lines := p_invoice -> 'lines';
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) = 0 or jsonb_array_length(v_lines) > 200 then
    perform sme_fail('VALIDATION_FAILED', '{"field":"lines"}');
  end if;

  insert into sme_invoices (org_id, number, customer_company_id, customer_contact_id, issue_date, due_date, currency,
                            subtotal_minor, tax_minor, total_minor, status, notes, idempotency_key, created_by,
                            status_changed_by, status_changed_at)
  -- Totals are placeholders until the lines are in; the row stays a draft until then.
  values (p_org, v_number, v_company, v_contact, v_issue, v_due, v_currency, 1, 0, 1, 'draft',
          sme_json_text(p_invoice, 'notes', 2000), p_idem, auth.uid(), auth.uid(), now())
  returning * into v_invoice;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_position := v_position + 1;
    if coalesce(v_line ->> 'quantity', '') !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$' or (v_line ->> 'quantity')::numeric <= 0 then
      perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'lines.quantity', 'position', v_position));
    end if;
    v_qty := (v_line ->> 'quantity')::numeric;
    v_price := sme_json_minor(v_line, 'unit_price_minor');
    if v_price < 0 then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'lines.unit_price_minor', 'position', v_position)); end if;
    v_rate := coalesce(nullif(v_line ->> 'tax_rate_bp', '')::int, 0);
    if v_rate < 0 or v_rate > 10000 then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('field', 'lines.tax_rate_bp', 'position', v_position)); end if;
    select * into v_amounts from sme_invoice_line_amounts(v_qty, v_price, v_rate);
    insert into sme_invoice_lines (org_id, invoice_id, position, description, quantity, unit_price_minor, tax_rate_bp, line_subtotal_minor, line_tax_minor)
    values (p_org, v_invoice.id, v_position, coalesce(sme_json_text(v_line, 'description', 500, true), ''), v_qty, v_price, v_rate,
            v_amounts.line_subtotal_minor, v_amounts.line_tax_minor);
    v_subtotal := v_subtotal + v_amounts.line_subtotal_minor;
    v_tax := v_tax + v_amounts.line_tax_minor;
  end loop;

  if v_subtotal + v_tax <= 0 then perform sme_fail('VALIDATION_FAILED', '{"field":"lines","reason":"zero_total"}'); end if;
  -- The client shows totals before saving; they must be the ones the database computes.
  if p_invoice ? 'expected' and (
       sme_json_minor(p_invoice -> 'expected', 'subtotal_minor') <> v_subtotal
       or sme_json_minor(p_invoice -> 'expected', 'tax_minor') <> v_tax
       or sme_json_minor(p_invoice -> 'expected', 'total_minor') <> v_subtotal + v_tax) then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'totals_mismatch',
      'subtotal_minor', v_subtotal::text, 'tax_minor', v_tax::text, 'total_minor', (v_subtotal + v_tax)::text));
  end if;

  update sme_invoices set subtotal_minor = v_subtotal, tax_minor = v_tax, total_minor = v_subtotal + v_tax, status = v_status
   where id = v_invoice.id returning * into v_invoice;

  -- Invoicing someone makes them a customer.
  if v_company is not null then
    update crm_companies set party_roles = array_append(party_roles, 'customer') where id = v_company and not ('customer' = any (party_roles));
  else
    update crm_contacts set party_roles = array_append(party_roles, 'customer') where id = v_contact and not ('customer' = any (party_roles));
  end if;

  perform sme_audit(p_org, 'receivables.invoice.created', 'invoice', v_invoice.id, null, to_jsonb(v_invoice),
    jsonb_build_object('lines', v_position, 'total_minor', v_invoice.total_minor::text), p_correlation_id);
  perform sme_emit(p_org, 'InvoiceStatusChanged', jsonb_build_object('invoiceId', v_invoice.id, 'status', v_invoice.status), 'invoice:' || v_invoice.id || ':created');
  return sme_idem_finish(p_org, p_idem, 'receivables.invoice.create', p_invoice, jsonb_build_object(
    'invoice_id', v_invoice.id, 'number', v_invoice.number, 'status', v_invoice.status,
    'subtotal_minor', v_invoice.subtotal_minor::text, 'tax_minor', v_invoice.tax_minor::text, 'total_minor', v_invoice.total_minor::text));
end;
$$;

-- ── Status changes ──────────────────────────────────────────

create or replace function sme_invoice_set_status(p_org uuid, p_invoice uuid, p_to text, p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('invoice', p_invoice, 'to', p_to, 'reason', p_reason);
  v_replay jsonb;
  v_before sme_invoices;
  v_after sme_invoices;
  v_allocated bigint;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform sme_require(p_org, 'sme.receivables.write');
  v_replay := sme_idem_begin(p_org, p_idem, 'receivables.invoice.' || p_to, v_input);
  if v_replay is not null then return v_replay; end if;

  select * into v_before from sme_invoices where id = p_invoice and org_id = p_org for update;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"invoice"}'); end if;
  select coalesce(sum(amount_minor), 0) into v_allocated from sme_invoice_allocations where invoice_id = p_invoice;

  if p_to = 'open' then
    if v_before.status <> 'draft' then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'status', 'status', v_before.status)); end if;
  elsif p_to = 'void' then
    if v_before.status not in ('draft', 'open') then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'status', 'status', v_before.status)); end if;
    if v_allocated <> 0 then perform sme_fail('ALLOCATED_REVERSE_FIRST', jsonb_build_object('allocated_minor', v_allocated::text)); end if;
    if v_reason is null then perform sme_fail('VALIDATION_FAILED', '{"field":"reason","reason":"required"}'); end if;
  elsif p_to = 'written_off' then
    if v_before.status <> 'open' then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'status', 'status', v_before.status)); end if;
    if v_before.total_minor - v_allocated <= 0 then perform sme_fail('VALIDATION_FAILED', '{"reason":"nothing_outstanding"}'); end if;
    if v_reason is null then perform sme_fail('VALIDATION_FAILED', '{"field":"reason","reason":"required"}'); end if;
  else
    perform sme_fail('VALIDATION_FAILED', '{"field":"status"}');
  end if;

  update sme_invoices set status = p_to, status_reason = v_reason, status_changed_by = auth.uid(), status_changed_at = now()
   where id = p_invoice returning * into v_after;
  perform sme_audit(p_org, 'receivables.invoice.' || p_to, 'invoice', p_invoice, to_jsonb(v_before), to_jsonb(v_after),
    jsonb_build_object('from', v_before.status, 'to', p_to), p_correlation_id, v_reason);
  perform sme_emit(p_org, 'InvoiceStatusChanged', jsonb_build_object('invoiceId', p_invoice, 'status', p_to), 'invoice:' || p_invoice || ':' || p_to);
  return sme_idem_finish(p_org, p_idem, 'receivables.invoice.' || p_to, v_input, jsonb_build_object('invoice_id', p_invoice, 'status', p_to));
end;
$$;

create or replace function sme_issue_invoice(p_org uuid, p_invoice uuid, p_correlation_id uuid, p_idem text)
returns jsonb language sql security definer set search_path = public as
$$ select sme_invoice_set_status(p_org, p_invoice, 'open', null, p_correlation_id, p_idem); $$;
create or replace function sme_void_invoice(p_org uuid, p_invoice uuid, p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb language sql security definer set search_path = public as
$$ select sme_invoice_set_status(p_org, p_invoice, 'void', p_reason, p_correlation_id, p_idem); $$;
create or replace function sme_write_off_invoice(p_org uuid, p_invoice uuid, p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb language sql security definer set search_path = public as
$$ select sme_invoice_set_status(p_org, p_invoice, 'written_off', p_reason, p_correlation_id, p_idem); $$;

-- ── Allocations ─────────────────────────────────────────────

create or replace function sme_allocate_receipt(p_org uuid, p_invoice uuid, p_transaction uuid, p_amount_minor bigint, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('invoice', p_invoice, 'transaction', p_transaction, 'amount_minor', p_amount_minor::text);
  v_replay jsonb;
  v_invoice sme_invoices;
  v_tx sme_transactions;
  v_invoice_allocated bigint;
  v_tx_allocated bigint;
  v_row sme_invoice_allocations;
begin
  perform sme_require(p_org, 'sme.receivables.write');
  v_replay := sme_idem_begin(p_org, p_idem, 'receivables.allocation.create', v_input);
  if v_replay is not null then return v_replay; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then perform sme_fail('VALIDATION_FAILED', '{"field":"amount_minor","reason":"must_be_positive"}'); end if;

  select * into v_invoice from sme_invoices where id = p_invoice and org_id = p_org for update;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"invoice"}'); end if;
  if v_invoice.status <> 'open' then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'invoice_status', 'status', v_invoice.status)); end if;
  -- Locking the transaction serializes allocations of one receipt across invoices.
  select * into v_tx from sme_transactions where id = p_transaction and org_id = p_org for update;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"transaction"}'); end if;
  if v_tx.amount_minor <= 0 or v_tx.source_kind not in ('manual', 'import', 'document')
     or exists (select 1 from sme_transactions r where r.reversal_of = v_tx.id) then
    perform sme_fail('VALIDATION_FAILED', '{"field":"transaction_id","reason":"not_an_unreversed_receipt"}');
  end if;
  if v_tx.currency <> v_invoice.currency then
    perform sme_fail('CURRENCY_MISMATCH', jsonb_build_object('invoice_currency', v_invoice.currency, 'transaction_currency', v_tx.currency));
  end if;

  v_tx_allocated := sme_transaction_allocated_minor(v_tx.id);
  if v_tx_allocated + p_amount_minor > v_tx.amount_minor then
    perform sme_fail('OVER_ALLOCATION', jsonb_build_object('reason', 'transaction', 'available_minor', (v_tx.amount_minor - v_tx_allocated)::text));
  end if;
  select coalesce(sum(amount_minor), 0) into v_invoice_allocated from sme_invoice_allocations where invoice_id = p_invoice;
  if v_invoice.total_minor - v_invoice_allocated - p_amount_minor < 0 then
    perform sme_fail('OVER_ALLOCATION', jsonb_build_object('reason', 'invoice', 'outstanding_minor', (v_invoice.total_minor - v_invoice_allocated)::text));
  end if;

  insert into sme_invoice_allocations (org_id, invoice_id, transaction_id, amount_minor, idempotency_key, created_by)
  values (p_org, p_invoice, p_transaction, p_amount_minor, p_idem, auth.uid())
  returning * into v_row;
  perform sme_audit(p_org, 'receivables.allocation.created', 'invoice', p_invoice, null, to_jsonb(v_row),
    jsonb_build_object('transaction_id', p_transaction, 'amount_minor', p_amount_minor::text), p_correlation_id);
  perform sme_emit(p_org, 'InvoiceStatusChanged', jsonb_build_object('invoiceId', p_invoice,
    'status', (select derived_status from sme_invoice_balances where invoice_id = p_invoice)), 'allocation:' || v_row.id);
  return sme_idem_finish(p_org, p_idem, 'receivables.allocation.create', v_input, jsonb_build_object(
    'allocation_id', v_row.id, 'outstanding_minor', (v_invoice.total_minor - v_invoice_allocated - p_amount_minor)::text));
end;
$$;

create or replace function sme_reverse_allocation(p_org uuid, p_allocation uuid, p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('allocation', p_allocation, 'reason', p_reason);
  v_replay jsonb;
  v_orig sme_invoice_allocations;
  v_row sme_invoice_allocations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform sme_require(p_org, 'sme.receivables.write');
  if v_reason is null then perform sme_fail('VALIDATION_FAILED', '{"field":"reason","reason":"required"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'receivables.allocation.reverse', v_input);
  if v_replay is not null then return v_replay; end if;

  select * into v_orig from sme_invoice_allocations where id = p_allocation and org_id = p_org;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"allocation"}'); end if;
  perform 1 from sme_invoices where id = v_orig.invoice_id for update;
  if v_orig.amount_minor < 0 then perform sme_fail('VALIDATION_FAILED', '{"reason":"is_reversal"}'); end if;
  if exists (select 1 from sme_invoice_allocations where reversal_of = v_orig.id) then perform sme_fail('ALREADY_REVERSED'); end if;

  insert into sme_invoice_allocations (org_id, invoice_id, transaction_id, amount_minor, reversal_of, reason, idempotency_key, created_by)
  values (p_org, v_orig.invoice_id, v_orig.transaction_id, -v_orig.amount_minor, v_orig.id, v_reason, p_idem, auth.uid())
  returning * into v_row;
  perform sme_audit(p_org, 'receivables.allocation.reversed', 'invoice', v_orig.invoice_id, to_jsonb(v_orig), to_jsonb(v_row),
    jsonb_build_object('allocation_id', v_orig.id), p_correlation_id, v_reason);
  perform sme_emit(p_org, 'InvoiceStatusChanged', jsonb_build_object('invoiceId', v_orig.invoice_id,
    'status', (select derived_status from sme_invoice_balances where invoice_id = v_orig.invoice_id)), 'allocation:' || v_row.id);
  return sme_idem_finish(p_org, p_idem, 'receivables.allocation.reverse', v_input, jsonb_build_object('allocation_id', v_row.id));
end;
$$;

-- ── Grants ──────────────────────────────────────────────────

revoke all on function sme_invoice_set_status(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function sme_next_invoice_number(uuid, int) from public, anon, authenticated;
revoke all on function sme_require_party_in_org(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function sme_create_invoice(uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_issue_invoice(uuid, uuid, uuid, text) from public, anon;
revoke all on function sme_void_invoice(uuid, uuid, text, uuid, text) from public, anon;
revoke all on function sme_write_off_invoice(uuid, uuid, text, uuid, text) from public, anon;
revoke all on function sme_allocate_receipt(uuid, uuid, uuid, bigint, uuid, text) from public, anon;
revoke all on function sme_reverse_allocation(uuid, uuid, text, uuid, text) from public, anon;
revoke all on function sme_unallocated_receipts(uuid, text) from public, anon;
revoke all on function sme_party_receivables_summary(uuid, uuid, uuid) from public, anon;
grant execute on function sme_party_receivables_summary(uuid, uuid, uuid) to authenticated;
grant execute on function sme_create_invoice(uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_issue_invoice(uuid, uuid, uuid, text) to authenticated;
grant execute on function sme_void_invoice(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function sme_write_off_invoice(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function sme_allocate_receipt(uuid, uuid, uuid, bigint, uuid, text) to authenticated;
grant execute on function sme_reverse_allocation(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function sme_unallocated_receipts(uuid, text) to authenticated;
