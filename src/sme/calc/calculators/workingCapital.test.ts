import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { contextWithoutRules, getCalculator, runCalculation } from '../core/run';
import { figure, missingMessageKeys, moneyResult, ok } from './testSupport';

const ctx = contextWithoutRules('2026-11-22');

const trader: Record<string, string> = {
  currency: 'JOD',
  cash: '8200000',
  receivables: '14500000',
  inventory: '9800000',
  other_current_assets: '0',
  payables: '11300000',
  other_current_liabilities: '2500000',
  period_revenue: '45000000', // 45,000 JOD over the last quarter
  period_cogs: '30000000',
  period_days: '90',
};

const run = (input: Record<string, string | undefined>) => runCalculation('working_capital', input, ctx).outcome;
const without = (...keys: string[]) => Object.fromEntries(Object.entries(trader).filter(([k]) => !keys.includes(k)));
const days = (value: string) => ({ kind: 'days', value });

describe('working_capital (F4.04)', () => {
  it('works out working capital, the current ratio and the cash cycle for a trader (golden)', () => {
    const r = runCalculation('working_capital', trader, ctx);
    expect(r.version).toBe('1.0.0');
    const o = r.outcome;
    // Assets 8,200 + 14,500 + 9,800 = 32,500; debts 11,300 + 2,500 = 13,800; working capital 18,700.
    expect(figure(o, 'current_assets')).toEqual(moneyResult('32500000'));
    expect(figure(o, 'current_liabilities')).toEqual(moneyResult('13800000'));
    expect(figure(o, 'working_capital')).toEqual(moneyResult('18700000'));
    // 32,500 / 13,800 = 2.35507… → 2.3551.
    expect(figure(o, 'current_ratio')).toEqual({ kind: 'ratio', value: '2.3551' });
    // DSO 14,500 / 45,000 × 90 = 29; DIO 9,800 / 30,000 × 90 = 29.4; DPO 11,300 / 30,000 × 90 = 33.9.
    expect(figure(o, 'dso')).toEqual(days('29'));
    expect(figure(o, 'dio')).toEqual(days('29.4'));
    expect(figure(o, 'dpo')).toEqual(days('33.9'));
    // 29 + 29.4 − 33.9 = 24.5 days.
    expect(figure(o, 'cash_conversion_cycle')).toEqual(days('24.5'));
  });

  it('prefills cash, receivables and payables from the organization’s records', () => {
    const prefills = Object.fromEntries(getCalculator('working_capital')!.fields.flatMap(f => (f.kind === 'money' && f.prefill ? [[f.key, f.prefill]] : [])));
    expect(prefills).toEqual({ cash: 'cash_total', receivables: 'receivables_outstanding', payables: 'payables_outstanding' });
  });

  it('needs the period length whenever revenue or cost of sales is given (PERIOD_MISMATCH)', () => {
    for (const input of [without('period_days'), { ...trader, period_days: '0' }, { ...without('period_days', 'period_cogs') }]) {
      expect(run(input)).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'PERIOD_MISMATCH', field: 'period_days' })] });
    }
  });

  it('gives each ratio only when its denominator is valid, with the reason otherwise', () => {
    const balancesOnly = ok(run(without('period_revenue', 'period_cogs', 'period_days')));
    expect(figure(balancesOnly, 'working_capital')).toEqual(moneyResult('18700000'));
    expect(figure(balancesOnly, 'dso')).toEqual({ kind: 'none', reasonKey: 'calc.working_capital.none.needs_revenue' });
    expect(figure(balancesOnly, 'dpo')).toEqual({ kind: 'none', reasonKey: 'calc.working_capital.none.needs_cogs' });
    expect(figure(balancesOnly, 'cash_conversion_cycle')).toEqual({ kind: 'none', reasonKey: 'calc.working_capital.none.needs_all_days' });

    // A services business: sales but no cost of sales gives DSO and nothing that needs COGS.
    const services = ok(run({ ...without('period_cogs'), period_revenue: '45000000' }));
    expect(figure(services, 'dso')).toEqual(days('29'));
    expect(figure(services, 'dio')).toEqual({ kind: 'none', reasonKey: 'calc.working_capital.none.needs_cogs' });

    const noDebts = ok(run({ ...trader, payables: '0', other_current_liabilities: '0' }));
    expect(figure(noDebts, 'current_ratio')).toEqual({ kind: 'none', reasonKey: 'calc.working_capital.none.no_liabilities' });
    expect(figure(noDebts, 'dpo')).toEqual(days('0'));
  });

  it('counts balances left empty as zero and says so', () => {
    const outcome = ok(run(without('inventory', 'other_current_assets', 'other_current_liabilities')));
    // 8,200 + 14,500 − 11,300 = 11,400.
    expect(figure(outcome, 'working_capital')).toEqual(moneyResult('11400000'));
    expect(figure(outcome, 'dio')).toEqual(days('0'));
    expect(outcome.assumptions.map(a => a.key)).toEqual(expect.arrayContaining(['inventory_zero', 'other_current_assets_zero', 'other_current_liabilities_zero']));
  });

  it('allows an overdrawn cash balance and warns about it and about negative working capital', () => {
    const outcome = ok(run({ ...trader, cash: '-30000000' }));
    // −30,000 + 14,500 + 9,800 − 13,800 = −19,500.
    expect(figure(outcome, 'working_capital')).toEqual(moneyResult('-19500000'));
    expect(outcome.warnings.map(w => w.key)).toEqual(['negative_working_capital', 'negative_cash']);
    // Receivables and payables are never negative.
    expect(run({ ...trader, receivables: '-1' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'receivables', messageKey: 'tools.error.negative_not_allowed' })] });
  });

  it('rejects a fractional number of days', () => {
    expect(run({ ...trader, period_days: '30.5' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'period_days', messageKey: 'tools.error.not_an_integer' })] });
  });

  it('works to the fil with 3-decimal JOD amounts', () => {
    // 1.001 owed by customers on 3.003 of sales over 30 days = 10 days exactly.
    const outcome = ok(run({ ...trader, cash: '1', receivables: '1001', inventory: '0', payables: '2', other_current_liabilities: '0', period_revenue: '3003', period_cogs: '7', period_days: '30' }));
    expect(figure(outcome, 'working_capital')).toEqual(moneyResult('1000'));
    expect(figure(outcome, 'current_ratio')).toEqual({ kind: 'ratio', value: '501' });
    expect(figure(outcome, 'dso')).toEqual(days('10'));
    // 0.002 / 0.007 × 30 = 8.571… → 8.6 days.
    expect(figure(outcome, 'dpo')).toEqual(days('8.6'));
  });

  it('handles 3-decimal JOD amounts exactly (property test over random fils values)', () => {
    let seed = 20261122;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    for (let n = 0; n < 200; n++) {
      const v = () => BigInt(next() % 90_000_000);
      const [cash, rec, inv, pay, rev, cogs] = [v(), v(), v(), 1n + v(), 1n + v(), 1n + v()];
      const periodDays = String(1 + (next() % 366));
      const outcome = ok(run({ currency: 'JOD', cash: cash.toString(), receivables: rec.toString(), inventory: inv.toString(), payables: pay.toString(), period_revenue: rev.toString(), period_cogs: cogs.toString(), period_days: periodDays }));
      const d = (x: bigint) => new Decimal(x.toString());
      const one = (x: Decimal) => x.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString();
      const dso = d(rec).div(d(rev)).mul(periodDays);
      const dio = d(inv).div(d(cogs)).mul(periodDays);
      const dpo = d(pay).div(d(cogs)).mul(periodDays);
      expect(figure(outcome, 'working_capital')).toEqual(moneyResult(cash + rec + inv - pay));
      expect(figure(outcome, 'cash_conversion_cycle')).toEqual(days(one(dso.plus(dio).minus(dpo))));
    }
  });

  it('every key it can show exists in Arabic and English', () => {
    for (const outcome of [
      run(trader), run(without('period_revenue', 'period_cogs', 'period_days')), run(without('inventory', 'other_current_assets', 'other_current_liabilities')),
      run({ ...trader, cash: '-30000000', payables: '0', other_current_liabilities: '0' }), run(without('period_days')),
    ]) {
      expect(missingMessageKeys(outcome)).toEqual([]);
    }
  });
});
