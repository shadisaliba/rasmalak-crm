import { describe, expect, it } from 'vitest';
import { canonicalInputs, occurrences, runForecast, weekStartOf } from './engine';
import type { ForecastHistoryTransaction, ForecastInputs, ForecastResult, ScenarioOverride } from './types';

// Tuesday; with weeks starting on Sunday the first week is 22–28 Nov 2026.
const AS_OF = '2026-11-24';

function inputs(over: Partial<ForecastInputs> = {}): ForecastInputs {
  return {
    asOf: AS_OF, weekStart: 0, bufferMinor: 0n,
    accounts: [{ id: 'acc-1', name: 'Bank', clearedMinor: 5_000_000n }],
    receivables: [], paymentHistory: {}, payables: [], scheduled: [], history: [],
    dismissedSeries: [], conversions: [], unconverted: [],
    ...over,
  };
}

// FIN-S03: a supplier bill due before an expected customer receipt.
const shortfall = inputs({
  payables: [{ id: 'bill-1', reference: 'SUP-77', partyKey: 'company:s1', partyName: 'Amman Supplies', dueDate: '2026-12-02', outstandingMinor: 8_000_000n }],
  receivables: [{ id: 'inv-1', number: 'INV-0042', partyKey: 'company:c1', partyName: 'Al-Noor Trading', dueDate: '2026-12-16', outstandingMinor: 10_000_000n }],
});

const week = (r: ForecastResult, i: number) => r.weeks[i];
const tx = (id: string, date: string, amountMinor: bigint, over: Partial<ForecastHistoryTransaction> = {}): ForecastHistoryTransaction => ({
  id, date, amountMinor, categoryCode: null, categoryKind: null, costBehavior: null, description: '', matched: false, ...over,
});

describe('FIN-S03 projected shortage (W3a-07)', () => {
  it('finds the shortfall week when a bill falls due before the customer pays, and lists why', () => {
    const r = runForecast(shortfall);
    expect(week(r, 0).start).toBe('2026-11-22');
    expect(r.firstBelowZeroWeek).toBe(1);
    expect(week(r, 1)).toMatchObject({ start: '2026-11-29', outMinor: 8_000_000n, closingMinor: -3_000_000n });
    expect(week(r, 3)).toMatchObject({ inMinor: 10_000_000n, closingMinor: 7_000_000n });
    expect(r.minimum).toEqual({ minor: -3_000_000n, weekIndex: 1 });
    const keys = r.assumptions.map(a => a.key);
    expect(keys).toEqual(expect.arrayContaining(['bills_on_due_date', 'receipt_no_history', 'opening_cleared_cash']));
    expect(week(r, 1).lines[0]).toMatchObject({ refId: 'bill-1', source: 'payable', assumptionIds: ['bills_on_due_date'] });
  });

  it('moving that bill in a scenario removes the shortfall and leaves the baseline unchanged', () => {
    const baseline = runForecast(shortfall);
    const scenario = runForecast(shortfall, [{ type: 'move_bill', bill_id: 'bill-1', new_date: '2026-12-17' }]);
    expect(scenario.firstBelowZeroWeek).toBeNull();
    expect(scenario.minimum.minor).toBe(5_000_000n);
    expect(scenario.assumptions.find(a => a.key === 'bill_moved')?.params).toEqual({ bill: 'SUP-77', date: '2026-12-17' });
    expect(runForecast(shortfall)).toEqual(baseline);
    expect(shortfall.payables[0].dueDate).toBe('2026-12-02');
  });

  it('projects opening cleared cash plus included inflows minus included outflows (blueprint §5)', () => {
    const r = runForecast(shortfall);
    const lines = r.weeks.flatMap(w => w.lines);
    const net = lines.reduce((s, l) => s + (l.direction === 'in' ? l.amountMinor : -l.amountMinor), 0n);
    expect(r.weeks[12].closingMinor).toBe(r.openingClearedMinor + net);
    expect(lines.every(l => l.assumptionIds.length > 0)).toBe(true);
  });
});

