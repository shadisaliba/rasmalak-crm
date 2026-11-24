import Decimal from 'decimal.js';
import { quantile } from '@/sme/forecast/engine-core/stats';
import { isoAddDays } from '@/sme/forecast/engine-core/dates';
import { STALE_AFTER_DAYS, daysBetween } from '@/sme/ledger/domain/dates';
import type { CategoryKind } from '@/sme/ledger/types';

/**
 * Financial summary and KPIs (W3a-08, F1.05, F1.06, F1.10). Definitions are the playbook's
 * proposal, signed off at HUMAN GATE G1; a change gets a new version so earlier figures stay
 * explainable. Pure: inputs in, metrics out. Money stays in bigint minor units (JOD).
 */
export const KPI_VERSION = 'kpi-v1-proposed';

/** Kept out of cash in and out: they move money without being operating flows. */
const NON_OPERATING: ReadonlySet<CategoryKind> = new Set(['transfer', 'opening_balance', 'owner_equity', 'financing']);
export const MAX_COVERAGE_GAP_DAYS = 7;
export const MIN_CATEGORIZED_PERCENT = 80;
const COST_TREND_MONTHS = 6;
const COST_SPIKE_FACTOR = 1.5;

export interface KpiAccount {
  id: string;
  name: string;
  balanceMinor: bigint;
  /** First posted transaction ever, and whether it is the account's opening balance. */
  firstDate: string | null;
  opensWithBalance: boolean;
  lastActivity: string | null;
}

export interface KpiTransaction {
  id: string;
  date: string;
  accountId: string;
  /** Base currency (JOD), signed: + in, − out. Posted and not reversed. */
  amountMinor: bigint;
  categoryCode: string | null;
  categoryKind: CategoryKind | null;
  isDirectCost: boolean;
  channel: string | null;
  counterpartyKey: string | null;
  counterpartyName: string | null;
  /** Net amounts of this transaction matched to invoices and to bills. */
  invoiceAllocatedMinor: bigint;
  billAllocatedMinor: bigint;
}

export interface KpiDocument {
  id: string;
  number: string;
  partyKey: string;
  partyName: string;
  issueDate: string;
  dueDate: string;
  status: 'draft' | 'open' | 'void' | 'written_off';
  totalMinor: bigint;
  outstandingMinor: bigint;
}

export interface KpiInputs {
  period: { from: string; to: string };
  /** YYYY-MM-DD in Jordan. */
  asOf: string;
  accounts: KpiAccount[];
  /** Transactions dated inside the period. */
  transactions: KpiTransaction[];
  /** Expense outflows of the last 13 months, for the cost trend. */
  expenseHistory: Array<{ date: string; amountMinor: bigint; categoryCode: string | null }>;
  /** JOD invoices and bills; other currencies are counted in `foreign`. */
  invoices: KpiDocument[];
  bills: KpiDocument[];
  foreign: { invoices: number; bills: number };
}

export type Reason =
  | { code: 'coverage_gap'; account: string; from: string; to: string; days: number }
  | { code: 'low_categorization'; percent: string; needed: number }
  | { code: 'no_revenue_basis' }
  | { code: 'no_revenue' }
  | { code: 'no_direct_cost_category' }
  | { code: 'stale_account'; account: string; days: number | null }
  | { code: 'foreign_excluded'; invoices: number; bills: number };

export type MetricKey =
  | 'cleared_cash' | 'cash_in' | 'cash_out' | 'net_cash_flow' | 'receivables_outstanding' | 'receivables_overdue'
  | 'payables_due_30d' | 'revenue_recognized' | 'expenses_recognized' | 'gross_margin' | 'profit_estimate'
  | 'revenue_concentration' | 'supplier_concentration' | 'cost_trend';

export interface Metric {
  key: MetricKey;
  /** Minor units for JOD, a decimal string for percent, null when not shown. */
  value: string | null;
  unit: 'JOD' | 'percent' | 'list';
  /** Message id explaining how the figure is built. */
  basis_key: string;
  status: 'ok' | 'insufficient_data' | 'stale';
  reasons: Reason[];
  breakdown?: unknown;
}

export interface Coverage {
  accounts_total: number;
  accounts_covered: number;
  categorized_percent: string | null;
  revenue_basis: boolean;
}

export interface FinancialSummary {
  kpi_version: string;
  period: { from: string; to: string };
  as_of: string;
  coverage: Coverage;
  metrics: Metric[];
}

