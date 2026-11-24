import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { contextWithoutRules, getCalculator, runCalculation } from '../core/run';
import { STARTUP_CATEGORIES } from './startupCost';
import { figure, missingMessageKeys, moneyResult, ok, table } from './testSupport';

const ctx = contextWithoutRules('2026-11-22');

// The calculator's own example: a small café, with no official fees entered.
const cafe = getCalculator('startup_cost')!.example as { items: Record<string, string>[] } & Record<string, unknown>;

const run = (input: Record<string, unknown>) => runCalculation('startup_cost', input, ctx).outcome;
const item = (category: string, low: string, base: string, high: string) => ({ name: 'Item', category, low, base, high });

describe('startup_cost (F4.05)', () => {
  it('gives the funding range for a café (golden)', () => {
    const r = runCalculation('startup_cost', cafe, ctx);
    expect(r.version).toBe('1.0.0');
    // One-off: low 3,500 + 6,000 + 1,200 + 1,500 + 400 = 12,600; likely 15,900; high 20,500.
    // Running costs 2,800 × 3 = 8,400. Safety margin 10 %: 2,100 / 2,430 / 2,890.
    // Funding: 12,600 + 8,400 + 2,100 = 23,100; 26,730; 31,790.
    expect(figure(r.outcome, 'funding_low')).toEqual(moneyResult('23100000'));
    expect(figure(r.outcome, 'funding_base')).toEqual(moneyResult('26730000'));
    expect(figure(r.outcome, 'funding_high')).toEqual(moneyResult('31790000'));
    expect(figure(r.outcome, 'one_off_base')).toEqual(moneyResult('15900000'));
    expect(figure(r.outcome, 'operating')).toEqual(moneyResult('8400000'));
  });

  it('lists every category as a checklist, marking the ones with nothing entered', () => {
    const t = table(run(cafe), 'breakdown');
    expect(t.kind).toBe('breakdown');
    expect(t.rows.map(r => r.key)).toEqual([...STARTUP_CATEGORIES, 'operating', 'contingency', 'total']);
    const row = (key: string) => t.rows.find(r => r.key === key)!;
    expect(row('fit_out').cells).toEqual({ low: moneyResult('6000000'), base: moneyResult('8000000'), high: moneyResult('11000000') });
    expect(row('registration_licensing').cells.base).toEqual({ kind: 'none', reasonKey: 'calc.startup_cost.none.not_entered' });
    expect(row('contingency').cells.base).toEqual(moneyResult('2430000'));
    expect(row('total').cells.high).toEqual(moneyResult('31790000'));
    expect(row('operating').labelValues).toEqual({ months: '3' });
  });

  it('never supplies official fees: it warns when none are entered and uses only what the user types', () => {
    const withoutFees = ok(run(cafe));
    expect(withoutFees.warnings.map(w => w.key)).toEqual(['no_official_fees']);
    expect(withoutFees.assumptions.find(a => a.key === 'user_entered_amounts')?.source).toBe('user');
    expect(withoutFees.ruleVersionIds).toEqual([]);

    // An obviously made-up amount: the calculator must carry whatever the user types.
    const testFee = { ...item('registration_licensing', '111111', '123456', '133333'), name: 'TEST_fee' };
    const withFees = ok(run({ ...cafe, items: [...cafe.items, testFee] }));
    expect(withFees.warnings).toEqual([]);
    // Likely subtotal 15,900 + 123.456 + 8,400 = 24,423.456; 10 % = 2,442.3456 → 2,442.346; total 26,865.802.
    expect(figure(withFees, 'funding_base')).toEqual(moneyResult('26865802'));
  });

  it('rejects an item whose estimates are out of order, on that item’s field', () => {
    const outcome = run({ ...cafe, items: [item('equipment', '1000', '900', '1200'), item('fit_out', '500', '600', '550')] });
    expect(outcome).toEqual({
      ok: false,
      errors: [
        expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'items.0.low', messageKey: 'calc.startup_cost.error.low_above_base' }),
        expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'items.1.high', messageKey: 'calc.startup_cost.error.high_below_base' }),
      ],
    });
  });

  it('gives zero with a warning when nothing is entered', () => {
    const outcome = ok(run({ currency: 'JOD', items: [], monthly_operating_costs: '0', months_to_cover: '0', contingency_percent: '0' }));
    expect(figure(outcome, 'funding_base')).toEqual(moneyResult('0'));
    expect(outcome.warnings.map(w => w.key)).toEqual(['no_official_fees', 'nothing_entered']);
  });

  it('rejects negative amounts, fractional months and an unnamed item', () => {
    expect(run({ ...cafe, items: [item('equipment', '-1', '0', '0')] })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'items.0.low', messageKey: 'tools.error.negative_not_allowed' })] });
    expect(run({ ...cafe, monthly_operating_costs: '-1' }).ok).toBe(false);
    expect(run({ ...cafe, months_to_cover: '2.5' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'months_to_cover', messageKey: 'tools.error.not_an_integer' })] });
    expect(run({ ...cafe, items: [{ ...item('equipment', '1', '1', '1'), name: '  ' }] }).ok).toBe(false);
  });

  it('rounds the safety margin once, half away from zero, and records it', () => {
    // 0.333 JOD at 7.5 % is 24.975 fils, rounded to 25: total 0.358 JOD.
    const outcome = ok(run({ currency: 'JOD', items: [item('other', '333', '333', '333')], monthly_operating_costs: '0', months_to_cover: '0', contingency_percent: '7.5' }));
    expect(figure(outcome, 'funding_base')).toEqual(moneyResult('358'));
    expect(outcome.trace.find(s => s.labelKey.endsWith('contingency_base'))?.rounding).toEqual({ mode: 'half_away_from_zero', exact: '24.975', rounded: '25' });
  });

  it('handles 3-decimal JOD amounts exactly (property test over random fils values)', () => {
    let seed = 20261122;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    for (let n = 0; n < 100; n++) {
      const items = Array.from({ length: 1 + (next() % 8) }, () => {
        const low = BigInt(next() % 5_000_000);
        const base = low + BigInt(next() % 1_000_000);
        return { low, base, high: base + BigInt(next() % 1_000_000) };
      });
      const monthly = BigInt(next() % 3_000_000);
      const months = BigInt(next() % 13);
      const contingency = `${next() % 30}.${next() % 10}`;
      const outcome = ok(run({
        currency: 'JOD', monthly_operating_costs: monthly.toString(), months_to_cover: months.toString(), contingency_percent: contingency,
        items: items.map(it => item('equipment', it.low.toString(), it.base.toString(), it.high.toString())),
      }));
      for (const s of ['low', 'base', 'high'] as const) {
        const subtotal = items.reduce((t, it) => t + it[s], 0n) + monthly * months;
        const margin = new Decimal(subtotal.toString()).mul(contingency).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
        expect(figure(outcome, `funding_${s}`)).toEqual(moneyResult(subtotal + BigInt(margin)));
      }
    }
  });

  it('every key it can show exists in Arabic and English', () => {
    const fields = getCalculator('startup_cost')!.fields;
    expect(fields.find(f => f.key === 'items')?.kind).toBe('items');
    for (const outcome of [
      run(cafe), run({ ...cafe, items: [item('equipment', '2', '1', '1'), item('fit_out', '1', '2', '1')] }),
      run({ currency: 'JOD', items: [], monthly_operating_costs: '0', months_to_cover: '0', contingency_percent: '0' }),
    ]) {
      expect(missingMessageKeys(outcome)).toEqual([]);
    }
  });
});
