-- ============================================================
-- SME PAYABLES REGISTER (W3a-03)
-- ============================================================
-- Supplier bills mirror the receivables register: bills never change cash; matching a posted
-- outflow reduces what is owed. Nothing here initiates a payment (§12); "mark paid" records a
-- payment that already happened.

create table sme_bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  supplier_company_id uuid references crm_companies(id),
  supplier_contact_id uuid references crm_contacts(id),
  supplier_reference text,                  -- the supplier's own bill number
  issue_date date not null,
  due_date date not null,
  currency char(3) not null references sme_currencies(code),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null check (total_minor > 0),
  status text not null default 'draft' check (status in ('draft','open','void')),
  notes text,
  status_reason text,
  status_changed_by uuid references auth.users(id),
  status_changed_at timestamptz,
  idempotency_key text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, supplier_company_id, supplier_reference),
  unique (org_id, idempotency_key),
  check (supplier_company_id is not null or supplier_contact_id is not null),
  check (due_date >= issue_date),
  check (total_minor = subtotal_minor + tax_minor)
);
create index sme_bills_org_due_idx on sme_bills (org_id, status, due_date);

create table sme_bill_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, bill_id uuid not null references sme_bills(id),
  position int not null,
  description text not null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  tax_rate_bp int not null default 0 check (tax_rate_bp between 0 and 10000),
  line_subtotal_minor bigint not null,
  line_tax_minor bigint not null,
  unique (bill_id, position)
);

-- amount_minor is the absolute value of the outflow matched (negative for a reversal).
create table sme_bill_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  bill_id uuid not null references sme_bills(id),
  transaction_id uuid not null references sme_transactions(id),
  amount_minor bigint not null check (amount_minor <> 0),
  reversal_of uuid unique references sme_bill_allocations(id),
  reason text,
  idempotency_key text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key),
  check ((reversal_of is null) = (amount_minor > 0))
);
create index sme_bill_allocations_tx_idx on sme_bill_allocations (transaction_id);
create index sme_bill_allocations_bill_idx on sme_bill_allocations (bill_id);

alter table sme_bills enable row level security;
alter table sme_bill_lines enable row level security;
alter table sme_bill_allocations enable row level security;
create policy sme_bills_select on sme_bills for select to authenticated using (sme_has_perm(org_id, 'sme.payables.read'));
create policy sme_bill_lines_select on sme_bill_lines for select to authenticated using (sme_has_perm(org_id, 'sme.payables.read'));
create policy sme_bill_allocations_select on sme_bill_allocations for select to authenticated using (sme_has_perm(org_id, 'sme.payables.read'));

-- ── Immutability once approved ──────────────────────────────

create or replace function sme_bill_lines_guard()
returns trigger
language plpgsql
as $$
begin
  if (select status from sme_bills where id = coalesce(new.bill_id, old.bill_id)) is distinct from 'draft' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"bill_not_draft"}';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger sme_bill_lines_guard before insert or update or delete on sme_bill_lines
  for each row execute function sme_bill_lines_guard();

create or replace function sme_bills_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'LEDGER_IMMUTABLE', detail = '{"table":"sme_bills"}';
  end if;
  if old.status <> 'draft' and (
       new.supplier_company_id, new.supplier_contact_id, new.supplier_reference, new.issue_date, new.due_date, new.currency,
       new.subtotal_minor, new.tax_minor, new.total_minor, new.notes, new.org_id, new.created_by, new.idempotency_key)
     is distinct from (
       old.supplier_company_id, old.supplier_contact_id, old.supplier_reference, old.issue_date, old.due_date, old.currency,
       old.subtotal_minor, old.tax_minor, old.total_minor, old.notes, old.org_id, old.created_by, old.idempotency_key) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED', detail = '{"reason":"bill_not_draft"}';
  end if;
  return new;
end;
$$;
create trigger sme_bills_guard before update or delete on sme_bills
  for each row execute function sme_bills_guard();