describe('invariants', () => {
  const rich = inputs({
    accounts: [{ id: 'a', name: 'Bank', clearedMinor: 1_234_567n }, { id: 'b', name: 'Cash box', clearedMinor: 89_000n }],
    receivables: shortfall.receivables,
    payables: shortfall.payables,
    scheduled: [
      { id: 'rent', label: 'Rent', direction: 'out', amountMinor: 450_000n, startDate: '2026-12-01', recurrence: 'monthly', endDate: null, categoryCode: 'rent', isEstimate: false, source: 'owner_entered', seriesKey: null },
      { id: 'pay', label: 'Payroll', direction: 'out', amountMinor: 1_800_000n, startDate: '2026-11-26', recurrence: 'monthly', endDate: null, categoryCode: 'salaries_wages', isEstimate: false, source: 'owner_entered', seriesKey: null },
      { id: 'grant', label: 'Grant', direction: 'in', amountMinor: 2_500_000n, startDate: '2027-01-10', recurrence: 'none', endDate: null, categoryCode: null, isEstimate: true, source: 'owner_entered', seriesKey: null },
    ],
  });

  it('closing = opening + in − out, the next opening is this closing, and week 0 opens at cleared cash', () => {
    const r = runForecast(rich);
    expect(r.weeks).toHaveLength(13);
    expect(r.weeks[0].openingMinor).toBe(1_323_567n);
    r.weeks.forEach((w, i) => {
      expect(w.closingMinor).toBe(w.openingMinor + w.inMinor - w.outMinor);
      if (i > 0) expect(w.openingMinor).toBe(r.weeks[i - 1].closingMinor);
      expect(w.inMinor).toBe(Object.values(w.inflows).reduce((s, v) => s + v, 0n));
    });
  });

  it('is deterministic for the same inputs', () => {
    expect(runForecast(rich)).toEqual(runForecast(rich));
    expect(canonicalInputs(rich, [])).toBe(canonicalInputs({ ...rich }, []));
    expect(canonicalInputs(rich, [])).not.toBe(canonicalInputs(rich, [{ type: 'include_uncertain_receivables' }]));
  });

  it('starts week 0 on the profile week start', () => {
    expect(weekStartOf(AS_OF, 0)).toBe('2026-11-22');
    expect(weekStartOf(AS_OF, 6)).toBe('2026-11-21');
    expect(weekStartOf('2026-11-22', 0)).toBe('2026-11-22');
    expect(runForecast({ ...rich, weekStart: 1 }).weeks[0].start).toBe('2026-11-23');
  });
});

describe('receivables', () => {
  const late = inputs({
    receivables: [{ id: 'inv', number: 'INV-1', partyKey: 'company:c1', partyName: 'Al-Noor', dueDate: '2026-12-01', outstandingMinor: 1_000_000n }],
    paymentHistory: { 'company:c1': [10, 20, 14] },
  });

  it('adds the customer\'s median delay once they have 3 paid invoices', () => {
    const r = runForecast(late);
    expect(r.weeks.flatMap(w => w.lines)[0].date).toBe('2026-12-15');
    expect(r.assumptions.find(a => a.key === 'receipt_timing_history')?.params).toEqual({ customer: 'Al-Noor', days: 14, invoices: 3 });
  });

  it('assumes the due date, and says so, with fewer than 3', () => {
    const r = runForecast({ ...late, paymentHistory: { 'company:c1': [30, 30] } });
    expect(r.weeks.flatMap(w => w.lines)[0].date).toBe('2026-12-01');
    expect(r.assumptions.find(a => a.key === 'receipt_no_history')?.params).toEqual({ customer: 'Al-Noor' });
  });

  it('shifts receipts in a scenario', () => {
    const r = runForecast(late, [{ type: 'shift_receipts_days', days: 7 }]);
    expect(r.weeks.flatMap(w => w.lines)[0].date).toBe('2026-12-22');
  });

  it('leaves invoices more than 60 days overdue out of the baseline and lists them', () => {
    const old = inputs({ receivables: [{ id: 'old', number: 'INV-9', partyKey: 'company:c2', partyName: 'Slow Co', dueDate: '2026-09-01', outstandingMinor: 700_000n }] });
    const r = runForecast(old);
    expect(r.uncertainReceivables).toEqual([expect.objectContaining({ id: 'old', daysOverdue: 84, included: false })]);
    expect(r.weeks.every(w => w.inMinor === 0n)).toBe(true);
    expect(r.assumptions.find(a => a.key === 'uncertain_excluded')?.handle).toEqual({ type: 'include_uncertain_receivables' });

    const s = runForecast(old, [{ type: 'include_uncertain_receivables' }]);
    expect(s.weeks[0].inflows.receivable).toBe(700_000n);
  });

  it('expects an overdue invoice no earlier than today', () => {
    const r = runForecast(inputs({ receivables: [{ id: 'od', number: 'INV-2', partyKey: 'k', partyName: 'P', dueDate: '2026-11-10', outstandingMinor: 1n }] }));
    expect(r.weeks[0].lines[0].date).toBe(AS_OF);
  });
});

