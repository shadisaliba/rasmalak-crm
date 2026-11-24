import 'server-only';
import Decimal from 'decimal.js';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { fromDbError } from '@/sme/api/errors';
import { isCurrencyCode, minorUnits } from '@/sme/money';
import { daysBetween, todayInAmman } from '@/sme/ledger/domain/dates';
import { isoAddDays } from '../engine-core/dates';
import type { CategoryKind, ForecastConversion, ForecastHistoryTransaction, ForecastInputs, Recurrence } from '../domain/types';

// The detector looks back 15 months (engine-core DEFAULT_WINDOW_MONTHS).
const HISTORY_DAYS = 460;
const PAGE = 1000;
const OPEN_STATUSES = ['open', 'partially_paid', 'overdue'];
/** Most recent paid invoices per customer used for their payment delay. */
const HISTORY_PER_PARTY = 12;

type Row = Record<string, unknown>;

/** PostgREST returns at most 1000 rows (supabase/config.toml max_rows), so read in pages. */
async function all<T extends Row>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: PostgrestError | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw fromDbError(error);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const partyKey = (company: unknown, contact: unknown) => (company ? `company:${company}` : `contact:${contact}`);

/**
 * Everything the engine needs for one organization. Works with the caller's client (RLS applies)
 * and with the worker's service client; every query filters by org_id explicitly either way.
 */