create trigger sme_bill_allocations_immutable before update or delete on sme_bill_allocations
  for each row execute function sme_ledger_immutable();
create trigger sme_bill_allocations_no_truncate before truncate on sme_bill_allocations
  for each statement execute function sme_ledger_immutable();

create view sme_bill_balances with (security_invoker = true) as
select
  b.id as bill_id, b.org_id, b.supplier_reference, b.supplier_company_id, b.supplier_contact_id,
  b.issue_date, b.due_date, b.currency, b.total_minor, b.status,
  coalesce(a.allocated, 0)::bigint as allocated_minor,
  (b.total_minor - coalesce(a.allocated, 0))::bigint as outstanding_minor,
  case
    when b.status in ('draft', 'void') then b.status
    when b.total_minor - coalesce(a.allocated, 0) <= 0 then 'paid'
    when b.due_date < current_date then 'overdue'
    when coalesce(a.allocated, 0) > 0 then 'partially_paid'
    else 'open'
  end as derived_status,
  case when b.status = 'open' and b.total_minor - coalesce(a.allocated, 0) > 0 and b.due_date < current_date
       then current_date - b.due_date else 0 end as days_overdue
from sme_bills b
left join (select bill_id, sum(amount_minor) as allocated from sme_bill_allocations group by bill_id) a on a.bill_id = b.id;

-- A transaction is matched to invoices (inflows) or bills (outflows); either blocks its reversal.
create or replace function sme_transaction_allocated_minor(p_tx uuid)
returns bigint
language sql
stable
as $$
  select (coalesce((select sum(amount_minor) from sme_invoice_allocations where transaction_id = p_tx), 0)
        + coalesce((select sum(amount_minor) from sme_bill_allocations where transaction_id = p_tx), 0))::bigint;
$$;

create or replace function sme_unallocated_payments(p_org uuid, p_currency text)
returns table (transaction_id uuid, account_id uuid, account_name text, value_date date, description text,
               amount_minor text, unallocated_minor text)
language sql
stable
security invoker
set search_path = public
as $$
  select t.id, t.account_id, a.name, t.value_date, t.description, (-t.amount_minor)::text,
         (-t.amount_minor - sme_transaction_allocated_minor(t.id))::text
  from sme_transactions_current t
  join sme_accounts a on a.id = t.account_id
  where t.org_id = p_org and t.currency = p_currency and t.amount_minor < 0
    and t.source_kind in ('manual', 'import', 'document') and not t.is_reversed and not t.is_reversal
    and -t.amount_minor - sme_transaction_allocated_minor(t.id) > 0
  order by t.value_date desc, t.created_at desc
  limit 200;
$$;

-- ── Create and status ───────────────────────────────────────

create or replace function sme_create_bill(p_org uuid, p_bill jsonb, p_correlation_id uuid, p_idem text)
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
  v_ref text;
  v_lines jsonb;
  v_line jsonb;
  v_position int := 0;
  v_qty numeric;
  v_price bigint;
  v_rate int;
  v_amounts record;
  v_subtotal bigint := 0;
  v_tax bigint := 0;
  v_bill sme_bills;
