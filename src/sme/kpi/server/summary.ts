import 'server-only';
import { createHash } from 'node:crypto';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { fromDbError } from '@/sme/api/errors';
import { todayInAmman } from '@/sme/ledger/domain/dates';
import { isoAddDays } from '@/sme/forecast/engine-core/dates';
import type { CategoryKind } from '@/sme/ledger/types';
import { KPI_VERSION, computeFinancialSummary, type FinancialSummary, type KpiDocument, type KpiInputs, type KpiTransaction } from '../domain/summary';

const PAGE = 1000;
const HISTORY_DAYS = 400;
type Row = Record<string, unknown>;

async function all(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: PostgrestError | null }>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw fromDbError(error);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function chunked<T>(ids: string[], run: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...await run(ids.slice(i, i + 200)));
  return out;
}

/**
 * Inputs for one organization and period. Works with the caller's client (RLS applies) and the
 * worker's service client; every query filters by org_id explicitly either way.
 */
export async function loadKpiInputs(db: SupabaseClient, org: string, period: { from: string; to: string }, asOf: string = todayInAmman()): Promise<KpiInputs> {
  const since = [period.from, isoAddDays(asOf, -HISTORY_DAYS)].sort()[0];
  const until = [period.to, asOf].sort()[1];

  const [accounts, balances, future, quality, openings, categories, txs, companies, contacts] = await Promise.all([
    db.from('sme_accounts').select('id, name').eq('org_id', org).eq('status', 'active'),
    db.from('sme_account_balances').select('account_id, base_balance_minor::text').eq('org_id', org).eq('status', 'active'),
    all((f, t) => db.from('sme_transactions').select('account_id, base_amount_minor::text').eq('org_id', org).gt('value_date', asOf).order('id').range(f, t)),
    db.rpc('sme_data_quality_inputs', { p_org: org }),
    all((f, t) => db.from('sme_transactions').select('account_id, value_date').eq('org_id', org).eq('source_kind', 'opening_balance').order('id').range(f, t)),
    db.from('sme_categories').select('id, code, kind, is_direct_cost').or(`org_id.is.null,org_id.eq.${org}`),
    all((f, t) => db.from('sme_transactions_current')
      .select('id, account_id, value_date, base_amount_minor::text, category_id, channel, counterparty_company_id, counterparty_contact_id, source_kind, transfer_group_id, is_reversal, is_reversed')
      .eq('org_id', org).gte('value_date', since).lte('value_date', until).order('id').range(f, t)),
    all((f, t) => db.from('crm_companies').select('id, name').eq('org_id', org).order('id').range(f, t)),
    all((f, t) => db.from('crm_contacts').select('id, first_name, last_name').eq('org_id', org).order('id').range(f, t)),
  ]);
  for (const r of [accounts, balances, quality, categories]) if (r.error) throw fromDbError(r.error);

  const names = new Map<string, string>();
  for (const c of companies) names.set(`company:${c.id}`, String(c.name));
  for (const c of contacts) names.set(`contact:${c.id}`, [c.first_name, c.last_name].filter(Boolean).join(' '));
  const cats = new Map(((categories.data ?? []) as Row[]).map(c => [String(c.id), c]));

  // ── Accounts: balance at the as-of date, first activity, last activity ──
  const futureBy = new Map<string, bigint>();
  for (const r of future) futureBy.set(String(r.account_id), (futureBy.get(String(r.account_id)) ?? 0n) + BigInt(String(r.base_amount_minor)));
  const balanceBy = new Map(((balances.data ?? []) as Row[]).map(b => [String(b.account_id), BigInt(String(b.base_balance_minor))]));
  const qualityBy = new Map(((quality.data as { accounts: Row[] }).accounts).map(a => [String(a.account_id), a]));
  const openingBy = new Map<string, string>();
  for (const o of openings) if (!openingBy.has(String(o.account_id)) || String(o.value_date) < openingBy.get(String(o.account_id))!) openingBy.set(String(o.account_id), String(o.value_date));

  // ── Transactions: posted and unreversed, with category and what registers already cover ──
  const live = txs.filter(t => !t.is_reversal && !t.is_reversed);
  const inPeriodIds = live.filter(t => String(t.value_date) >= period.from && String(t.value_date) <= period.to).map(t => String(t.id));
  const allocations = async (table: string) => {
    const rows = await chunked(inPeriodIds, async part => all((f, t) => db.from(table).select('id, transaction_id, amount_minor::text').eq('org_id', org).in('transaction_id', part).order('id').range(f, t)));
    const net = new Map<string, bigint>();
    for (const r of rows) net.set(String(r.transaction_id), (net.get(String(r.transaction_id)) ?? 0n) + BigInt(String(r.amount_minor)));
    return net;
  };
  const [toInvoices, toBills] = await Promise.all([allocations('sme_invoice_allocations'), allocations('sme_bill_allocations')]);

  const mapped = live.map(t => {
    const c = t.category_id ? cats.get(String(t.category_id)) : undefined;
    const posted: CategoryKind | null = t.source_kind === 'opening_balance' ? 'opening_balance' : t.source_kind === 'transfer' || t.transfer_group_id ? 'transfer' : null;
    const party = t.counterparty_company_id ? `company:${t.counterparty_company_id}` : t.counterparty_contact_id ? `contact:${t.counterparty_contact_id}` : null;
    return {
      id: String(t.id), date: String(t.value_date), accountId: String(t.account_id), amountMinor: BigInt(String(t.base_amount_minor)),
      categoryCode: c ? String(c.code) : null, categoryKind: posted ?? (c ? (c.kind as CategoryKind) : null), isDirectCost: Boolean(c?.is_direct_cost),
      channel: (t.channel as string | null) ?? null, counterpartyKey: party, counterpartyName: party ? names.get(party) ?? null : null,
      invoiceAllocatedMinor: toInvoices.get(String(t.id)) ?? 0n, billAllocatedMinor: toBills.get(String(t.id)) ?? 0n,
    } satisfies KpiTransaction;
  });

  // ── Registers: documents issued in the period, plus any still open ──
  const documents = async (view: string, id: string, ref: string, company: string, contact: string) => {
    const select = `${id}, ${ref}, ${company}, ${contact}, issue_date, due_date, currency, status, total_minor::text, outstanding_minor::text, derived_status`;
    const [issued, open] = await Promise.all([
      all((f, t) => db.from(view).select(select).eq('org_id', org).gte('issue_date', period.from).lte('issue_date', period.to).order(id).range(f, t)),
      all((f, t) => db.from(view).select(select).eq('org_id', org).in('derived_status', ['open', 'partially_paid', 'overdue']).order(id).range(f, t)),
    ]);
    const byId = new Map([...issued, ...open].map(r => [String(r[id]), r]));
    const rows = [...byId.values()];
    const jod = rows.filter(r => r.currency === 'JOD');
    return {
      foreign: rows.length - jod.length,
      docs: jod.map(r => {
        const party = r[company] ? `company:${r[company]}` : `contact:${r[contact]}`;
        return {
          id: String(r[id]), number: String(r[ref] ?? ''), partyKey: party, partyName: names.get(party) ?? '', issueDate: String(r.issue_date), dueDate: String(r.due_date),
          status: r.status as KpiDocument['status'], totalMinor: BigInt(String(r.total_minor)), outstandingMinor: BigInt(String(r.outstanding_minor)),
        } satisfies KpiDocument;
      }).sort((a, b) => (a.id < b.id ? -1 : 1)),
    };
  };
  const [invoices, bills] = await Promise.all([
    documents('sme_invoice_balances', 'invoice_id', 'number', 'customer_company_id', 'customer_contact_id'),
    documents('sme_bill_balances', 'bill_id', 'supplier_reference', 'supplier_company_id', 'supplier_contact_id'),
  ]);

  return {
    period,
    asOf,
    accounts: ((accounts.data ?? []) as Row[]).map(a => {
      const id = String(a.id);
      const q = qualityBy.get(id);
      const first = (q?.first_date as string | null) ?? null;
      const last = [q?.last_date, q?.last_import_date].filter((d): d is string => typeof d === 'string').sort().at(-1) ?? null;
      return {
        id, name: String(a.name), balanceMinor: (balanceBy.get(id) ?? 0n) - (futureBy.get(id) ?? 0n),
        firstDate: first, opensWithBalance: first !== null && openingBy.get(id) === first, lastActivity: last,
      };
    }).sort((a, b) => (a.id < b.id ? -1 : 1)),
    transactions: mapped.filter(t => t.date >= period.from && t.date <= period.to).sort((a, b) => (a.id < b.id ? -1 : 1)),
    expenseHistory: mapped.filter(t => t.categoryKind === 'expense' && t.amountMinor < 0n && t.date >= isoAddDays(asOf, -HISTORY_DAYS))
      .map(t => ({ date: t.date, amountMinor: t.amountMinor, categoryCode: t.categoryCode })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    invoices: invoices.docs,
    bills: bills.docs,
    foreign: { invoices: invoices.foreign, bills: bills.foreign },
  };
}

function digest(inputs: KpiInputs): string {
  const text = JSON.stringify({ version: KPI_VERSION, inputs }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return createHash('sha256').update(text).digest('hex');
}

const periodKey = (p: { from: string; to: string }) => `${p.from}_${p.to}`;

/**
 * The summary for a period: the stored snapshot while its inputs are unchanged, otherwise computed
 * now. Reads only; snapshots are written by the worker (`refreshKpiSnapshot`).
 */
export async function getFinancialSummary(db: SupabaseClient, org: string, period: { from: string; to: string }): Promise<{ summary: FinancialSummary; computed_at: string; from_snapshot: boolean }> {
  const inputs = await loadKpiInputs(db, org, period);
  const d = digest(inputs);
  const { data, error } = await db.from('sme_kpi_snapshots').select('input_digest, payload, computed_at')
    .eq('org_id', org).eq('period_key', periodKey(period)).eq('kpi_version', KPI_VERSION).maybeSingle();
  if (error) throw fromDbError(error);
  if (data && data.input_digest === d) return { summary: data.payload as FinancialSummary, computed_at: String(data.computed_at), from_snapshot: true };
  return { summary: computeFinancialSummary(inputs), computed_at: new Date().toISOString(), from_snapshot: false };
}

/** Worker: recompute and store the snapshot for a period (service role, rule R11). */
export async function refreshKpiSnapshot(db: SupabaseClient, org: string, period: { from: string; to: string }): Promise<void> {
  const inputs = await loadKpiInputs(db, org, period);
  const summary = computeFinancialSummary(inputs);
  const { error } = await db.rpc('sme_store_kpi_snapshot_worker', {
    p_org: org, p_period_key: periodKey(period), p_version: KPI_VERSION, p_digest: digest(inputs), p_payload: summary,
  });
  if (error) throw new Error(`KPI snapshot failed: ${error.message}`);
}

/** The calendar month holding `today` (Jordan), the period the worker keeps fresh. */
export function currentMonth(today: string = todayInAmman()): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}