export async function loadForecastInputs(db: SupabaseClient, org: string, asOf: string = todayInAmman()): Promise<ForecastInputs> {
  const since = isoAddDays(asOf, -HISTORY_DAYS);

  const [profile, settings, balances, future, categories, history, invoices, bills, scheduled, companies, contacts] = await Promise.all([
    db.from('sme_business_profiles').select('week_start').eq('org_id', org).maybeSingle(),
    db.from('sme_forecast_settings').select('buffer_minor::text, dismissed_series').eq('org_id', org).maybeSingle(),
    db.from('sme_account_balances').select('account_id, base_balance_minor::text').eq('org_id', org).eq('status', 'active'),
    all<Row>((f, t) => db.from('sme_transactions').select('account_id, base_amount_minor::text').eq('org_id', org).gt('value_date', asOf).order('id').range(f, t)),
    db.from('sme_categories').select('id, code, kind, cost_behavior').or(`org_id.is.null,org_id.eq.${org}`),
    all<Row>((f, t) => db.from('sme_transactions_current')
      .select('id, value_date, base_amount_minor::text, description, category_id, is_reversal, is_reversed')
      .eq('org_id', org).gte('value_date', since).lte('value_date', asOf).order('id').range(f, t)),
    all<Row>((f, t) => db.from('sme_invoice_balances')
      .select('invoice_id, number, customer_company_id, customer_contact_id, due_date, currency, outstanding_minor::text, derived_status')
      .eq('org_id', org).in('derived_status', [...OPEN_STATUSES, 'paid']).order('invoice_id').range(f, t)),
    all<Row>((f, t) => db.from('sme_bill_balances')
      .select('bill_id, supplier_reference, supplier_company_id, supplier_contact_id, due_date, currency, outstanding_minor::text')
      .eq('org_id', org).in('derived_status', OPEN_STATUSES).order('bill_id').range(f, t)),
    db.from('sme_scheduled_items')
      .select('id, label, direction, amount_minor::text, start_date, recurrence, end_date, category_id, is_estimate, source, series_key')
      .eq('org_id', org).eq('status', 'active'),
    all<Row>((f, t) => db.from('crm_companies').select('id, name').eq('org_id', org).order('id').range(f, t)),
    all<Row>((f, t) => db.from('crm_contacts').select('id, first_name, last_name').eq('org_id', org).order('id').range(f, t)),
  ]);
  for (const r of [profile, settings, balances, categories, scheduled]) if (r.error) throw fromDbError(r.error);

  const accountsMeta = await db.from('sme_accounts').select('id, name').eq('org_id', org).eq('status', 'active');
  if (accountsMeta.error) throw fromDbError(accountsMeta.error);
  const futureByAccount = new Map<string, bigint>();
  for (const r of future) futureByAccount.set(String(r.account_id), (futureByAccount.get(String(r.account_id)) ?? 0n) + BigInt(String(r.base_amount_minor)));
  const names = new Map((accountsMeta.data ?? []).map(a => [a.id as string, a.name as string]));
  const accounts = ((balances.data ?? []) as Row[]).map(b => ({
    id: String(b.account_id),
    name: names.get(String(b.account_id)) ?? '',
    clearedMinor: BigInt(String(b.base_balance_minor)) - (futureByAccount.get(String(b.account_id)) ?? 0n),
  }));

  const partyNames = new Map<string, string>();
  for (const c of companies) partyNames.set(`company:${c.id}`, String(c.name));
  for (const c of contacts) partyNames.set(`contact:${c.id}`, [c.first_name, c.last_name].filter(Boolean).join(' '));

  // ── Currency: convert at the latest stored rate, or leave the item out and say so ──
  const foreign = [...new Set([...invoices, ...bills].map(r => String(r.currency)).filter(c => c !== 'JOD'))];
  const rates = new Map<string, { rate: string; date: string }>();
  for (const c of foreign) {
    const { data, error } = await db.from('fx_rates').select('rate::text, date').eq('from_currency', c).eq('to_currency', 'JOD')
      .lte('date', asOf).order('date', { ascending: false }).limit(1).maybeSingle();
    if (error) throw fromDbError(error);
    if (data) rates.set(c, { rate: String(data.rate), date: String(data.date) });
  }
  const conversions = new Map<string, ForecastConversion>();
  const unconverted = new Map<string, number>();
  const toJod = (minor: bigint, currency: string): bigint | null => {
    if (currency === 'JOD') return minor;
    const fx = rates.get(currency);
    if (!fx || !isCurrencyCode(currency)) { unconverted.set(currency, (unconverted.get(currency) ?? 0) + 1); return null; }
    const c = conversions.get(currency) ?? { currency, rate: fx.rate, rateDate: fx.date, count: 0 };
    c.count++;
    conversions.set(currency, c);
    const exact = new Decimal(minor.toString()).mul(fx.rate).mul(new Decimal(10).pow(minorUnits('JOD') - minorUnits(currency)));
    return BigInt(exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
  };

  // ── Customers' payment delays from fully paid invoices ──
  const paid = invoices.filter(r => r.derived_status === 'paid');
  const paidDates = await paidOn(db, org, paid.map(r => String(r.invoice_id)));
  const delays = new Map<string, Array<{ due: string; days: number }>>();
  for (const r of paid) {
    const on = paidDates.get(String(r.invoice_id));
    if (!on) continue;
    const key = partyKey(r.customer_company_id, r.customer_contact_id);
    delays.set(key, [...(delays.get(key) ?? []), { due: String(r.due_date), days: daysBetween(String(r.due_date), on) }]);
  }
  const paymentHistory: Record<string, number[]> = {};
  for (const [key, list] of delays) {
    paymentHistory[key] = list.sort((a, b) => (a.due < b.due ? 1 : -1)).slice(0, HISTORY_PER_PARTY).map(d => d.days);
  }

  const receivables = invoices.filter(r => r.derived_status !== 'paid').flatMap(r => {
    const amount = toJod(BigInt(String(r.outstanding_minor)), String(r.currency));
    const key = partyKey(r.customer_company_id, r.customer_contact_id);
    return amount === null ? [] : [{ id: String(r.invoice_id), number: String(r.number), partyKey: key, partyName: partyNames.get(key) ?? '', dueDate: String(r.due_date), outstandingMinor: amount }];
  });
  const payables = bills.flatMap(r => {
    const amount = toJod(BigInt(String(r.outstanding_minor)), String(r.currency));
    const key = partyKey(r.supplier_company_id, r.supplier_contact_id);
    return amount === null ? [] : [{ id: String(r.bill_id), reference: String(r.supplier_reference ?? ''), partyKey: key, partyName: partyNames.get(key) ?? '', dueDate: String(r.due_date), outstandingMinor: amount }];
  });

  // ── History: posted and unreversed, with category and whether a register already covers it ──
  const cats = new Map(((categories.data ?? []) as Row[]).map(c => [String(c.id), c]));
  const live = history.filter(t => !t.is_reversal && !t.is_reversed);
  const matched = await matchedTransactions(db, org, since);
  const historyRows: ForecastHistoryTransaction[] = live.map(t => {
    const c = t.category_id ? cats.get(String(t.category_id)) : undefined;
    return {
      id: String(t.id), date: String(t.value_date), amountMinor: BigInt(String(t.base_amount_minor)),
      categoryCode: c ? String(c.code) : null, categoryKind: c ? (c.kind as CategoryKind) : null,
      costBehavior: c ? (c.cost_behavior as 'fixed' | 'variable' | null) : null,
      description: String(t.description ?? ''), matched: matched.has(String(t.id)),
    };
  });

  const settingsRow = settings.data as { buffer_minor: string; dismissed_series: string[] } | null;
  return {
    asOf,
    weekStart: Number((profile.data as { week_start?: number } | null)?.week_start ?? 0),
    bufferMinor: BigInt(settingsRow?.buffer_minor ?? '0'),
    accounts: accounts.sort((a, b) => (a.id < b.id ? -1 : 1)),
    receivables,
    paymentHistory,
    payables,
    scheduled: ((scheduled.data ?? []) as Row[]).map(s => ({
      id: String(s.id), label: String(s.label), direction: s.direction as 'in' | 'out', amountMinor: BigInt(String(s.amount_minor)),
      startDate: String(s.start_date), recurrence: s.recurrence as Recurrence, endDate: (s.end_date as string | null) ?? null,
      categoryCode: s.category_id ? String(cats.get(String(s.category_id))?.code ?? '') || null : null,
      isEstimate: Boolean(s.is_estimate), source: s.source as 'owner_entered' | 'detected_confirmed', seriesKey: (s.series_key as string | null) ?? null,
    })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    history: historyRows,
    dismissedSeries: [...(settingsRow?.dismissed_series ?? [])].sort(),
    conversions: [...conversions.values()],
    unconverted: [...unconverted].map(([currency, count]) => ({ currency, count })),
  };
}

/** The date each invoice became fully paid: the latest receipt among its live allocations. */
async function paidOn(db: SupabaseClient, org: string, invoiceIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let i = 0; i < invoiceIds.length; i += 200) {
    const ids = invoiceIds.slice(i, i + 200);
    const rows = await all<Row>((f, t) => db.from('sme_invoice_allocations')
      .select('id, invoice_id, reversal_of, amount_minor::text, sme_transactions!inner(value_date)')
      .eq('org_id', org).in('invoice_id', ids).order('id').range(f, t));
    const reversed = new Set(rows.filter(r => r.reversal_of).map(r => String(r.reversal_of)));
    for (const r of rows) {
      if (r.reversal_of || reversed.has(String(r.id))) continue;
      const date = String((r.sme_transactions as { value_date: string }).value_date);
      const id = String(r.invoice_id);
      if (!result.has(id) || result.get(id)! < date) result.set(id, date);
    }
  }
  return result;
}

/** Transactions with a net allocation to an invoice or a bill. */
async function matchedTransactions(db: SupabaseClient, org: string, since: string): Promise<Set<string>> {
  const net = new Map<string, bigint>();
  for (const table of ['sme_invoice_allocations', 'sme_bill_allocations']) {
    const rows = await all<Row>((f, t) => db.from(table).select('id, transaction_id, amount_minor::text')
      .eq('org_id', org).gte('created_at', since).order('id').range(f, t));
    for (const r of rows) net.set(String(r.transaction_id), (net.get(String(r.transaction_id)) ?? 0n) + BigInt(String(r.amount_minor)));
  }
  return new Set([...net].filter(([, v]) => v !== 0n).map(([k]) => k));
}