begin
  perform sme_require(p_org, 'sme.payables.write');
  if jsonb_typeof(p_bill) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'payables.bill.create', p_bill);
  if v_replay is not null then return v_replay; end if;

  v_company := sme_json_uuid(p_bill, 'supplier_company_id');
  v_contact := sme_json_uuid(p_bill, 'supplier_contact_id');
  perform sme_require_party_in_org(p_org, v_company, v_contact);
  v_issue := sme_json_date(p_bill, 'issue_date');
  v_due := sme_json_date(p_bill, 'due_date');
  if v_due < v_issue then perform sme_fail('VALIDATION_FAILED', '{"field":"due_date","reason":"before_issue_date"}'); end if;
  v_currency := upper(coalesce(p_bill ->> 'currency', 'JOD'));
  if not exists (select 1 from sme_currencies where code = v_currency) then perform sme_fail('VALIDATION_FAILED', '{"field":"currency"}'); end if;
  v_status := coalesce(p_bill ->> 'status', 'draft');
  if v_status not in ('draft', 'open') then perform sme_fail('VALIDATION_FAILED', '{"field":"status"}'); end if;
  v_ref := sme_json_text(p_bill, 'supplier_reference', 60);
  if v_ref is not null and exists (select 1 from sme_bills where org_id = p_org and supplier_company_id is not distinct from v_company
                                     and supplier_contact_id is not distinct from v_contact and supplier_reference = v_ref) then
    perform sme_fail('VALIDATION_FAILED', '{"field":"supplier_reference","reason":"duplicate"}');
  end if;
  v_lines := p_bill -> 'lines';
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) = 0 or jsonb_array_length(v_lines) > 200 then
    perform sme_fail('VALIDATION_FAILED', '{"field":"lines"}');
  end if;

  insert into sme_bills (org_id, supplier_company_id, supplier_contact_id, supplier_reference, issue_date, due_date, currency,
                         subtotal_minor, tax_minor, total_minor, status, notes, idempotency_key, created_by, status_changed_by, status_changed_at)
  values (p_org, v_company, v_contact, v_ref, v_issue, v_due, v_currency, 1, 0, 1, 'draft',
          sme_json_text(p_bill, 'notes', 2000), p_idem, auth.uid(), auth.uid(), now())
  returning * into v_bill;

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
    insert into sme_bill_lines (org_id, bill_id, position, description, quantity, unit_price_minor, tax_rate_bp, line_subtotal_minor, line_tax_minor)
    values (p_org, v_bill.id, v_position, coalesce(sme_json_text(v_line, 'description', 500, true), ''), v_qty, v_price, v_rate,
            v_amounts.line_subtotal_minor, v_amounts.line_tax_minor);
    v_subtotal := v_subtotal + v_amounts.line_subtotal_minor;
    v_tax := v_tax + v_amounts.line_tax_minor;
  end loop;

  if v_subtotal + v_tax <= 0 then perform sme_fail('VALIDATION_FAILED', '{"field":"lines","reason":"zero_total"}'); end if;
  if p_bill ? 'expected' and (
       sme_json_minor(p_bill -> 'expected', 'subtotal_minor') <> v_subtotal
       or sme_json_minor(p_bill -> 'expected', 'tax_minor') <> v_tax
       or sme_json_minor(p_bill -> 'expected', 'total_minor') <> v_subtotal + v_tax) then
    perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'totals_mismatch',
      'subtotal_minor', v_subtotal::text, 'tax_minor', v_tax::text, 'total_minor', (v_subtotal + v_tax)::text));
  end if;

  update sme_bills set subtotal_minor = v_subtotal, tax_minor = v_tax, total_minor = v_subtotal + v_tax, status = v_status
   where id = v_bill.id returning * into v_bill;
  if v_company is not null then
    update crm_companies set party_roles = array_append(party_roles, 'supplier') where id = v_company and not ('supplier' = any (party_roles));
  else
    update crm_contacts set party_roles = array_append(party_roles, 'supplier') where id = v_contact and not ('supplier' = any (party_roles));
  end if;

  perform sme_audit(p_org, 'payables.bill.created', 'bill', v_bill.id, null, to_jsonb(v_bill),
    jsonb_build_object('lines', v_position, 'total_minor', v_bill.total_minor::text), p_correlation_id);
  perform sme_emit(p_org, 'BillStatusChanged', jsonb_build_object('billId', v_bill.id, 'status', v_bill.status), 'bill:' || v_bill.id || ':created');
  return sme_idem_finish(p_org, p_idem, 'payables.bill.create', p_bill, jsonb_build_object(
    'bill_id', v_bill.id, 'status', v_bill.status, 'subtotal_minor', v_bill.subtotal_minor::text,
    'tax_minor', v_bill.tax_minor::text, 'total_minor', v_bill.total_minor::text));
