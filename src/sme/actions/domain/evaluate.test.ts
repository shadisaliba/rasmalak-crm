import { describe, expect, it } from 'vitest';
import { evaluateRules } from './evaluate';
import type { ActionInputs, ExpenseTx } from './types';

const TODAY = '2026-11-24';

function inputs(over: Partial<ActionInputs> = {}): ActionInputs {
  return {
    today: TODAY, invoices: [], bills: [], forecast: null, accounts: [],
    uncategorized: { count: 0, total: 0 }, expenses: [], revenue: [],
    ...over,
  };
}
const codes = (i: ActionInputs) => evaluateRules(i).actions.map(a => a.dedupe_key);

describe('evaluation', () => {
  it('is deterministic and gives one candidate per rule, subject and period', () => {
    const i = inputs({
      invoices: [{ id: 'inv-1', number: 'A-1', partyKey: 'company:c', partyName: 'Al-Noor', dueDate: '2026-11-01', outstandingMinor: 500_000n }],
      bills: [{ id: 'bill-1', reference: 'S-9', partyName: 'Amman Supplies', dueDate: '2026-11-27', outstandingMinor: 80_000n }],
    });
    expect(evaluateRules(i)).toEqual(evaluateRules(i));
    expect(new Set(codes(i)).size).toBe(codes(i).length);
    expect(evaluateRules(i).ruleCodes).toHaveLength(7);
  });

  it('lets an organization switch a rule off or change its threshold', () => {
    const i = inputs({ invoices: [{ id: 'inv', number: 'A-1', partyKey: 'k', partyName: 'P', dueDate: '2026-11-20', outstandingMinor: 1n }] });
    expect(codes(i)).toEqual(['receivable_overdue:inv']);
    expect(evaluateRules(i, { receivable_overdue: { enabled: false, params: {} } }).actions).toEqual([]);
    expect(evaluateRules(i, { receivable_overdue: { enabled: true, params: { min_days_overdue: 7 } } }).actions).toEqual([]);
    // A disabled rule still counts as evaluated, so its open actions resolve.
    expect(evaluateRules(i, { receivable_overdue: { enabled: false, params: {} } }).ruleCodes).toContain('receivable_overdue');
  });
});

describe('receivable_overdue', () => {
  const inv = (dueDate: string) => inputs({ invoices: [{ id: 'inv', number: 'A-77', partyKey: 'k', partyName: 'Al-Noor', dueDate, outstandingMinor: 500_000n }] });

  it('flags an invoice past its due date with the numbers behind it', () => {
    const [a] = evaluateRules(inv('2026-11-14')).actions;
    expect(a).toMatchObject({ severity: 'warning', subject_type: 'invoice', subject_id: 'inv', required_perm: 'sme.receivables.read' });
    expect(a.params).toEqual({ customer: 'Al-Noor', number: 'A-77', amount: '500000', days: 10, due: '2026-11-14' });
    expect(a.evidence.map(e => [e.label_key, e.value])).toEqual([
      ['actions.evidence.outstanding', '500000'], ['actions.evidence.dueDate', '2026-11-14'], ['actions.evidence.daysOverdue', '10'],
    ]);
  });

  it('is critical after 30 days and silent before the due date', () => {
    expect(evaluateRules(inv('2026-10-20')).actions[0].severity).toBe('critical');
    expect(evaluateRules(inv('2026-11-24')).actions).toEqual([]);
  });
});

describe('forecast_shortfall', () => {
  it('is critical below zero and a warning below the buffer', () => {
    const zero = evaluateRules(inputs({ forecast: { runId: 'run', belowZero: { weekStart: '2026-12-06', closingMinor: -3_000_000n }, belowBuffer: null } })).actions[0];
    expect(zero).toMatchObject({ dedupe_key: 'forecast_shortfall:zero', severity: 'critical', subject_id: 'run', params: { week: '2026-12-06', amount: '-3000000' } });
    const buffer = evaluateRules(inputs({ forecast: { runId: 'run', belowZero: null, belowBuffer: { weekStart: '2026-12-13', closingMinor: 900_000n, bufferMinor: 1_000_000n } } })).actions[0];
    expect(buffer).toMatchObject({ dedupe_key: 'forecast_shortfall:buffer', severity: 'warning', params: { buffer: '1000000' } });
    expect(evaluateRules(inputs({ forecast: { runId: 'run', belowZero: null, belowBuffer: null } })).actions).toEqual([]);
  });
});

