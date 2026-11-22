import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { contextWithoutRules, runCalculation } from '../core/run';
import { figure, missingMessageKeys, moneyResult, ok, table } from './testSupport';

const ctx = contextWithoutRules('2026-11-22');

const cafe = {
  currency: 'JOD',
  fixed_costs: '2500000', // 2,500.000 JOD a month
  unit_price: '3500', // 3.500 JOD a cup
  unit_variable_cost: '1250',
};

const run = (overrides: Record<string, string> = {}) => runCalculation('break_even', { ...cafe, ...overrides }, ctx).outcome;

describe('break_even (F4.02)', () => {
  it('finds the units and sales a café needs to cover its fixed costs (golden)', () => {
    const r = runCalculation('break_even', cafe, ctx);
    expect(r.version).toBe('1.0.0');
    // Contribution 3.500 − 1.250 = 2.250 JOD; 2,500 / 2.250 = 1,111.11… units, rounded up to 1,112.
    expect(figure(r.outcome, 'break_even_units')).toEqual({ kind: 'count', value: '1112' });
    // 1,112 × 3.500 = 3,892.000 JOD.
    expect(figure(r.outcome, 'break_even_sales')).toEqual(moneyResult('3892000'));
    expect(figure(r.outcome, 'unit_contribution')).toEqual(moneyResult('2250'));
    // 2.250 / 3.500 = 64.2857 %.
    expect(figure(r.outcome, 'contribution_margin')).toEqual({ kind: 'percent', value: '64.2857' });
  });

  it('rounds units up, never to nearest, and records it in the trace', () => {
    const step = ok(run()).trace.find(s => s.labelKey.endsWith('trace.units'));
    expect(step?.rounding).toEqual({ mode: 'up', exact: '1111.111111111111111111111111111111111111', rounded: '1112' });
    // 2,250.001 / 2.250 = 1,000.0004 units: the fraction still needs one more whole unit.
    expect(figure(run({ fixed_costs: '2250001' }), 'break_even_units')).toEqual({ kind: 'count', value: '1001' });
    // An exact division is not pushed up.
    expect(figure(run({ fixed_costs: '2250000' }), 'break_even_units')).toEqual({ kind: 'count', value: '1000' });
  });

  it('shows a price × variable cost grid at ±10 % and ±20 % (golden)', () => {
    const grid = table(run(), 'sensitivity');
    expect(grid.kind).toBe('sensitivity');
    expect(grid.rows.map(r => r.key)).toEqual(['price_minus_20', 'price_minus_10', 'price_base', 'price_plus_10', 'price_plus_20']);
    const units = (row: number) => ['cost_minus_20', 'cost_minus_10', 'cost_base', 'cost_plus_10', 'cost_plus_20'].map(c => (grid.rows[row].cells[c] as { value: string }).value);
    // Price 2.800 and cost 1.000: 2,500 / 1.800 = 1,388.9 → 1,389.
    expect(units(0)).toEqual(['1389', '1493', '1613', '1755', '1924']);
    // The centre cell is the headline figure.
    expect(units(2)).toEqual(['1000', '1053', '1112', '1177', '1250']);
    // Price 4.200 and cost 1.500: 2,500 / 2.700 = 925.9 → 926.
    expect(units(4)).toEqual(['782', '814', '848', '885', '926']);
    expect(grid.rows[0].cells.unit_price).toEqual(moneyResult('2800'));
    expect(grid.rows[4].cells.unit_price).toEqual(moneyResult('4200'));
  });

  it('marks a grid cell where the price no longer covers the cost as not applicable', () => {
    // Price 1.000 and cost 0.900: at price −20 % (0.800) every cost scenario but −20 % (0.720) loses money.
    const grid = table(run({ unit_price: '1000', unit_variable_cost: '900' }), 'sensitivity');
    expect(grid.rows[0].cells.cost_minus_20).toEqual({ kind: 'count', value: String(new Decimal(2500000).div(80).ceil()) });
    expect(grid.rows[0].cells.cost_base).toEqual({ kind: 'none', reasonKey: 'calc.break_even.none.negative_contribution' });
    expect(grid.rows[0].cells.cost_plus_20).toEqual({ kind: 'none', reasonKey: 'calc.break_even.none.negative_contribution' });
  });

  it('blocks a price at or below the variable cost with NEGATIVE_CONTRIBUTION', () => {
    for (const overrides of [{ unit_price: '1250' }, { unit_price: '1000' }, { unit_price: '0' }]) {
      expect(run(overrides)).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'NEGATIVE_CONTRIBUTION', field: 'unit_price', messageKey: 'calc.break_even.error.negative_contribution' })] });
    }
  });

  it('breaks even at zero units when there are no fixed costs, and says so', () => {
    const outcome = ok(run({ fixed_costs: '0' }));
    expect(figure(outcome, 'break_even_units')).toEqual({ kind: 'count', value: '0' });
    expect(figure(outcome, 'break_even_sales')).toEqual(moneyResult('0'));
    expect(outcome.warnings.map(w => w.key)).toEqual(['no_fixed_costs']);
  });

  it('rejects negative money and decimal strings as amounts', () => {
    expect(run({ fixed_costs: '-1' })).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'fixed_costs', messageKey: 'tools.error.negative_not_allowed' })] });
    expect(run({ unit_variable_cost: '-5' }).ok).toBe(false);
    // Wire money is whole minor units; 1.5 is not a number of fils.
    expect(run({ unit_price: '1.5' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'unit_price', messageKey: 'tools.error.not_an_amount' })] });
  });

  it('works to the fil with 3-decimal JOD amounts', () => {
    // 1.001 JOD of fixed costs and 0.001 JOD of contribution: exactly 1,001 units, 1,001 × 0.002 = 2.002 JOD.
    const outcome = ok(run({ fixed_costs: '1001', unit_price: '2', unit_variable_cost: '1' }));
    expect(figure(outcome, 'break_even_units')).toEqual({ kind: 'count', value: '1001' });
    expect(figure(outcome, 'break_even_sales')).toEqual(moneyResult('2002'));
  });

  it('handles 3-decimal JOD amounts exactly (property test over random fils values)', () => {
    let seed = 20261122;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    for (let n = 0; n < 200; n++) {
      const fixed = BigInt(next()) * 3n + BigInt(next() % 1000);
      const cost = BigInt(next() % 50_000);
      const price = cost + 1n + BigInt(next() % 50_000);
      const outcome = ok(run({ fixed_costs: fixed.toString(), unit_price: price.toString(), unit_variable_cost: cost.toString() }));
      const units = new Decimal(fixed.toString()).div((price - cost).toString()).ceil();
      expect(figure(outcome, 'break_even_units')).toEqual({ kind: 'count', value: units.toFixed(0) });
      expect(figure(outcome, 'break_even_sales')).toEqual(moneyResult(BigInt(units.toFixed(0)) * price));
    }
  });

  it('every key it can show exists in Arabic and English', () => {
    for (const outcome of [run(), run({ fixed_costs: '0' }), run({ unit_price: '1000', unit_variable_cost: '900' }), run({ unit_price: '0' })]) {
      expect(missingMessageKeys(outcome)).toEqual([]);
    }
  });
});