end;
$$;

create or replace function sme_bill_set_status(p_org uuid, p_bill uuid, p_to text, p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('bill', p_bill, 'to', p_to, 'reason', p_reason);
  v_replay jsonb;
  v_before sme_bills;
  v_after sme_bills;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform sme_require(p_org, 'sme.payables.write');
  v_replay := sme_idem_begin(p_org, p_idem, 'payables.bill.' || p_to, v_input);
  if v_replay is not null then return v_replay; end if;
  select * into v_before from sme_bills where id = p_bill and org_id = p_org for update;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"bill"}'); end if;

  if p_to = 'open' then
    if v_before.status <> 'draft' then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'status', 'status', v_before.status)); end if;
  elsif p_to = 'void' then
    if v_before.status not in ('draft', 'open') then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'status', 'status', v_before.status)); end if;
    if (select coalesce(sum(amount_minor), 0) from sme_bill_allocations where bill_id = p_bill) <> 0 then perform sme_fail('ALLOCATED_REVERSE_FIRST'); end if;
    if v_reason is null then perform sme_fail('VALIDATION_FAILED', '{"field":"reason","reason":"required"}'); end if;
  else
    perform sme_fail('VALIDATION_FAILED', '{"field":"status"}');
  end if;

  update sme_bills set status = p_to, status_reason = v_reason, status_changed_by = auth.uid(), status_changed_at = now()
   where id = p_bill returning * into v_after;
  perform sme_audit(p_org, 'payables.bill.' || p_to, 'bill', p_bill, to_jsonb(v_before), to_jsonb(v_after),
    jsonb_build_object('from', v_before.status, 'to', p_to), p_correlation_id, v_reason);
  perform sme_emit(p_org, 'BillStatusChanged', jsonb_build_object('billId', p_bill, 'status', p_to), 'bill:' || p_bill || ':' || p_to);
  return sme_idem_finish(p_org, p_idem, 'payables.bill.' || p_to, v_input, jsonb_build_object('bill_id', p_bill, 'status', p_to));
end;
$$;

create or replace function sme_approve_bill(p_org uuid, p_bill uuid, p_correlation_id uuid, p_idem text)
returns jsonb language sql security definer set search_path = public as
$$ select sme_bill_set_status(p_org, p_bill, 'open', null, p_correlation_id, p_idem); $$;
create or replace function sme_void_bill(p_org uuid, p_bill uuid, p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb language sql security definer set search_path = public as
$$ select sme_bill_set_status(p_org, p_bill, 'void', p_reason, p_correlation_id, p_idem); $$;

-- ── Matching payments ───────────────────────────────────────

-- Shared by sme_allocate_payment and sme_pay_bill; the caller holds the idempotency key.
create or replace function sme_bill_allocate_internal(p_org uuid, p_bill uuid, p_transaction uuid, p_amount_minor bigint, p_key text, p_correlation_id uuid)
returns sme_bill_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill sme_bills;
  v_tx sme_transactions;
  v_allocated bigint;
  v_tx_allocated bigint;
  v_row sme_bill_allocations;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then perform sme_fail('VALIDATION_FAILED', '{"field":"amount_minor","reason":"must_be_positive"}'); end if;
  select * into v_bill from sme_bills where id = p_bill and org_id = p_org for update;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"bill"}'); end if;
  if v_bill.status <> 'open' then perform sme_fail('VALIDATION_FAILED', jsonb_build_object('reason', 'bill_status', 'status', v_bill.status)); end if;
  select * into v_tx from sme_transactions where id = p_transaction and org_id = p_org for update;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"transaction"}'); end if;
  if v_tx.amount_minor >= 0 or v_tx.source_kind not in ('manual', 'import', 'document')
     or exists (select 1 from sme_transactions r where r.reversal_of = v_tx.id) then
    perform sme_fail('VALIDATION_FAILED', '{"field":"transaction_id","reason":"not_an_unreversed_payment"}');
  end if;
  if v_tx.currency <> v_bill.currency then
    perform sme_fail('CURRENCY_MISMATCH', jsonb_build_object('bill_currency', v_bill.currency, 'transaction_currency', v_tx.currency));
  end if;
  v_tx_allocated := sme_transaction_allocated_minor(v_tx.id);
  if v_tx_allocated + p_amount_minor > -v_tx.amount_minor then
    perform sme_fail('OVER_ALLOCATION', jsonb_build_object('reason', 'transaction', 'available_minor', (-v_tx.amount_minor - v_tx_allocated)::text));
  end if;
  select coalesce(sum(amount_minor), 0) into v_allocated from sme_bill_allocations where bill_id = p_bill;
  if v_bill.total_minor - v_allocated - p_amount_minor < 0 then
    perform sme_fail('OVER_ALLOCATION', jsonb_build_object('reason', 'bill', 'outstanding_minor', (v_bill.total_minor - v_allocated)::text));
  end if;

  insert into sme_bill_allocations (org_id, bill_id, transaction_id, amount_minor, idempotency_key, created_by)
  values (p_org, p_bill, p_transaction, p_amount_minor, p_key, auth.uid())
  returning * into v_row;
  perform sme_audit(p_org, 'payables.allocation.created', 'bill', p_bill, null, to_jsonb(v_row),
    jsonb_build_object('transaction_id', p_transaction, 'amount_minor', p_amount_minor::text), p_correlation_id);
  perform sme_emit(p_org, 'BillStatusChanged', jsonb_build_object('billId', p_bill,
    'status', (select derived_status from sme_bill_balances where bill_id = p_bill)), 'bill-allocation:' || v_row.id);
  return v_row;
