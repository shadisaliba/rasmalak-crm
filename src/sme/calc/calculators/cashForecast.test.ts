import { describe, expect, it } from 'vitest';
import { catalogueEntry, contextWithoutRules, getCalculator, listCalculators, runCalculation } from '../core/run';
import { CALCULATOR_CODES } from '../core/types';

const ctx = contextWithoutRules('2026-11-22');

describe('cash_forecast (F4.01)', () => {
  it('opens the thirteen-week forecast screen and never computes figures of its own', () => {
    const calc = getCalculator('cash_forecast')!;
    expect(calc).toEqual(expect.objectContaining({ version: '1.0.0', blueprintId: 'F4.01', group: 'cash_planning', fields: [], example: {} }));
    expect(catalogueEntry(calc, ctx)).toEqual(expect.objectContaining({ availability: 'available', screen: '/crm/money/forecast' }));
    expect(runCalculation('cash_forecast', {}, ctx).outcome).toEqual({ ok: false, errors: [{ code: 'DATA_INCOMPLETE', messageKey: 'calc.cash_forecast.onScreen' }] });
  });
});

describe('calculator registry', () => {
  it('registers every calculator code once, at version 1.0.0, with its blueprint id', () => {
    expect(listCalculators().map(c => c.code)).toEqual([...CALCULATOR_CODES]);
    expect(Object.fromEntries(listCalculators().map(c => [c.code, `${c.blueprintId} ${c.version}`]))).toEqual({
      cash_forecast: 'F4.01 1.0.0', break_even: 'F4.02 1.0.0', margin_markup: 'F4.03 1.0.0', working_capital: 'F4.04 1.0.0',
      startup_cost: 'F4.05 1.0.0', loan_affordability: 'F4.06 1.0.0', product_pricing: 'F4.07 1.0.0',
      service_hourly_rate: 'F4.08 1.0.0', employee_cost: 'F4.09 1.0.0',
    });
  });

  it('names a regulated parameter only where a Jordanian rate is needed', () => {
    expect(Object.fromEntries(listCalculators().filter(c => c.ruleParams.length > 0).map(c => [c.code, c.ruleParams.map(r => r.key)]))).toEqual({
      product_pricing: ['jo.gst.standard_rate'],
      employee_cost: ['jo.ssc.employer_rate', 'jo.ssc.wage_cap_monthly'],
    });
  });
});
