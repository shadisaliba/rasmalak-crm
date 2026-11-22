import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { contextWithoutRules, runCalculation } from '../core/run';
import { figure, missingMessageKeys, moneyResult, ok, table } from './testSupport';

const ctx = contextWithoutRules('2026-11-22');

const shop = {
  currency: 'JOD',
  net_revenue: '18500000', // 18,500.000 JOD for the quarter
  cogs: '11100000',
};

const run = (overrides: Record<string, string> = {}) => runCalculation('margin_markup', { ...shop, ...overrides }, ctx).outcome;
const pct = (value: string) => ({ kind: 'percent', value });

describe('margin_markup (F4.03)', () => {
  it('shows gross profit, margin and markup for the same sales (golden)', () => {
    const r = runCalculation('margin_markup', shop, ctx);
    expect(r.version).toBe('1.0.0');
    // 18,500 − 11,100 = 7,400 JOD; 7,400 / 18,500 = 40 %; 7,400 / 11,100 = 66.6667 %.
    expect(figure(r.outcome, 'gross_profit')).toEqual(moneyResult('7400000'));
    expect(figure(r.outcome, 'gross_margin')).toEqual(pct('40'));
    expect(figure(r.outcome, 'markup')).toEqual(pct('66.6667'));
  });

  it('puts margin and markup side by side with what each is measured against', () => {
    const t = table(run(), 'side_by_side');
    expect(t.rows.map(r => r.key)).toEqual(['margin', 'markup']);
    expect(t.rows[0].cells).toEqual({ based_on: moneyResult('18500000'), gross_profit: moneyResult('7400000'), percent: pct('40') });
    expect(t.rows[1].cells).toEqual({ based_on: moneyResult('11100000'), gross_profit: moneyResult('7400000'), percent: pct('66.6667') });
  });

  it('blocks zero revenue with ZERO_DENOMINATOR', () => {
    expect(run({ net_revenue: '0' })).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'ZERO_DENOMINATOR', field: 'net_revenue' })] });
  });

  it('gives no markup and a warning when cost is zero', () => {
    const outcome = ok(run({ cogs: '0' }));
    expect(figure(outcome, 'gross_margin')).toEqual(pct('100'));
    expect(figure(outcome, 'markup')).toEqual({ kind: 'none', reasonKey: 'calc.margin_markup.none.no_cost' });
    expect(outcome.warnings.map(w => w.key)).toEqual(['no_cost']);
    expect(outcome.trace.map(s => s.labelKey)).not.toContain('calc.margin_markup.trace.markup');
  });

  it('shows a loss as a negative margin and markup, and warns', () => {
    // 1,000 − 1,250 = −250; −250 / 1,000 = −25 %; −250 / 1,250 = −20 %.
    const outcome = ok(run({ net_revenue: '1000000', cogs: '1250000' }));
    expect(figure(outcome, 'gross_profit')).toEqual(moneyResult('-250000'));
    expect(figure(outcome, 'gross_margin')).toEqual(pct('-25'));
    expect(figure(outcome, 'markup')).toEqual(pct('-20'));
    expect(outcome.warnings.map(w => w.key)).toEqual(['loss']);
  });

  it('rejects negative money', () => {
    expect(run({ cogs: '-1' })).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'cogs', messageKey: 'tools.error.negative_not_allowed' })] });
    expect(run({ net_revenue: '-100' }).ok).toBe(false);
  });

  it('works to the fil with 3-decimal JOD amounts', () => {
    // 10.005 − 3.335 = 6.670 JOD; 6.670 / 10.005 = 66.6667 %; 6.670 / 3.335 = exactly 200 %.
    const outcome = ok(run({ net_revenue: '10005', cogs: '3335' }));
    expect(figure(outcome, 'gross_profit')).toEqual(moneyResult('6670'));
    expect(figure(outcome, 'gross_margin')).toEqual(pct('66.6667'));
    expect(figure(outcome, 'markup')).toEqual(pct('200'));
  });

  it('handles 3-decimal JOD amounts exactly (property test over random fils values)', () => {
    let seed = 20261122;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    for (let n = 0; n < 200; n++) {
      const revenue = 1n + BigInt(next()) * 5n + BigInt(next() % 1000);
      const cogs = 1n + BigInt(next());
      const outcome = ok(run({ net_revenue: revenue.toString(), cogs: cogs.toString() }));
      const gp = revenue - cogs;
      const four = (d: Decimal) => d.mul(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
      expect(figure(outcome, 'gross_profit')).toEqual(moneyResult(gp));
      expect(figure(outcome, 'gross_margin')).toEqual(pct(four(new Decimal(gp.toString()).div(revenue.toString()))));
      expect(figure(outcome, 'markup')).toEqual(pct(four(new Decimal(gp.toString()).div(cogs.toString()))));
    }
  });

  it('every key it can show exists in Arabic and English', () => {
    for (const outcome of [run(), run({ cogs: '0' }), run({ cogs: '99999999' }), run({ net_revenue: '0' })]) {
      expect(missingMessageKeys(outcome)).toEqual([]);
    }
  });
});