const sum = (values: bigint[]) => values.reduce((s, v) => s + v, 0n);
const abs = (v: bigint) => (v < 0n ? -v : v);
const operating = (t: KpiTransaction) => !(t.categoryKind && NON_OPERATING.has(t.categoryKind));
function percent(part: bigint, whole: bigint): string {
  return new Decimal(part.toString()).mul(100).div(whole.toString()).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1);
}

/** Largest gap in days between activity dates across [start, end], the ends included. */
function largestGap(start: string, end: string, dates: string[]): { days: number; from: string; to: string } {
  const points = [start, ...dates.filter(d => d >= start && d <= end).sort(), end];
  let worst = { days: 0, from: start, to: start };
  for (let i = 1; i < points.length; i++) {
    const days = daysBetween(points[i - 1], points[i]);
    if (days > worst.days) worst = { days, from: points[i - 1], to: points[i] };
  }
  return worst;
}

function concentration(byParty: Map<string, { name: string; minor: bigint }>, total: bigint) {
  const ranked = [...byParty.entries()].sort((a, b) => (b[1].minor > a[1].minor ? 1 : b[1].minor < a[1].minor ? -1 : a[0] < b[0] ? -1 : 1));
  const top3 = ranked.slice(0, 3);
  return {
    top1: ranked.length ? percent(ranked[0][1].minor, total) : null,
    top3: percent(sum(top3.map(([, v]) => v.minor)), total),
    parties: top3.map(([key, v]) => ({ key, name: v.name, minor: v.minor.toString(), percent: percent(v.minor, total) })),
  };
}

