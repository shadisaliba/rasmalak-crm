import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { catalogueEntry, contextWithoutRules, getCalculator, runCalculation } from '../core/run';
import type { CalcContext } from '../core/types';
import { figure, missingMessageKeys, moneyResult, ok, table, testRuleContext } from './testSupport';

// R16: no real SSC rate or cap appears here. TEST_ rule versions carry obviously fictional values:
// a 10 % employer rate and a 500.000 JOD monthly cap.
const noRules = contextWithoutRules('2026-11-22');
const rateOnly = () => testRuleContext('2026-11-22', { 'jo.ssc.employer_rate': { value: '10', unit: 'percent' } });
const rateAndCap = () => testRuleContext('2026-11-22', {
  'jo.ssc.employer_rate': { value: '10', unit: 'percent' },
  'jo.ssc.wage_cap_monthly': { value: '500000', unit: 'money_minor' },
});

const hire = {
  currency: 'JOD',
  gross_monthly_wage: '650000', // 650.000 JOD
  allowances: '100000',
  other_employer_costs: '45000',
  start_date: '2027-01-01',
  ssc_base: 'wage_and_allowances',
};

const run = (input: Record<string, string>, ctx: CalcContext = rateOnly()) => runCalculation('employee_cost', input, ctx).outcome;
const hireWithoutBase = Object.fromEntries(Object.entries(hire).filter(([k]) => k !== 'ssc_base'));

