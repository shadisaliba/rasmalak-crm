import { describe, expect, it } from 'vitest';
import { computeFinancialSummary, KPI_VERSION, type KpiInputs, type KpiTransaction, type Metric } from './summary';

const PERIOD = { from: '2026-11-01', to: '2026-11-30' };
const AS_OF = '2026-11-24';

const tx = (id: string, date: string, amountMinor: bigint, over: Partial<KpiTransaction> = {}): KpiTransaction => ({
  id, date, accountId: 'bank', amountMinor, categoryCode: null, categoryKind: null, isDirectCost: false, channel: null,
  counterpartyKey: null, counterpartyName: null, invoiceAllocatedMinor: 0n, billAllocatedMinor: 0n, ...over,
});

function inputs(over: Partial<KpiInputs> = {}): KpiInputs {
  return {
    period: PERIOD, asOf: AS_OF,
    accounts: [{ id: 'bank', name: 'Bank', balanceMinor: 1_300_000n, firstDate: '2026-10-01', opensWithBalance: true, lastActivity: '2026-11-20' }],
    transactions: [], expenseHistory: [], invoices: [], bills: [], foreign: { invoices: 0, bills: 0 },
    ...over,
  };
}
const metric = (s: ReturnType<typeof computeFinancialSummary>, key: Metric['key']) => s.metrics.find(m => m.key === key)!;

// FIN-S02: an 800 JOD invoice, 300 JOD received and matched to it.
const finS02 = inputs({
  invoices: [{ id: 'inv', number: 'INV-1', partyKey: 'company:alnoor', partyName: 'Al-Noor', issueDate: '2026-11-05', dueDate: '2026-12-05', status: 'open', totalMinor: 800_000n, outstandingMinor: 500_000n }],
  transactions: [tx('r1', '2026-11-10', 300_000n, { categoryCode: 'sales', categoryKind: 'income', invoiceAllocatedMinor: 300_000n, counterpartyKey: 'company:alnoor' })],
});

describe('FIN-S02 figures (W3a-08 acceptance)', () => {
  it('gives revenue_recognized 800.000, cash_in 300.000 and receivables_outstanding 500.000', () => {
    const s = computeFinancialSummary(finS02);
    expect(s.kpi_version).toBe(KPI_VERSION);
    expect(metric(s, 'revenue_recognized').value).toBe('800000');
    expect(metric(s, 'cash_in').value).toBe('300000');
    expect(metric(s, 'receivables_outstanding').value).toBe('500000');
  });

  it('never counts a matched receipt as revenue again, categorized or not', () => {
    const uncategorized = inputs({ ...finS02, transactions: [tx('r1', '2026-11-10', 300_000n, { invoiceAllocatedMinor: 300_000n })] });
    expect(metric(computeFinancialSummary(uncategorized), 'revenue_recognized').value).toBe('800000');
    const partly = inputs({ ...finS02, transactions: [tx('r1', '2026-11-10', 450_000n, { categoryCode: 'sales', categoryKind: 'income', invoiceAllocatedMinor: 300_000n })] });
    expect(metric(computeFinancialSummary(partly), 'revenue_recognized').value).toBe('950000');
  });

  it('never counts a paid bill as an expense twice', () => {
    const s = computeFinancialSummary(inputs({
      bills: [{ id: 'b', number: 'S-1', partyKey: 'company:sup', partyName: 'Supplier', issueDate: '2026-11-03', dueDate: '2026-11-20', status: 'open', totalMinor: 500_000n, outstandingMinor: 0n }],
      transactions: [tx('p', '2026-11-18', -500_000n, { categoryCode: 'supplies', categoryKind: 'expense', billAllocatedMinor: 500_000n })],
    }));
    expect(metric(s, 'expenses_recognized').value).toBe('500000');
    expect(metric(s, 'cash_out').value).toBe('500000');
  });
});

describe('cash', () => {
  it('leaves transfers, opening balances, owner money and loan principal out of cash in and out', () => {
    const s = computeFinancialSummary(inputs({ transactions: [
      tx('o', '2026-11-01', 1_000_000n, { categoryKind: 'opening_balance' }),
      tx('t', '2026-11-02', -200_000n, { categoryKind: 'transfer' }),
      tx('e', '2026-11-03', 500_000n, { categoryKind: 'owner_equity' }),
      tx('l', '2026-11-04', -100_000n, { categoryKind: 'financing' }),
      tx('s', '2026-11-05', 70_000n, { categoryKind: 'income', channel: 'cliq' }),
      tx('x', '2026-11-06', -20_000n, { channel: 'cash' }),
    ] }));
    expect([metric(s, 'cash_in').value, metric(s, 'cash_out').value, metric(s, 'net_cash_flow').value]).toEqual(['70000', '20000', '50000']);
    expect((metric(s, 'cleared_cash').breakdown as { by_channel: unknown[] }).by_channel).toEqual([
      { channel: 'cash', in_minor: '0', out_minor: '20000' }, { channel: 'cliq', in_minor: '70000', out_minor: '0' },
    ]);
  });

  it('marks cash figures stale when an account has been quiet for more than 14 days', () => {
    const s = computeFinancialSummary(inputs({ accounts: [{ id: 'bank', name: 'Bank', balanceMinor: 1n, firstDate: '2026-10-01', opensWithBalance: true, lastActivity: '2026-11-01' }] }));
    expect(metric(s, 'cleared_cash')).toMatchObject({ status: 'stale', reasons: [{ code: 'stale_account', account: 'Bank', days: 23 }] });
  });
});

