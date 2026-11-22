import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { contextWithoutRules, runCalculation } from '../core/run';
import type { CalcOutcome, ResultValue } from '../core/types';

const ctx = contextWithoutRules('2026-11-22');

const consultant = {
  currency: 'JOD',
  target_annual_pay: '24000000', // 24,000.000 JOD
  annual_overhead: '6000000',
  target_profit: '0',
  working_weeks: '46',
  hours_per_week: '40',
  utilization_percent: '60',
};

function ok(outcome: CalcOutcome) {
  if (!outcome.ok) throw new Error(`expected success, got ${JSON.stringify(outcome.errors)}`);
  return outcome;
}
function figure(outcome: CalcOutcome, key: string): ResultValue | undefined {
  return ok(outcome).output.figures.find(f => f.key === key)?.value;
}

describe('service_hourly_rate (F4.08, CAL-S01)', () => {
  it('prices a consultant from target income, overhead and billable hours (golden)', () => {
    const run = runCalculation('service_hourly_rate', consultant, ctx);
    expect(run.version).toBe('1.0.0');
    // 30,000 JOD over 46 × 40 × 60 % = 1,104 hours = 27.173913… JOD, rounded half away from zero.
    expect(figure(run.outcome, 'hourly_rate')).toEqual({ kind: 'money', minor: '27174', currency: 'JOD' });
    expect(figure(run.outcome, 'day_rate')).toEqual({ kind: 'money', minor: '217391', currency: 'JOD' });
    expect(figure(run.outcome, 'required_revenue')).toEqual({ kind: 'money', minor: '30000000', currency: 'JOD' });
    expect(figure(run.outcome, 'billable_hours')).toEqual({ kind: 'hours', value: '1104' });
  });

  it('shows utilization sensitivity from 50 % to 90 %', () => {
    const table = ok(runCalculation('service_hourly_rate', consultant, ctx).outcome).output.tables[0];
    expect(table.kind).toBe('sensitivity');
    expect(table.rows.map(r => r.cells.utilization)).toEqual(['50', '60', '70', '80', '90'].map(v => ({ kind: 'percent', value: v })));
    expect(table.rows[1].cells.hourly_rate).toEqual({ kind: 'money', minor: '27174', currency: 'JOD' });
    // Higher utilization means more billable hours and a lower rate.
    const rates = table.rows.map(r => BigInt((r.cells.hourly_rate as { minor: string }).minor));
    expect([...rates].sort((a, b) => (a > b ? -1 : 1))).toEqual(rates);
  });

  it('blocks zero billable hours with ZERO_DENOMINATOR on the input that causes it', () => {
    for (const field of ['working_weeks', 'hours_per_week', 'utilization_percent']) {
      const outcome = runCalculation('service_hourly_rate', { ...consultant, [field]: '0' }, ctx).outcome;
      expect(outcome).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'ZERO_DENOMINATOR', field })] });
    }
  });

  it('rejects negative money and out-of-range percentages', () => {
    const negative = runCalculation('service_hourly_rate', { ...consultant, annual_overhead: '-1' }, ctx).outcome;
    expect(negative).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'annual_overhead', messageKey: 'tools.error.negative_not_allowed' })] });
    const over = runCalculation('service_hourly_rate', { ...consultant, utilization_percent: '120' }, ctx).outcome;
    expect(over.ok).toBe(false);
  });

  it('rounds half away from zero, once, and records it in the trace', () => {
    // 3 fils over 2 hours is 1.5 fils.
    const outcome = ok(runCalculation('service_hourly_rate', { ...consultant, target_annual_pay: '3', annual_overhead: '0', working_weeks: '1', hours_per_week: '2', utilization_percent: '100' }, ctx).outcome);
    expect(outcome.output.figures[0].value).toEqual({ kind: 'money', minor: '2', currency: 'JOD' });
    expect(outcome.trace.find(s => s.labelKey.endsWith('hourly_rate'))?.rounding).toEqual({ mode: 'half_away_from_zero', exact: '1.5', rounded: '2' });
  });

  it('keeps tax out of the calculation and says so', () => {
    const outcome = ok(runCalculation('service_hourly_rate', consultant, ctx).outcome);
    expect(outcome.assumptions.map(a => a.key)).toContain('tax_excluded');
    expect(outcome.ruleVersionIds).toEqual([]);
  });

  it('handles 3-decimal JOD amounts exactly (property test over random fils values)', () => {
    let seed = 20261122;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    for (let n = 0; n < 200; n++) {
      const pay = BigInt(next()) * 7n + BigInt(next() % 1000);
      const overhead = BigInt(next() % 5_000_000);
      const weeks = String(1 + (next() % 52));
      const hours = String(1 + (next() % 60));
      const util = String(1 + (next() % 100));
      const outcome = ok(runCalculation('service_hourly_rate', { ...consultant, target_annual_pay: pay.toString(), annual_overhead: overhead.toString(), working_weeks: weeks, hours_per_week: hours, utilization_percent: util }, ctx).outcome);
      const billable = new Decimal(weeks).mul(hours).mul(util).div(100);
      const expected = new Decimal((pay + overhead).toString()).div(billable).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
      expect(outcome.output.figures[0].value).toEqual({ kind: 'money', minor: expected, currency: 'JOD' });
    }
  });
});
