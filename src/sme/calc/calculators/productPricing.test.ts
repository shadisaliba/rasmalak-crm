import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { catalogueEntry, contextWithoutRules, getCalculator, runCalculation } from '../core/run';
import type { CalcContext } from '../core/types';
import { figure, missingMessageKeys, moneyResult, ok, testRuleContext } from './testSupport';

// R16: no real rate appears here. TEST_ rule versions carry an obviously fictional 10 %.
const noRules = contextWithoutRules('2026-11-22');
const withTestRate = testRuleContext('2026-11-22', { 'jo.gst.standard_rate': { value: '10', unit: 'percent' } });

const imported = {
  currency: 'JOD',
  unit_cost: '12400', // 12.400 JOD from the supplier
  freight: '850',
  import_costs: '1150',
  overhead_per_unit: '2000',
  target_margin_percent: '35',
  sales_tax_mode: 'excluded',
};

const run = (input: Record<string, string>, ctx: CalcContext = withTestRate) => runCalculation('product_pricing', input, ctx).outcome;

describe('product_pricing (F4.07)', () => {
  it('prices an imported product for a 35 % margin with tax added on top (golden)', () => {
    const r = runCalculation('product_pricing', imported, withTestRate);
    expect(r.version).toBe('1.0.0');
    const o = ok(r.outcome);
    // Full cost 12.400 + 0.850 + 1.150 + 2.000 = 16.400; 16.400 / 0.65 = 25.2307692… → 25.231 JOD.
    expect(figure(o, 'full_unit_cost')).toEqual(moneyResult('16400'));
    expect(figure(o, 'price_before_tax')).toEqual(moneyResult('25231'));
    // TEST rate 10 %: 2.5231 → 2.523; 25.231 + 2.523 = 27.754.
    expect(figure(o, 'tax_amount')).toEqual(moneyResult('2523'));
    expect(figure(o, 'price_after_tax')).toEqual(moneyResult('27754'));
    // Contribution leaves out overhead: 25.231 − 14.400 = 10.831; profit 25.231 − 16.400 = 8.831.
    expect(figure(o, 'unit_contribution')).toEqual(moneyResult('10831'));
    expect(figure(o, 'unit_profit')).toEqual(moneyResult('8831'));
    expect(o.output.figures.filter(f => f.primary).map(f => f.key)).toEqual(['price_before_tax', 'unit_contribution']);
    expect(o.ruleVersionIds).toEqual(['TEST_jo.gst.standard_rate']);
    expect(o.assumptions.find(a => a.key === 'tax_rate')).toEqual({ key: 'tax_rate', messageKey: 'calc.product_pricing.assumption.tax_rate_rule', values: { rate: '10' }, source: 'rule' });
  });

  it('fails closed with RULE_NOT_VERIFIED when no reviewed rate exists and none is entered', () => {
    expect(run(imported, noRules)).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'RULE_NOT_VERIFIED', field: 'sales_tax_rate_unverified' })] });
    expect(catalogueEntry(getCalculator('product_pricing')!, noRules)).toEqual(expect.objectContaining({ availability: 'needs_rule', missingRules: ['jo.gst.standard_rate'] }));
    // The built-in example carries no rate, so it stops here too.
    expect(runCalculation('product_pricing', getCalculator('product_pricing')!.example, noRules).outcome.ok).toBe(false);
  });

  it('uses a rate the user enters, labelled unverified, when no reviewed rate exists', () => {
    const o = ok(run({ ...imported, sales_tax_rate_unverified: '10' }, noRules));
    expect(figure(o, 'price_after_tax')).toEqual(moneyResult('27754'));
    expect(o.ruleVersionIds).toEqual([]);
    expect(o.assumptions.find(a => a.key === 'tax_rate')).toEqual({ key: 'tax_rate', messageKey: 'calc.product_pricing.assumption.tax_rate_unverified', values: { rate: '10' }, source: 'unverified_user_rate' });
  });

  it('prefers a reviewed rate over one typed in, and says so', () => {
    const o = ok(run({ ...imported, sales_tax_rate_unverified: '3.3' }));
    expect(figure(o, 'tax_amount')).toEqual(moneyResult('2523'));
    expect(o.warnings.map(w => w.key)).toEqual(['unverified_rate_ignored']);
  });

  it('makes inclusive and exclusive pricing explicit, and they round differently', () => {
    // 1.000 JOD at a 40 % margin is 1.6666… before tax.
    const base = { currency: 'JOD', unit_cost: '1000', target_margin_percent: '40' };
    // Excluded: 1.667 + 0.167 tax = 1.834.
    const excluded = ok(run({ ...base, sales_tax_mode: 'excluded' }));
    expect([figure(excluded, 'price_before_tax'), figure(excluded, 'tax_amount'), figure(excluded, 'price_after_tax')]).toEqual([moneyResult('1667'), moneyResult('167'), moneyResult('1834')]);
    // Included: shelf price 1.8333… → 1.833, tax inside it 1.833 × 10 / 110 = 0.1666… → 0.167, before tax 1.666.
    const included = ok(run({ ...base, sales_tax_mode: 'included' }));
    expect([figure(included, 'price_before_tax'), figure(included, 'tax_amount'), figure(included, 'price_after_tax')]).toEqual([moneyResult('1666'), moneyResult('167'), moneyResult('1833')]);
    expect(included.output.figures.filter(f => f.primary).map(f => f.key)).toEqual(['price_after_tax', 'unit_contribution']);
    expect(included.assumptions[0].messageKey).toBe('calc.product_pricing.assumption.tax_mode_included');
  });

  it('needs no rate when no sales tax applies', () => {
    const o = ok(run({ ...imported, sales_tax_mode: 'none' }, noRules));
    expect(figure(o, 'price_before_tax')).toEqual(moneyResult('25231'));
    expect(figure(o, 'tax_amount')).toEqual({ kind: 'none', reasonKey: 'calc.product_pricing.none.no_tax' });
    expect(figure(o, 'price_after_tax')).toEqual({ kind: 'none', reasonKey: 'calc.product_pricing.none.no_tax' });
    expect(o.ruleVersionIds).toEqual([]);
    expect(ok(run({ ...imported, sales_tax_mode: 'none', sales_tax_rate_unverified: '10' }, noRules)).warnings.map(w => w.key)).toEqual(['rate_not_used']);
  });

  it('requires the tax mode to be chosen', () => {
    const withoutMode = Object.fromEntries(Object.entries(imported).filter(([k]) => k !== 'sales_tax_mode'));
    expect(run(withoutMode)).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'sales_tax_mode' })] });
  });

  it('rejects a margin of 100 % or more, and negative inputs', () => {
    for (const margin of ['100', '150']) {
      expect(run({ ...imported, target_margin_percent: margin })).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'target_margin_percent', messageKey: 'calc.product_pricing.error.margin_too_high' })] });
    }
    expect(run({ ...imported, target_margin_percent: '-5' }).ok).toBe(false);
    expect(run({ ...imported, freight: '-1' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'freight', messageKey: 'tools.error.negative_not_allowed' })] });
  });

  it('prices at cost with a zero margin and at zero with zero costs', () => {
    const atCost = ok(run({ ...imported, target_margin_percent: '0' }));
    expect(figure(atCost, 'price_before_tax')).toEqual(moneyResult('16400'));
    expect(figure(atCost, 'unit_profit')).toEqual(moneyResult('0'));
    const nothing = ok(run({ currency: 'JOD', unit_cost: '0', target_margin_percent: '30', sales_tax_mode: 'excluded' }));
    expect(figure(nothing, 'price_after_tax')).toEqual(moneyResult('0'));
    expect(nothing.warnings.map(w => w.key)).toEqual(['nothing_to_price']);
  });

  it('handles a decimal margin and records each rounding', () => {
    // 7.777 JOD at 12.5 %: 7.777 / 0.875 = 8.888 exactly; TEST tax 0.8888 → 0.889.
    const o = ok(run({ currency: 'JOD', unit_cost: '7777', target_margin_percent: '12.5', sales_tax_mode: 'excluded' }));
    expect(figure(o, 'price_before_tax')).toEqual(moneyResult('8888'));
    expect(o.trace.find(s => s.labelKey.endsWith('trace.tax_added'))?.rounding).toEqual({ mode: 'half_away_from_zero', exact: '888.8', rounded: '889' });
  });

  it('handles 3-decimal JOD amounts exactly (property test over random fils values)', () => {
    let seed = 20261122;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    for (let n = 0; n < 200; n++) {
      const [cost, freight, overhead] = [BigInt(next() % 9_000_000), BigInt(next() % 500_000), BigInt(next() % 500_000)];
      const margin = `${next() % 90}.${next() % 100}`;
      const o = ok(run({ currency: 'JOD', unit_cost: cost.toString(), freight: freight.toString(), overhead_per_unit: overhead.toString(), target_margin_percent: margin, sales_tax_mode: 'excluded' }));
      const before = BigInt(new Decimal((cost + freight + overhead).toString()).div(new Decimal(1).minus(new Decimal(margin).div(100))).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      const tax = BigInt(new Decimal(before.toString()).mul('0.1').toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      expect(figure(o, 'price_before_tax')).toEqual(moneyResult(before));
      expect(figure(o, 'price_after_tax')).toEqual(moneyResult(before + tax));
      expect(figure(o, 'unit_contribution')).toEqual(moneyResult(before - cost - freight));
    }
  });

  it('every key it can show exists in Arabic and English', () => {
    for (const outcome of [
      run(imported), run({ ...imported, sales_tax_mode: 'included' }), run({ ...imported, sales_tax_mode: 'none', sales_tax_rate_unverified: '1' }),
      run({ ...imported, sales_tax_rate_unverified: '1' }, noRules), run({ ...imported, sales_tax_rate_unverified: '1' }), run(imported, noRules),
      run({ ...imported, target_margin_percent: '100' }), run({ currency: 'JOD', unit_cost: '0', target_margin_percent: '0', sales_tax_mode: 'none' }),
    ]) {
      expect(missingMessageKeys(outcome)).toEqual([]);
    }
  });
});