describe('payables and scheduled items', () => {
  it('puts overdue bills in this week', () => {
    const r = runForecast(inputs({ payables: [{ id: 'b', reference: 'X', partyKey: 'k', partyName: 'S', dueDate: '2026-11-01', outstandingMinor: 5n }] }));
    expect(r.weeks[0].outflows.payable).toBe(5n);
    expect(r.assumptions.map(a => a.key)).toContain('overdue_bills_now');
  });

  it('expands recurrences inside the horizon and keeps a 31st on month ends', () => {
    expect(occurrences('2026-12-01', 'monthly', null, AS_OF, '2027-02-20')).toEqual(['2026-12-01', '2027-01-01', '2027-02-01']);
    expect(occurrences('2026-10-31', 'monthly', null, AS_OF, '2027-02-20')).toEqual(['2026-11-30', '2026-12-31', '2027-01-31']);
    expect(occurrences('2026-11-25', 'weekly', '2026-12-10', AS_OF, '2027-02-20')).toEqual(['2026-11-25', '2026-12-02', '2026-12-09']);
    expect(occurrences('2026-06-15', 'quarterly', null, AS_OF, '2027-02-20')).toEqual(['2026-12-15']);
    expect(occurrences('2026-01-05', 'none', null, AS_OF, '2027-02-20')).toEqual([]);
  });

  it('adds and removes items in a scenario only', () => {
    const base = inputs({ scheduled: [{ id: 'rent', label: 'Rent', direction: 'out', amountMinor: 450_000n, startDate: '2026-12-01', recurrence: 'monthly', endDate: null, categoryCode: 'rent', isEstimate: false, source: 'owner_entered', seriesKey: null }] });
    const overrides: ScenarioOverride[] = [
      { type: 'remove_item', item_id: 'rent' },
      { type: 'add_item', label: 'New contract', direction: 'in', amount_minor: '300000', date: '2026-12-05', recurrence: 'monthly' },
    ];
    const s = runForecast(base, overrides);
    expect(s.weeks.flatMap(w => w.lines).map(l => l.source)).toEqual(['scenario', 'scenario', 'scenario']);
    expect(runForecast(base).weeks.flatMap(w => w.lines)).toHaveLength(3);
  });

  it('changes payroll occurrences by a fixed amount', () => {
    const base = inputs({ scheduled: [{ id: 'pay', label: 'Payroll', direction: 'out', amountMinor: 1_800_000n, startDate: '2026-11-26', recurrence: 'monthly', endDate: null, categoryCode: 'salaries_wages', isEstimate: false, source: 'owner_entered', seriesKey: null }] });
    const s = runForecast(base, [{ type: 'payroll_delta_minor', amount_minor: '200000' }]);
    expect(s.weeks.flatMap(w => w.lines).map(l => l.amountMinor)).toEqual([2_000_000n, 2_000_000n, 2_000_000n]);
    expect(runForecast(inputs(), [{ type: 'payroll_delta_minor', amount_minor: '1' }]).assumptions.map(a => a.key)).toContain('payroll_delta_unused');
  });

  it('scales inflows by a revenue change, rounding each line once and recording it', () => {
    const base = inputs({ receivables: [{ id: 'i', number: 'N', partyKey: 'k', partyName: 'P', dueDate: '2026-12-01', outstandingMinor: 333n }] });
    const s = runForecast(base, [{ type: 'revenue_delta_pct', pct: '-10' }]);
    expect(s.weeks[1].inMinor).toBe(300n);
    expect(s.trace).toContainEqual({ key: 'revenue_delta:invoice:i', exact: '299.7', rounded: '300', mode: 'half_away_from_zero' });
  });

  it('reports the first week below the owner\'s buffer', () => {
    const r = runForecast({ ...shortfall, bufferMinor: 6_000_000n });
    expect(r.firstBelowBufferWeek).toBe(0);
    expect(runForecast({ ...shortfall, bufferMinor: 4_000_000n }).firstBelowBufferWeek).toBe(1);
  });
});