end;
$$;

create or replace function sme_allocate_payment(p_org uuid, p_bill uuid, p_transaction uuid, p_amount_minor bigint, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('bill', p_bill, 'transaction', p_transaction, 'amount_minor', p_amount_minor::text);
  v_replay jsonb;
  v_row sme_bill_allocations;
begin
  perform sme_require(p_org, 'sme.payables.write');
  v_replay := sme_idem_begin(p_org, p_idem, 'payables.allocation.create', v_input);
  if v_replay is not null then return v_replay; end if;
  v_row := sme_bill_allocate_internal(p_org, p_bill, p_transaction, p_amount_minor, p_idem, p_correlation_id);
  return sme_idem_finish(p_org, p_idem, 'payables.allocation.create', v_input, jsonb_build_object('allocation_id', v_row.id,
    'outstanding_minor', (select outstanding_minor from sme_bill_balances where bill_id = p_bill)::text));
end;
$$;

-- "Mark paid": records an outflow that already happened and matches it, in one transaction.
create or replace function sme_pay_bill(p_org uuid, p_bill uuid, p_payment jsonb, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('bill', p_bill, 'payment', p_payment);
  v_replay jsonb;
  v_bill sme_bills;
  v_amount bigint;
  v_tx sme_transactions;
  v_row sme_bill_allocations;
begin
  perform sme_require(p_org, 'sme.payables.write');
  if not sme_has_perm(p_org, 'sme.ledger.post') then perform sme_fail('ACCESS_DENIED', '{"permission":"sme.ledger.post"}'); end if;
  if jsonb_typeof(p_payment) is distinct from 'object' then perform sme_fail('VALIDATION_FAILED', '{"reason":"invalid_body"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'payables.bill.pay', v_input);
  if v_replay is not null then return v_replay; end if;

  select * into v_bill from sme_bills where id = p_bill and org_id = p_org;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"bill"}'); end if;
  v_amount := sme_json_minor(p_payment, 'amount_minor');
  if v_amount <= 0 then perform sme_fail('VALIDATION_FAILED', '{"field":"amount_minor","reason":"must_be_positive"}'); end if;
  v_tx := sme_ledger_insert(p_org, sme_json_uuid(p_payment, 'account_id', true), sme_json_date(p_payment, 'value_date'), -v_amount,
    v_bill.currency, coalesce(sme_json_text(p_payment, 'description', 500), ''), null, 'manual', p_payment -> 'fx', false, null, p_idem || ':payment');
  perform sme_ledger_classify(p_org, v_tx, 'manual', jsonb_build_object(
    'category_id', sme_json_uuid(p_payment, 'category_id'), 'channel', coalesce(p_payment ->> 'channel', 'unknown'),
    'counterparty_company_id', v_bill.supplier_company_id, 'counterparty_contact_id', v_bill.supplier_contact_id));
  perform sme_audit(p_org, 'ledger.transaction.posted', 'transaction', v_tx.id, null, to_jsonb(v_tx),
    jsonb_build_object('base', sme_base_trace(v_tx), 'bill_id', p_bill), p_correlation_id);
  perform sme_emit(p_org, 'TransactionPosted', jsonb_build_object('transactionId', v_tx.id, 'accountId', v_tx.account_id,
    'valueDate', v_tx.value_date, 'amountMinor', v_tx.amount_minor::text, 'currency', v_tx.currency, 'sourceKind', v_tx.source_kind), 'tx:' || v_tx.id);
  v_row := sme_bill_allocate_internal(p_org, p_bill, v_tx.id, v_amount, p_idem, p_correlation_id);
  return sme_idem_finish(p_org, p_idem, 'payables.bill.pay', v_input, jsonb_build_object(
    'transaction_id', v_tx.id, 'allocation_id', v_row.id,
    'outstanding_minor', (select outstanding_minor from sme_bill_balances where bill_id = p_bill)::text));
end;
$$;

create or replace function sme_reverse_bill_allocation(p_org uuid, p_allocation uuid, p_reason text, p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_input jsonb := jsonb_build_object('allocation', p_allocation, 'reason', p_reason);
  v_replay jsonb;
  v_orig sme_bill_allocations;
  v_row sme_bill_allocations;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform sme_require(p_org, 'sme.payables.write');
  if v_reason is null then perform sme_fail('VALIDATION_FAILED', '{"field":"reason","reason":"required"}'); end if;
  v_replay := sme_idem_begin(p_org, p_idem, 'payables.allocation.reverse', v_input);
  if v_replay is not null then return v_replay; end if;
  select * into v_orig from sme_bill_allocations where id = p_allocation and org_id = p_org;
  if not found then perform sme_fail('NOT_FOUND', '{"entity":"allocation"}'); end if;
  perform 1 from sme_bills where id = v_orig.bill_id for update;
  if v_orig.amount_minor < 0 then perform sme_fail('VALIDATION_FAILED', '{"reason":"is_reversal"}'); end if;
  if exists (select 1 from sme_bill_allocations where reversal_of = v_orig.id) then perform sme_fail('ALREADY_REVERSED'); end if;
  insert into sme_bill_allocations (org_id, bill_id, transaction_id, amount_minor, reversal_of, reason, idempotency_key, created_by)
  values (p_org, v_orig.bill_id, v_orig.transaction_id, -v_orig.amount_minor, v_orig.id, v_reason, p_idem, auth.uid())
  returning * into v_row;
  perform sme_audit(p_org, 'payables.allocation.reversed', 'bill', v_orig.bill_id, to_jsonb(v_orig), to_jsonb(v_row),
    jsonb_build_object('allocation_id', v_orig.id), p_correlation_id, v_reason);
  perform sme_emit(p_org, 'BillStatusChanged', jsonb_build_object('billId', v_orig.bill_id,
    'status', (select derived_status from sme_bill_balances where bill_id = v_orig.bill_id)), 'bill-allocation:' || v_row.id);
  return sme_idem_finish(p_org, p_idem, 'payables.allocation.reverse', v_input, jsonb_build_object('allocation_id', v_row.id));
end;
$$;

-- ── FIN-04 overview and the supplier summary ────────────────

-- Due buckets (overdue, within 7, 14 and 30 days) per currency, and each supplier's share of
-- bills issued in the last 90 days.
create or replace function sme_payables_overview(p_org uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with live as (
    select * from sme_bill_balances where org_id = p_org and derived_status in ('open', 'partially_paid', 'overdue')
  ), recent as (
    select coalesce(supplier_company_id::text, 'contact:' || supplier_contact_id::text) as supplier,
           supplier_company_id, supplier_contact_id, currency, sum(total_minor) as total
    from sme_bill_balances
    where org_id = p_org and status <> 'void' and issue_date >= current_date - 90
    group by 1, 2, 3, 4
  ), shares as (
    select *, round(total * 10000.0 / nullif(sum(total) over (partition by currency), 0))::int as share_bp from recent
  )
  select jsonb_build_object(
    'buckets', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'bucket', bucket, 'count', n, 'minor', total::text))
      from (select currency,
                   case when due_date < current_date then 'overdue' when due_date <= current_date + 7 then 'd7'
                        when due_date <= current_date + 14 then 'd14' when due_date <= current_date + 30 then 'd30' else 'later' end as bucket,
                   count(*) as n, sum(outstanding_minor) as total
            from live group by 1, 2) b), '[]'::jsonb),
    'concentration', coalesce((select jsonb_agg(jsonb_build_object('supplier_company_id', supplier_company_id, 'supplier_contact_id', supplier_contact_id,
        'currency', currency, 'minor', total::text, 'share_bp', share_bp) order by total desc)
      from shares), '[]'::jsonb));