export function computeFinancialSummary(inputs: KpiInputs): FinancialSummary {
  const { period, asOf } = inputs;
  const end = period.to < asOf ? period.to : asOf;
  const inPeriod = (d: string) => d >= period.from && d <= period.to;
  const metrics: Metric[] = [];
  const add = (m: Metric) => metrics.push(m);

  // ── Coverage: every account, the whole period, no gap over 7 days ──
  const datesByAccount = new Map<string, string[]>();
  for (const t of inputs.transactions) datesByAccount.set(t.accountId, [...(datesByAccount.get(t.accountId) ?? []), t.date]);
  const gaps: Reason[] = [];
  for (const a of inputs.accounts) {
    // An account opened inside the period is covered from its opening balance on. Otherwise the
    // period start counts as a known point only if the account already had activity by then.
    const start = a.opensWithBalance && a.firstDate && a.firstDate > period.from ? a.firstDate : period.from;
    if (start > end) continue;
    const gap = largestGap(start, end, datesByAccount.get(a.id) ?? []);
    if (gap.days > MAX_COVERAGE_GAP_DAYS) gaps.push({ code: 'coverage_gap', account: a.name, ...gap });
  }
  const covered = inputs.accounts.length - new Set(gaps.map(g => (g as { account: string }).account)).size;

  const stale: Reason[] = inputs.accounts
    .map(a => ({ a, days: a.lastActivity ? daysBetween(a.lastActivity, asOf) : null }))
    .filter(({ days }) => days === null || days > STALE_AFTER_DAYS)
    .map(({ a, days }) => ({ code: 'stale_account', account: a.name, days }));

  // ── Cash ──
  const flows = inputs.transactions.filter(operating);
  const cashIn = sum(flows.filter(t => t.amountMinor > 0n).map(t => t.amountMinor));
  const cashOut = sum(flows.filter(t => t.amountMinor < 0n).map(t => -t.amountMinor));
  const byChannel = new Map<string, { in: bigint; out: bigint }>();
  for (const t of flows) {
    const c = byChannel.get(t.channel ?? 'unknown') ?? { in: 0n, out: 0n };
    if (t.amountMinor > 0n) c.in += t.amountMinor; else c.out -= t.amountMinor;
    byChannel.set(t.channel ?? 'unknown', c);
  }
  const cashStatus = stale.length ? 'stale' as const : 'ok' as const;
  add({
    key: 'cleared_cash', value: sum(inputs.accounts.map(a => a.balanceMinor)).toString(), unit: 'JOD', basis_key: 'kpi.basis.cleared_cash',
    status: cashStatus, reasons: stale,
    breakdown: {
      by_account: inputs.accounts.map(a => ({ id: a.id, name: a.name, minor: a.balanceMinor.toString() })),
      by_channel: [...byChannel.entries()].sort().map(([channel, v]) => ({ channel, in_minor: v.in.toString(), out_minor: v.out.toString() })),
    },
  });
  add({ key: 'cash_in', value: cashIn.toString(), unit: 'JOD', basis_key: 'kpi.basis.cash_in', status: cashStatus, reasons: stale });
  add({ key: 'cash_out', value: cashOut.toString(), unit: 'JOD', basis_key: 'kpi.basis.cash_out', status: cashStatus, reasons: stale });
  add({ key: 'net_cash_flow', value: (cashIn - cashOut).toString(), unit: 'JOD', basis_key: 'kpi.basis.net_cash_flow', status: cashStatus, reasons: stale });

  // ── Registers ──
  const foreign: Reason[] = inputs.foreign.invoices || inputs.foreign.bills ? [{ code: 'foreign_excluded', ...inputs.foreign }] : [];
  const openInvoices = inputs.invoices.filter(i => i.status === 'open' && i.outstandingMinor > 0n);
  add({ key: 'receivables_outstanding', value: sum(openInvoices.map(i => i.outstandingMinor)).toString(), unit: 'JOD', basis_key: 'kpi.basis.receivables_outstanding', status: 'ok', reasons: foreign });
  add({ key: 'receivables_overdue', value: sum(openInvoices.filter(i => i.dueDate < asOf).map(i => i.outstandingMinor)).toString(), unit: 'JOD', basis_key: 'kpi.basis.receivables_overdue', status: 'ok', reasons: foreign });
  const due30 = isoAddDays(asOf, 30);
  add({
    key: 'payables_due_30d', value: sum(inputs.bills.filter(b => b.status === 'open' && b.outstandingMinor > 0n && b.dueDate <= due30).map(b => b.outstandingMinor)).toString(),
    unit: 'JOD', basis_key: 'kpi.basis.payables_due_30d', status: 'ok', reasons: foreign,
  });

  // ── Recognized revenue and expenses: documents in the period, plus unmatched categorized cash ──
  // A receipt matched to an invoice is already in that invoice; only the unmatched part counts.
  const revenueParties = new Map<string, { name: string; minor: bigint }>();
  const addParty = (map: typeof revenueParties, key: string | null, name: string | null, minor: bigint) => {
    if (minor <= 0n) return;
    const k = key ?? 'unknown';
    const e = map.get(k) ?? { name: name ?? '', minor: 0n };
    e.minor += minor;
    map.set(k, e);
  };
  const issued = inputs.invoices.filter(i => i.status !== 'draft' && i.status !== 'void' && inPeriod(i.issueDate));
  for (const i of issued) addParty(revenueParties, i.partyKey, i.partyName, i.totalMinor);
  const incomeReceipts = inputs.transactions.filter(t => t.categoryKind === 'income' && t.amountMinor > 0n);
  for (const t of incomeReceipts) addParty(revenueParties, t.counterpartyKey, t.counterpartyName, t.amountMinor - t.invoiceAllocatedMinor);
  const revenue = sum([...revenueParties.values()].map(v => v.minor));

  const supplierParties = new Map<string, { name: string; minor: bigint }>();
  const billed = inputs.bills.filter(b => b.status !== 'draft' && b.status !== 'void' && inPeriod(b.issueDate));
  for (const b of billed) addParty(supplierParties, b.partyKey, b.partyName, b.totalMinor);
  const expenseOutflows = inputs.transactions.filter(t => t.categoryKind === 'expense' && t.amountMinor < 0n);
  for (const t of expenseOutflows) addParty(supplierParties, t.counterpartyKey, t.counterpartyName, -t.amountMinor - t.billAllocatedMinor);
  const expenses = sum([...supplierParties.values()].map(v => v.minor));

  add({ key: 'revenue_recognized', value: revenue.toString(), unit: 'JOD', basis_key: 'kpi.basis.revenue_recognized', status: 'ok', reasons: foreign });
  add({ key: 'expenses_recognized', value: expenses.toString(), unit: 'JOD', basis_key: 'kpi.basis.expenses_recognized', status: 'ok', reasons: foreign });

  const directUsed = inputs.transactions.some(t => t.isDirectCost);
  const directCost = sum(expenseOutflows.filter(t => t.isDirectCost).map(t => -t.amountMinor - t.billAllocatedMinor).filter(v => v > 0n));
  add(revenue > 0n && directUsed
    ? { key: 'gross_margin', value: percent(revenue - directCost, revenue), unit: 'percent', basis_key: 'kpi.basis.gross_margin', status: 'ok', reasons: [] }
    : { key: 'gross_margin', value: null, unit: 'percent', basis_key: 'kpi.basis.gross_margin', status: 'insufficient_data',
        reasons: [...(revenue > 0n ? [] : [{ code: 'no_revenue' } as const]), ...(directUsed ? [] : [{ code: 'no_direct_cost_category' } as const])] });

  // ── Profit: only on complete enough data; otherwise net cash flow is the honest alternative ──
  const outflows = inputs.transactions.filter(t => operating(t) && t.amountMinor < 0n);
  const outTotal = sum(outflows.map(t => abs(t.amountMinor)));
  const outCategorized = sum(outflows.filter(t => t.categoryCode).map(t => abs(t.amountMinor)));
  const categorizedPercent = outTotal > 0n ? percent(outCategorized, outTotal) : null;
  const revenueBasis = issued.length > 0 || incomeReceipts.length > 0;
  const profitReasons: Reason[] = [
    ...gaps,
    ...(categorizedPercent !== null && Number(categorizedPercent) < MIN_CATEGORIZED_PERCENT ? [{ code: 'low_categorization', percent: categorizedPercent, needed: MIN_CATEGORIZED_PERCENT } as const] : []),
    ...(revenueBasis ? [] : [{ code: 'no_revenue_basis' } as const]),
  ];
  add(profitReasons.length === 0
    ? { key: 'profit_estimate', value: (revenue - expenses).toString(), unit: 'JOD', basis_key: 'kpi.basis.profit_estimate', status: 'ok', reasons: [] }
    : { key: 'profit_estimate', value: null, unit: 'JOD', basis_key: 'kpi.basis.profit_estimate', status: 'insufficient_data', reasons: profitReasons,
        breakdown: { alternative: { key: 'net_cash_flow', value: (cashIn - cashOut).toString() } } });

  // ── Concentration ──
  for (const [key, parties, total] of [['revenue_concentration', revenueParties, revenue], ['supplier_concentration', supplierParties, expenses]] as const) {
    if (total <= 0n) {
      add({ key, value: null, unit: 'percent', basis_key: `kpi.basis.${key}`, status: 'insufficient_data', reasons: [{ code: key === 'revenue_concentration' ? 'no_revenue' : 'no_revenue_basis' }] });
      continue;
    }
    const c = concentration(parties, total);
    add({ key, value: c.top1, unit: 'percent', basis_key: `kpi.basis.${key}`, status: 'ok', reasons: [], breakdown: { top3_percent: c.top3, parties: c.parties } });
  }

  // ── Cost trend: expense per category per month, unusual months flagged (P75 × 1.5) ──
  const months: string[] = [];
  for (let k = COST_TREND_MONTHS; k >= 0; k--) {
    const d = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - k);
    months.push(d.toISOString().slice(0, 7));
  }
  const byCategory = new Map<string, Map<string, bigint>>();
  for (const t of inputs.expenseHistory) {
    if (t.amountMinor >= 0n || !t.categoryCode) continue;
    const m = byCategory.get(t.categoryCode) ?? new Map<string, bigint>();
    m.set(t.date.slice(0, 7), (m.get(t.date.slice(0, 7)) ?? 0n) - t.amountMinor);
    byCategory.set(t.categoryCode, m);
  }
  const trend = [...byCategory.entries()].sort().map(([category, m]) => {
    const values = months.map(month => m.get(month) ?? 0n);
    const flagged = months.filter((month, i) => {
      // Quartiles over exact integer minor units; the flag only compares, nothing is stored from it.
      const prior = values.slice(0, i).filter(v => v > 0n).map(Number);
      return prior.length >= 3 && Number(values[i]) > quantile(prior, 0.75) * COST_SPIKE_FACTOR;
    });
    return { category, months: months.map((month, i) => ({ month, minor: values[i].toString() })), flagged };
  });
  add({ key: 'cost_trend', value: null, unit: 'list', basis_key: 'kpi.basis.cost_trend', status: trend.length ? 'ok' : 'insufficient_data', reasons: [], breakdown: trend });

  return {
    kpi_version: KPI_VERSION,
    period,
    as_of: asOf,
    coverage: { accounts_total: inputs.accounts.length, accounts_covered: covered, categorized_percent: categorizedPercent, revenue_basis: revenueBasis },
    metrics,
  };
}