describe('payables_due_soon', () => {
  const bill = (dueDate: string) => inputs({ bills: [{ id: 'b', reference: 'S-9', partyName: 'Amman Supplies', dueDate, outstandingMinor: 80_000n }] });
  it('flags bills due within 7 days, and overdue ones more strongly', () => {
    expect(evaluateRules(bill('2026-11-30')).actions[0]).toMatchObject({ severity: 'info', title_key: 'actions.rule.payables_due_soon.soon.title', params: { days: 6 } });
    expect(evaluateRules(bill('2026-11-20')).actions[0]).toMatchObject({ severity: 'warning', title_key: 'actions.rule.payables_due_soon.overdue.title', params: { days: 4 } });
    expect(evaluateRules(bill('2026-12-10')).actions).toEqual([]);
  });
});

describe('stale_account_data and uncategorized_backlog', () => {
  it('flags accounts quiet for more than 14 days, or never used', () => {
    const a = evaluateRules(inputs({ accounts: [
      { id: 'fresh', name: 'Bank', lastActivity: '2026-11-20' },
      { id: 'quiet', name: 'Cash box', lastActivity: '2026-11-01' },
      { id: 'new', name: 'Wallet', lastActivity: null },
    ] })).actions;
    expect(a.map(x => x.dedupe_key)).toEqual(['stale_account_data:quiet', 'stale_account_data:new']);
    expect(a[1].title_key).toBe('actions.rule.stale_account_data.empty.title');
  });

  it('flags a backlog of uncategorized lines by count or share', () => {
    expect(codes(inputs({ uncategorized: { count: 25, total: 1000 } }))).toEqual(['uncategorized_backlog']);
    expect(codes(inputs({ uncategorized: { count: 5, total: 20 } }))).toEqual(['uncategorized_backlog']);
    expect(codes(inputs({ uncategorized: { count: 5, total: 100 } }))).toEqual([]);
  });
});

describe('concentration_risk', () => {
  it('flags a customer with half or more of the revenue', () => {
    const revenue = [
      { partyKey: 'company:a', partyName: 'Big Co', companyId: 'a', minor: 6_000_000n, invoices: 3 },
      { partyKey: 'company:b', partyName: 'Small Co', companyId: 'b', minor: 4_000_000n, invoices: 2 },
    ];
    expect(evaluateRules(inputs({ revenue })).actions[0]).toMatchObject({ dedupe_key: 'concentration_risk:company:a', params: { percent: 60 } });
    expect(evaluateRules(inputs({ revenue: [{ ...revenue[0], minor: 4_990_000n }, { ...revenue[1], minor: 5_010_000n }] })).actions[0].params.customer).toBe('Small Co');
    expect(evaluateRules(inputs({ revenue: [revenue[0]] })).actions).toEqual([]);
  });
});

describe('cost_spike', () => {
  const SHOPS = ['Carrefour', 'Safeway', 'Cozmo', 'Abu Odeh', 'Sameh Mall', 'Leader', 'Miles', 'Jabri', 'Habibah', 'Zalatimo', 'Rainbow', 'Galleria', 'Taj', 'Kasih', 'Wild Jordan', 'Duna', 'Nayef', 'Rumman'];
  it('flags a category spending far above its usual month', () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    // Day-to-day supplies from different shops on different days; rent is a fixed monthly payment.
    const expenses: ExpenseTx[] = months.flatMap((m, n) => [
      { id: `s${n}a`, date: `${m}-0${3 + n}`, amountMinor: -40_000n - BigInt(n * 1000), categoryCode: 'supplies' },
      { id: `s${n}b`, date: `${m}-${15 + n}`, amountMinor: -60_000n + BigInt(n * 500), categoryCode: 'supplies' },
      { id: `r${n}`, date: `${m}-01`, amountMinor: -300_000n, categoryCode: 'rent' },
    ]).map((t, k) => ({ ...t, description: t.categoryCode === 'rent' ? 'Shop rent' : SHOPS[k % SHOPS.length] }));
    expenses.push({ id: 'spike', date: '2026-11-15', amountMinor: -900_000n, categoryCode: 'supplies', description: 'equipment' });
    expenses.push({ id: 'rent-nov', date: '2026-11-01', amountMinor: -300_000n, categoryCode: 'rent', description: 'Shop rent' });
    const a = evaluateRules(inputs({ expenses })).actions.filter(x => x.rule_code === 'cost_spike');
    expect(a.map(x => x.dedupe_key)).toEqual(['cost_spike:supplies:2026-11']);
    expect(a[0].severity).toBe('warning');
  });
});
