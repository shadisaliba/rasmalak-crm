-- ============================================================
-- SME LEDGER (W2-04): accounts, categories, append-only transactions and classifications
-- ============================================================
-- Rule R6: posted transactions are never updated or deleted; corrections are reversal rows.
-- Rule R7: only posted transactions change cash; own-account transfers are neither income nor expense.

create table sme_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  kind text not null check (kind in ('bank','cash','wallet','card','other')),
  name text not null, name_ar text,
  institution text,                         -- free text; implies no integration
  currency char(3) not null references sme_currencies(code),
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table sme_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),   -- null = system default
  parent_id uuid references sme_categories(id),
  code text not null,
  name_en text not null, name_ar text not null,
  kind text not null check (kind in ('income','expense','transfer','owner_equity','financing','tax','opening_balance')),
  cost_behavior text check (cost_behavior in ('fixed','variable')),
  is_direct_cost boolean not null default false,
  active boolean not null default true,
  unique nulls not distinct (org_id, code)
);

create table sme_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  account_id uuid not null references sme_accounts(id),
  value_date date not null,
  amount_minor bigint not null check (amount_minor <> 0),   -- + inflow, - outflow
  currency char(3) not null references sme_currencies(code),
  base_amount_minor bigint not null,                        -- in the org base currency
  fx_rate numeric(24,12),
  fx_rate_date date,
  fx_source text,
  description text not null default '',
  external_ref text,
  source_kind text not null check (source_kind in ('manual','import','document','opening_balance','transfer','reversal')),
  import_batch_id uuid,                                     -- FK added in W2-06
  import_row_id uuid,
  document_id uuid,                                         -- FK added in W3b-09
  fingerprint text not null,
  transfer_group_id uuid,
  reversal_of uuid unique references sme_transactions(id),
  reason text,
  is_estimate boolean not null default false,
  idempotency_key text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key),
  -- MVP base currency is JOD (enforced on sme_business_profiles); foreign-currency rows carry their rate
  check ((currency = 'JOD' and fx_rate is null)
      or (currency <> 'JOD' and fx_rate > 0 and fx_rate_date is not null and fx_source is not null)),
  check (source_kind <> 'reversal' or (reversal_of is not null and reason is not null)),
  check (abs(amount_minor) <= 9000000000000000 and abs(base_amount_minor) <= 9000000000000000)
);
create index sme_transactions_account_date_idx on sme_transactions (org_id, account_id, value_date);
create index sme_transactions_external_ref_idx on sme_transactions (org_id, account_id, external_ref) where external_ref is not null;
create index sme_transactions_fingerprint_idx on sme_transactions (org_id, fingerprint);
create index sme_transactions_transfer_idx on sme_transactions (transfer_group_id) where transfer_group_id is not null;

create table sme_transaction_classifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  transaction_id uuid not null references sme_transactions(id),
  category_id uuid references sme_categories(id),
  counterparty_company_id uuid references crm_companies(id),
  counterparty_contact_id uuid references crm_contacts(id),
  channel text not null default 'unknown' check (channel in
    ('cash','bank_transfer','cliq','wallet','pos_card','cheque','efawateercom','direct_debit','other','unknown')),
  note text,
  classified_by uuid not null references auth.users(id),
  classified_at timestamptz not null default now()
);
create index sme_transaction_classifications_tx_idx on sme_transaction_classifications (transaction_id, classified_at desc);

-- ── Immutability (R6) ───────────────────────────────────────

create or replace function sme_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = 'LEDGER_IMMUTABLE',
    detail = jsonb_build_object('table', tg_table_name)::text;
end;
$$;

create trigger sme_transactions_immutable before update or delete on sme_transactions
  for each row execute function sme_ledger_immutable();
create trigger sme_transactions_no_truncate before truncate on sme_transactions
  for each statement execute function sme_ledger_immutable();
create trigger sme_classifications_immutable before update or delete on sme_transaction_classifications
  for each row execute function sme_ledger_immutable();
create trigger sme_classifications_no_truncate before truncate on sme_transaction_classifications
  for each statement execute function sme_ledger_immutable();

-- A transfer is exactly two rows in one organization; in one currency they net to zero.
create or replace function sme_check_transfer_group()
returns trigger
language plpgsql
as $$
declare
  v_rows int;
  v_orgs int;
  v_currencies int;
  v_sum bigint;
begin
  if new.transfer_group_id is null then return null; end if;
  select count(*), count(distinct org_id), count(distinct currency), sum(amount_minor)
    into v_rows, v_orgs, v_currencies, v_sum
  from sme_transactions where transfer_group_id = new.transfer_group_id;
  if v_rows <> 2 or v_orgs <> 1 or (v_currencies = 1 and v_sum <> 0) then
    raise exception using errcode = 'P0001', message = 'VALIDATION_FAILED',
      detail = jsonb_build_object('reason', 'unbalanced_transfer', 'transfer_group_id', new.transfer_group_id)::text;
  end if;
  return null;
end;
$$;

create constraint trigger sme_transactions_transfer_balanced
  after insert on sme_transactions
  deferrable initially deferred
  for each row execute function sme_check_transfer_group();

-- ── Fingerprint ─────────────────────────────────────────────
-- Mirrored by fingerprint() in src/sme/ledger/domain/fingerprint.ts; a test runs both on the
-- same inputs. Amount-like tokens (digits with a decimal part) are dropped because banks
-- print running balances in descriptions, which differ between overlapping exports.
-- Whitespace is an explicit ASCII class (plus NBSP, translated first) so the result does not
-- depend on the database locale.