$$;

create or replace function sme_party_payables_summary(p_org uuid, p_company uuid, p_contact uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with mine as (
    select b.* from sme_bill_balances b
    where b.org_id = p_org
      and ((p_company is not null and b.supplier_company_id = p_company) or (p_contact is not null and b.supplier_contact_id = p_contact))
  ), paid as (
    select m.bill_id, max(t.value_date) - m.issue_date as days
    from mine m
    join sme_bill_allocations a on a.bill_id = m.bill_id and a.reversal_of is null
      and not exists (select 1 from sme_bill_allocations r where r.reversal_of = a.id)
    join sme_transactions t on t.id = a.transaction_id
    where m.derived_status = 'paid'
    group by m.bill_id, m.issue_date
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

-- ── Grants ──────────────────────────────────────────────────

revoke all on function sme_bill_set_status(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function sme_bill_allocate_internal(uuid, uuid, uuid, bigint, text, uuid) from public, anon, authenticated;
revoke all on function sme_create_bill(uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_approve_bill(uuid, uuid, uuid, text) from public, anon;
revoke all on function sme_void_bill(uuid, uuid, text, uuid, text) from public, anon;
revoke all on function sme_allocate_payment(uuid, uuid, uuid, bigint, uuid, text) from public, anon;
revoke all on function sme_pay_bill(uuid, uuid, jsonb, uuid, text) from public, anon;
revoke all on function sme_reverse_bill_allocation(uuid, uuid, text, uuid, text) from public, anon;
revoke all on function sme_unallocated_payments(uuid, text) from public, anon;
revoke all on function sme_payables_overview(uuid) from public, anon;
revoke all on function sme_party_payables_summary(uuid, uuid, uuid) from public, anon;
grant execute on function sme_create_bill(uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_approve_bill(uuid, uuid, uuid, text) to authenticated;
grant execute on function sme_void_bill(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function sme_allocate_payment(uuid, uuid, uuid, bigint, uuid, text) to authenticated;
grant execute on function sme_pay_bill(uuid, uuid, jsonb, uuid, text) to authenticated;
grant execute on function sme_reverse_bill_allocation(uuid, uuid, text, uuid, text) to authenticated;
grant execute on function sme_unallocated_payments(uuid, text) to authenticated;
grant execute on function sme_payables_overview(uuid) to authenticated;
grant execute on function sme_party_payables_summary(uuid, uuid, uuid) to authenticated;