describe('detected recurring series', () => {
  const rentHistory = ['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05', '2026-11-05']
    .map((d, n) => tx(`rent-${n}`, d, -300_000n, { categoryCode: 'rent', categoryKind: 'expense', costBehavior: 'fixed', description: 'Shop rent Abdali' }));

  it('includes an unconfirmed series, labelled detected', () => {
    const r = runForecast(inputs({ history: rentHistory }));
    expect(r.detectedSeries).toEqual([expect.objectContaining({ direction: 'out', cadence: 'monthly', amountMinor: 300_000n, nextDate: '2026-12-05', status: 'included' })]);
    const lines = r.weeks.flatMap(w => w.lines).filter(l => l.source === 'detected');
    expect(lines.map(l => l.date)).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
    expect(r.assumptions.find(a => a.key === 'detected_series')?.handle?.type).toBe('remove_item');
  });

  it('drops a series the owner removed, or removes it in a scenario only', () => {
    const key = runForecast(inputs({ history: rentHistory })).detectedSeries[0].key;
    const dismissed = runForecast(inputs({ history: rentHistory, dismissedSeries: [key] }));
    expect(dismissed.detectedSeries[0].status).toBe('dismissed');
    expect(dismissed.weeks.every(w => w.outMinor === 0n)).toBe(true);
    const scenario = runForecast(inputs({ history: rentHistory }), [{ type: 'remove_item', item_id: `series:${key}` }]);
    expect(scenario.detectedSeries[0].status).toBe('removed_in_scenario');
  });

  it('does not double count a series the owner already entered or confirmed', () => {
    const rent = { id: 'rent', label: 'Rent', direction: 'out' as const, amountMinor: 300_000n, startDate: '2026-12-05', recurrence: 'monthly' as const, endDate: null, categoryCode: 'rent', isEstimate: false, source: 'owner_entered' as const, seriesKey: null };
    const covered = runForecast(inputs({ history: rentHistory, scheduled: [rent] }));
    expect(covered.detectedSeries[0].status).toBe('covered');
    expect(covered.weeks.flatMap(w => w.lines).filter(l => l.source === 'detected')).toEqual([]);
  });

  it('never detects transfers, owner equity, financing or invoice-matched receipts', () => {
    const monthly = (kind: ForecastHistoryTransaction['categoryKind'], matched = false) => ['2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10', '2026-11-10']
      .map((d, n) => tx(`${kind}-${matched}-${n}`, d, 500_000n, { categoryKind: kind, categoryCode: kind, description: `${kind} move`, matched }));
    const r = runForecast(inputs({ history: [...monthly('transfer'), ...monthly('owner_equity'), ...monthly('financing'), ...monthly('income', true)] }));
    expect(r.detectedSeries).toEqual([]);
  });
});

describe('variable spend band', () => {
  it('is a P25–P75 band from the trailing 13 weeks, kept out of the base line', () => {
    // Weekly supplies spend of 100, 200 … 1,300 JOD over the 13 weeks before 22 Nov.
    const weekly = Array.from({ length: 13 }, (_, k) => {
      const start = new Date(Date.UTC(2026, 10, 22 - 7 * (k + 1)));
      return tx(`v${k}`, start.toISOString().slice(0, 10), -BigInt((k + 1) * 100_000), { categoryCode: 'supplies', categoryKind: 'expense', costBehavior: 'variable', description: `market run ${k}` });
    });
    const r = runForecast(inputs({ history: weekly }));
    expect(r.variableSpend).toEqual({ p25Minor: 400_000n, p50Minor: 700_000n, p75Minor: 1_000_000n, weeksObserved: 13 });
    expect(r.weeks[0].closingMinor).toBe(5_000_000n);
    expect(r.weeks[0].bandLowMinor).toBe(4_000_000n);
    expect(r.weeks[1].bandHighMinor).toBe(4_200_000n);
  });

  it('is absent without variable-cost history', () => {
    expect(runForecast(inputs()).variableSpend).toBeNull();
  });
});