describe('profit_estimate (blueprint §5)', () => {
  // Activity every 5 days through the period, all categorized, with an invoice as revenue basis.
  const steady = Array.from({ length: 5 }, (_, k) => tx(`c${k}`, `2026-11-${String(1 + 5 * k).padStart(2, '0')}`, -10_000n, { categoryCode: 'supplies', categoryKind: 'expense' }));
  const complete = inputs({ ...finS02, transactions: [...finS02.transactions, ...steady] });

  it('is shown when every account covers the period, outflows are categorized and revenue has a basis', () => {
    const s = computeFinancialSummary(complete);
    expect(metric(s, 'profit_estimate')).toMatchObject({ status: 'ok', value: String(800_000 - 50_000) });
    expect(s.coverage).toEqual({ accounts_total: 1, accounts_covered: 1, categorized_percent: '100.0', revenue_basis: true });
  });

  it('is withheld with reasons, and net cash flow offered instead, when an account has a gap', () => {
    const gappy = inputs({ ...complete, transactions: complete.transactions.filter(t => t.date < '2026-11-12') });
    const p = metric(computeFinancialSummary(gappy), 'profit_estimate');
    expect(p.value).toBeNull();
    expect(p.status).toBe('insufficient_data');
    expect(p.reasons).toEqual([{ code: 'coverage_gap', account: 'Bank', from: '2026-11-11', to: '2026-11-24', days: 13 }]);
    // Three 10 JOD outflows (1st, 6th, 11th) fall before the gap.
    expect(p.breakdown).toEqual({ alternative: { key: 'net_cash_flow', value: String(300_000 - 30_000) } });
  });

  it('is withheld when under 80 % of outflows are categorized, or without a revenue basis', () => {
    const loose = inputs({ ...complete, transactions: [...complete.transactions, tx('u', '2026-11-22', -200_000n)] });
    expect(metric(computeFinancialSummary(loose), 'profit_estimate').reasons).toEqual([{ code: 'low_categorization', percent: '20.0', needed: 80 }]);
    const noRevenue = inputs({ ...complete, invoices: [], transactions: steady });
    expect(metric(computeFinancialSummary(noRevenue), 'profit_estimate').reasons).toEqual([{ code: 'no_revenue_basis' }]);
  });

  it('covers an account opened during the period from its opening balance', () => {
    const late = inputs({ ...complete, accounts: [{ id: 'bank', name: 'Bank', balanceMinor: 1n, firstDate: '2026-11-21', opensWithBalance: true, lastActivity: '2026-11-21' }],
      transactions: [...finS02.transactions.map(t => ({ ...t, date: '2026-11-21' })), tx('c', '2026-11-22', -1n, { categoryCode: 'supplies', categoryKind: 'expense' })] });
    expect(metric(computeFinancialSummary(late), 'profit_estimate').status).toBe('ok');
  });
});

describe('margin and concentration', () => {
  it('needs a direct-cost category for gross margin', () => {
    expect(metric(computeFinancialSummary(finS02), 'gross_margin')).toMatchObject({ value: null, reasons: [{ code: 'no_direct_cost_category' }] });
    const withCogs = inputs({ ...finS02, transactions: [...finS02.transactions, tx('g', '2026-11-12', -200_000n, { categoryCode: 'cost_of_goods', categoryKind: 'expense', isDirectCost: true })] });
    expect(metric(computeFinancialSummary(withCogs), 'gross_margin').value).toBe('75.0');
  });

  it('gives the top customer share and the top three', () => {
    const doc = (id: string, party: string, total: bigint) => ({ id, number: id, partyKey: party, partyName: party, issueDate: '2026-11-02', dueDate: '2026-11-30', status: 'open' as const, totalMinor: total, outstandingMinor: total });
    const s = computeFinancialSummary(inputs({ invoices: [doc('a', 'A', 500_000n), doc('b', 'B', 300_000n), doc('c', 'C', 100_000n), doc('d', 'D', 100_000n)] }));
    expect(metric(s, 'revenue_concentration')).toMatchObject({ value: '50.0', breakdown: { top3_percent: '90.0' } });
    expect(metric(s, 'supplier_concentration').value).toBeNull();
  });
});

describe('cost_trend', () => {
  it('flags a month above 1.5 × the 75th percentile of earlier months', () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const history = months.map((m, i) => ({ date: `${m}-15`, amountMinor: -100_000n - BigInt(i * 1000), categoryCode: 'supplies' }));
    history.push({ date: '2026-11-10', amountMinor: -400_000n, categoryCode: 'supplies' });
    const trend = metric(computeFinancialSummary(inputs({ expenseHistory: history })), 'cost_trend').breakdown as Array<{ category: string; flagged: string[]; months: unknown[] }>;
    expect(trend).toEqual([expect.objectContaining({ category: 'supplies', flagged: ['2026-11'] })]);
    expect(trend[0].months).toHaveLength(7);
  });
});