create or replace function sme_normalize_description(p_text text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(lower(coalesce(p_text, '')), 'إأآٱ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹' || chr(160), 'اااا01234567890123456789 '),
        '[ً-ٰٟـ]', '', 'g'),
      '[0-9][0-9,]*\.[0-9]+', ' ', 'g'),
    '[ \t\n\r\f\v]+', ' ', 'g'));
$$;

create or replace function sme_fingerprint(p_org uuid, p_account uuid, p_value_date date, p_amount_minor bigint, p_description text, p_external_ref text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(
    p_org::text || '|' || p_account::text || '|' || to_char(p_value_date, 'YYYY-MM-DD') || '|' || p_amount_minor::text
      || '|' || sme_normalize_description(p_description) || '|' || coalesce(p_external_ref, ''),
    'sha256'), 'hex');
$$;

-- ── Views ───────────────────────────────────────────────────

create view sme_transactions_current with (security_invoker = true) as
select
  t.*,
  c.id as classification_id,
  c.category_id,
  c.counterparty_company_id,
  c.counterparty_contact_id,
  c.channel,
  c.note as classification_note,
  c.classified_by,
  c.classified_at,
  exists (select 1 from sme_transactions r where r.reversal_of = t.id) as is_reversed,
  (t.source_kind = 'reversal') as is_reversal
from sme_transactions t
left join lateral (
  select * from sme_transaction_classifications x
  where x.transaction_id = t.id
  order by x.classified_at desc, x.id desc
  limit 1
) c on true;

-- Reversals are negated rows, so plain sums already net them out.
create view sme_account_balances with (security_invoker = true) as
select
  a.id as account_id,
  a.org_id,
  a.currency,
  a.status,
  coalesce(sum(t.amount_minor), 0)::bigint as balance_minor,
  coalesce(sum(t.base_amount_minor), 0)::bigint as base_balance_minor,
  max(t.value_date) as last_value_date,
  count(t.id)::int as transaction_count,
  bool_or(t.source_kind = 'opening_balance' and t.is_estimate
          and not exists (select 1 from sme_transactions r where r.reversal_of = t.id)) is true as has_estimated_opening
from sme_accounts a
left join sme_transactions t on t.account_id = a.id
group by a.id, a.org_id, a.currency, a.status;

-- ── RLS (reads only; writes go through sme_* RPCs, rule R10) ─

alter table sme_accounts enable row level security;
alter table sme_categories enable row level security;
alter table sme_transactions enable row level security;
alter table sme_transaction_classifications enable row level security;

create policy sme_accounts_select on sme_accounts for select to authenticated using (sme_has_perm(org_id, 'sme.ledger.read'));
create policy sme_categories_select on sme_categories for select to authenticated
  using (org_id is null or sme_has_perm(org_id, 'sme.ledger.read'));
create policy sme_transactions_select on sme_transactions for select to authenticated using (sme_has_perm(org_id, 'sme.ledger.read'));
create policy sme_classifications_select on sme_transaction_classifications for select to authenticated using (sme_has_perm(org_id, 'sme.ledger.read'));

-- ── System categories (generic bookkeeping labels, not legal content) ─

insert into sme_categories (org_id, code, name_en, name_ar, kind, cost_behavior, is_direct_cost) values
  (null, 'sales', 'Sales', 'المبيعات', 'income', null, false),
  (null, 'service_income', 'Service income', 'إيرادات الخدمات', 'income', null, false),
  (null, 'other_income', 'Other income', 'إيرادات أخرى', 'income', null, false),
  (null, 'rent', 'Rent', 'الإيجار', 'expense', 'fixed', false),
  (null, 'salaries_wages', 'Salaries and wages', 'الرواتب والأجور', 'expense', 'fixed', false),
  (null, 'utilities', 'Utilities', 'الكهرباء والمياه', 'expense', 'fixed', false),
  (null, 'telecom', 'Telecom and internet', 'الاتصالات والإنترنت', 'expense', 'fixed', false),
  (null, 'transport', 'Transport and fuel', 'النقل والوقود', 'expense', 'variable', false),
  (null, 'supplies', 'Supplies', 'المستلزمات', 'expense', 'variable', false),
  (null, 'professional_fees', 'Professional fees', 'أتعاب مهنية', 'expense', 'fixed', false),
  (null, 'marketing', 'Marketing', 'التسويق', 'expense', 'variable', false),
  (null, 'bank_fees', 'Bank fees', 'رسوم بنكية', 'expense', 'variable', false),
  (null, 'cost_of_goods', 'Cost of goods sold', 'تكلفة البضاعة المباعة', 'expense', 'variable', true),
  (null, 'owner_drawings', 'Owner drawings', 'مسحوبات المالك', 'owner_equity', null, false),
  (null, 'owner_capital', 'Owner capital', 'رأس مال المالك', 'owner_equity', null, false),
  (null, 'loan_proceeds', 'Loan proceeds', 'متحصلات القروض', 'financing', null, false),
  (null, 'loan_principal', 'Loan principal repayments', 'سداد أصل القروض', 'financing', null, false),
  (null, 'tax_payments', 'Tax payments', 'مدفوعات ضريبية', 'tax', null, false),
  (null, 'transfer', 'Transfer between own accounts', 'تحويل بين حسابات المنشأة', 'transfer', null, false),
  (null, 'opening_balance', 'Opening balance', 'الرصيد الافتتاحي', 'opening_balance', null, false);