describe('employee_cost (F4.09)', () => {
  it('adds the employer’s social security share to pay and other costs (golden)', () => {
    const r = runCalculation('employee_cost', hire, rateOnly());
    expect(r.version).toBe('1.0.0');
    const o = ok(r.outcome);
    // Base 650 + 100 = 750; TEST rate 10 % = 75; monthly 650 + 100 + 75 + 45 = 870; yearly × 12 = 10,440.
    expect(figure(o, 'ssc_base')).toEqual(moneyResult('750000'));
    expect(figure(o, 'employer_ssc')).toEqual(moneyResult('75000'));
    expect(figure(o, 'monthly_cost')).toEqual(moneyResult('870000'));
    expect(figure(o, 'annual_cost')).toEqual(moneyResult('10440000'));
    expect(o.ruleVersionIds).toEqual(['TEST_jo.ssc.employer_rate']);
    // No reviewed cap: none is applied, and the result says so.
    expect(o.assumptions.find(a => a.key === 'wage_cap')).toEqual({ key: 'wage_cap', messageKey: 'calc.employee_cost.assumption.no_wage_cap', source: 'default' });

    const t = table(o, 'breakdown');
    expect(t.rows.map(row => row.key)).toEqual(['wage', 'allowances', 'employer_ssc', 'other_costs', 'total']);
    expect(t.rows[2].cells).toEqual({ monthly: moneyResult('75000'), annual: moneyResult('900000') });
    expect(t.rows[4].cells).toEqual({ monthly: moneyResult('870000'), annual: moneyResult('10440000') });
  });

  it('looks rules up on the start date, not the calculation date', () => {
    const ctx = rateAndCap();
    run(hire, ctx);
    expect(ctx.askedOn).toEqual({ 'jo.ssc.employer_rate': '2027-01-01', 'jo.ssc.wage_cap_monthly': '2027-01-01' });
  });

  it('applies a reviewed wage cap', () => {
    const o = ok(run(hire, rateAndCap()));
    // 750 is above the TEST cap of 500: 500 × 10 % = 50; monthly 650 + 100 + 50 + 45 = 845.
    expect(figure(o, 'ssc_base')).toEqual(moneyResult('500000'));
    expect(figure(o, 'employer_ssc')).toEqual(moneyResult('50000'));
    expect(figure(o, 'monthly_cost')).toEqual(moneyResult('845000'));
    expect(o.ruleVersionIds).toEqual(['TEST_jo.ssc.employer_rate', 'TEST_jo.ssc.wage_cap_monthly']);
    expect(o.warnings.map(w => w.key)).toEqual(['cap_applied']);
    // Below the cap nothing changes.
    expect(figure(run({ ...hire, gross_monthly_wage: '300000', allowances: '0' }, rateAndCap()), 'employer_ssc')).toEqual(moneyResult('30000'));
  });

  it('fails closed with RULE_NOT_VERIFIED when no reviewed rate exists and none is entered', () => {
    expect(run(hire, noRules)).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'RULE_NOT_VERIFIED', field: 'employer_ssc_rate_unverified' })] });
    expect(catalogueEntry(getCalculator('employee_cost')!, noRules)).toEqual(expect.objectContaining({ availability: 'needs_rule', missingRules: ['jo.ssc.employer_rate', 'jo.ssc.wage_cap_monthly'] }));
    expect(runCalculation('employee_cost', getCalculator('employee_cost')!.example, noRules).outcome.ok).toBe(false);
  });

  it('proceeds with a rate the user enters, labelled unverified and entered by them, and no cap', () => {
    // A made-up 3.3 %: 750 × 3.3 % = 24.750; monthly 650 + 100 + 24.750 + 45 = 819.750; yearly 9,837.
    const o = ok(run({ ...hire, employer_ssc_rate_unverified: '3.3' }, noRules));
    expect(figure(o, 'employer_ssc')).toEqual(moneyResult('24750'));
    expect(figure(o, 'monthly_cost')).toEqual(moneyResult('819750'));
    expect(figure(o, 'annual_cost')).toEqual(moneyResult('9837000'));
    expect(o.ruleVersionIds).toEqual([]);
    expect(o.assumptions.map(a => [a.key, a.source])).toEqual(expect.arrayContaining([['ssc_rate', 'unverified_user_rate'], ['wage_cap', 'default']]));
    expect(o.assumptions.find(a => a.key === 'ssc_rate')?.values).toEqual({ rate: '3.3' });
  });

  it('prefers a reviewed rate over one typed in, and says so', () => {
    const o = ok(run({ ...hire, employer_ssc_rate_unverified: '3.3' }));
    expect(figure(o, 'employer_ssc')).toEqual(moneyResult('75000'));
    expect(o.warnings.map(w => w.key)).toEqual(['unverified_rate_ignored']);
  });

  it('leaves the social security base to the user when there are allowances', () => {
    expect(run(hireWithoutBase)).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'ssc_base' })] });
    // Wage only: 650 × 10 % = 65.
    expect(figure(run({ ...hire, ssc_base: 'wage_only' }), 'employer_ssc')).toEqual(moneyResult('65000'));
    // Without allowances the choice does not matter and may be left out.
    const noAllowances = ok(run({ ...hireWithoutBase, allowances: '0' }));
    expect(figure(noAllowances, 'employer_ssc')).toEqual(moneyResult('65000'));
    expect(noAllowances.assumptions.find(a => a.key === 'ssc_base')?.source).toBe('default');
  });

  it('refuses a reviewed JOD cap on a wage in another currency', () => {
    expect(run({ ...hire, currency: 'USD' }, rateAndCap())).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'CURRENCY_MISMATCH', field: 'currency' })] });
  });

  it('treats a rule in a unit it cannot read as not published', () => {
    const odd = testRuleContext('2026-11-22', { 'jo.ssc.employer_rate': { value: '10', unit: 'number' } });
    expect(run(hire, odd)).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'RULE_NOT_VERIFIED' })] });
  });

  it('handles zero pay, negative amounts and bad dates', () => {
    const zero = ok(run({ ...hire, gross_monthly_wage: '0', allowances: '0', other_employer_costs: '0' }));
    expect(figure(zero, 'annual_cost')).toEqual(moneyResult('0'));
    expect(run({ ...hire, allowances: '-1' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'allowances', messageKey: 'tools.error.negative_not_allowed' })] });
    expect(run({ ...hire, start_date: '01/01/2027' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'start_date', messageKey: 'tools.error.not_a_date' })] });
    expect(run({ ...hire, employer_ssc_rate_unverified: '101' }, noRules).ok).toBe(false);
  });

  it('rounds the contribution once, half away from zero, and records it', () => {
    // 1.500 JOD at a made-up 3.3 % is 49.5 fils, rounded to 50.
    const o = ok(run({ ...hire, gross_monthly_wage: '1500', allowances: '0', other_employer_costs: '0', employer_ssc_rate_unverified: '3.3' }, noRules));
    expect(figure(o, 'employer_ssc')).toEqual(moneyResult('50'));
    expect(o.trace.find(s => s.labelKey.endsWith('trace.employer_ssc'))?.rounding).toEqual({ mode: 'half_away_from_zero', exact: '49.5', rounded: '50' });
  });

  it('handles 3-decimal JOD amounts exactly (property test over random fils values)', () => {
    let seed = 20261122;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    for (let n = 0; n < 200; n++) {
      const [wage, allowances, other] = [BigInt(next() % 5_000_000), BigInt(next() % 1_000_000), BigInt(next() % 500_000)];
      const rate = `${next() % 30}.${next() % 1000}`;
      const o = ok(run({ currency: 'JOD', gross_monthly_wage: wage.toString(), allowances: allowances.toString(), other_employer_costs: other.toString(), start_date: '2027-01-01', ssc_base: 'wage_and_allowances', employer_ssc_rate_unverified: rate }, noRules));
      const ssc = BigInt(new Decimal((wage + allowances).toString()).mul(rate).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      expect(figure(o, 'monthly_cost')).toEqual(moneyResult(wage + allowances + ssc + other));
      expect(figure(o, 'annual_cost')).toEqual(moneyResult((wage + allowances + ssc + other) * 12n));
    }
  });

  it('every key it can show exists in Arabic and English', () => {
    for (const outcome of [
      run(hire), run(hire, rateAndCap()), run({ ...hire, employer_ssc_rate_unverified: '1' }), run({ ...hire, employer_ssc_rate_unverified: '1' }, noRules),
      run({ ...hire, ssc_base: 'wage_only' }), run({ ...hireWithoutBase, allowances: '0' }), run(hireWithoutBase),
      run(hire, noRules), run({ ...hire, currency: 'USD' }, rateAndCap()),
    ]) {
      expect(missingMessageKeys(outcome)).toEqual([]);
    }
  });
});
