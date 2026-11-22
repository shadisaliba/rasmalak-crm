import { z } from 'zod';
import { defineCalculator } from '../core/define';
import type { CalcOutcome, ResultTable, TraceStep } from '../core/types';
import { currencyField, dec, decimalField, Dec, hoursValue, majorText, minorField, moneyValue, percentValue, roundMinor, roundingNote } from '../core/values';

// F4.08: hourly rate = (target pay + overhead + target profit) / realistic billable hours.
export const SERVICE_HOURLY_RATE_VERSION = '1.0.0';

const SENSITIVITY_UTILIZATION = ['50', '60', '70', '80', '90'];
const DEFAULT_DAYS_PER_WEEK = '5';

const input = z.object({
  currency: currencyField,
  target_annual_pay: minorField(),
  annual_overhead: minorField(),
  target_profit: minorField(),
  working_weeks: decimalField({ min: '0', max: '53' }),
  hours_per_week: decimalField({ min: '0', max: '168' }),
  utilization_percent: decimalField({ min: '0', max: '100' }),
  days_per_week: decimalField({ min: '1', max: '7' }).optional(),
});
type Input = z.infer<typeof input>;

const P = 'calc.service_hourly_rate';

function compute(i: Input): CalcOutcome {
  // Zero billable hours cannot price anything: block the input that makes it zero (CAL-S01).
  const zeroField = i.working_weeks.isZero() ? 'working_weeks' : i.hours_per_week.isZero() ? 'hours_per_week' : i.utilization_percent.isZero() ? 'utilization_percent' : null;
  if (zeroField) {
    return { ok: false, errors: [{ code: 'ZERO_DENOMINATOR', field: zeroField, messageKey: `${P}.error.zero_hours` }] };
  }

  const revenue = i.target_annual_pay + i.annual_overhead + i.target_profit;
  const daysPerWeek = i.days_per_week ?? new Dec(DEFAULT_DAYS_PER_WEEK);
  const hoursPerDay = i.hours_per_week.div(daysPerWeek);
  const ratesAt = (utilizationPercent: Dec) => {
    const billable = i.working_weeks.mul(i.hours_per_week).mul(utilizationPercent).div(100);
    const hourlyExact = dec(revenue).div(billable);
    // The day rate comes from the exact hourly rate, so money is rounded once per figure.
    const dayExact = hourlyExact.mul(hoursPerDay);
    return { billable, hourlyExact, hourly: roundMinor(hourlyExact), dayExact, day: roundMinor(dayExact) };
  };
  const base = ratesAt(i.utilization_percent);

  const trace: TraceStep[] = [
    {
      labelKey: `${P}.trace.revenue`, formula: 'target_annual_pay + annual_overhead + target_profit',
      inputs: { target_annual_pay: majorText(i.target_annual_pay, i.currency), annual_overhead: majorText(i.annual_overhead, i.currency), target_profit: majorText(i.target_profit, i.currency) },
      result: majorText(revenue, i.currency),
    },
    {
      labelKey: `${P}.trace.billable_hours`, formula: 'working_weeks × hours_per_week × utilization_percent / 100',
      inputs: { working_weeks: i.working_weeks.toString(), hours_per_week: i.hours_per_week.toString(), utilization_percent: i.utilization_percent.toString() },
      result: base.billable.toString(),
    },
    {
      labelKey: `${P}.trace.hourly_rate`, formula: 'required_revenue / billable_hours',
      inputs: { required_revenue: majorText(revenue, i.currency), billable_hours: base.billable.toString() },
      result: majorText(base.hourly, i.currency), rounding: roundingNote(base.hourlyExact, base.hourly),
    },
    {
      labelKey: `${P}.trace.day_rate`, formula: 'hourly_rate × hours_per_week / days_per_week',
      inputs: { hourly_rate_exact_minor: base.hourlyExact.toString(), hours_per_week: i.hours_per_week.toString(), days_per_week: daysPerWeek.toString() },
      result: majorText(base.day, i.currency), rounding: roundingNote(base.dayExact, base.day),
    },
  ];

  const sensitivity: ResultTable = {
    key: 'utilization', titleKey: `${P}.table.utilization`, kind: 'sensitivity',
    columns: [
      { key: 'utilization', labelKey: `${P}.col.utilization` },
      { key: 'billable_hours', labelKey: `${P}.col.billable_hours` },
      { key: 'hourly_rate', labelKey: `${P}.col.hourly_rate` },
      { key: 'day_rate', labelKey: `${P}.col.day_rate` },
    ],
    rows: SENSITIVITY_UTILIZATION.map(u => {
      const r = ratesAt(new Dec(u));
      return {
        key: `u${u}`,
        cells: {
          utilization: percentValue(new Dec(u).div(100)),
          billable_hours: hoursValue(r.billable),
          hourly_rate: moneyValue(r.hourly, i.currency),
          day_rate: moneyValue(r.day, i.currency),
        },
      };
    }),
  };

  return {
    ok: true,
    output: {
      figures: [
        { key: 'hourly_rate', labelKey: `${P}.figure.hourly_rate`, value: moneyValue(base.hourly, i.currency), primary: true },
        { key: 'day_rate', labelKey: `${P}.figure.day_rate`, value: moneyValue(base.day, i.currency), primary: true },
        { key: 'required_revenue', labelKey: `${P}.figure.required_revenue`, value: moneyValue(revenue, i.currency) },
        { key: 'billable_hours', labelKey: `${P}.figure.billable_hours`, value: hoursValue(base.billable) },
      ],
      tables: [sensitivity],
    },
    trace,
    assumptions: [
      i.days_per_week
        ? { key: 'days_per_week', messageKey: `${P}.assumption.days_per_week`, values: { days: daysPerWeek.toString() }, source: 'user' }
        : { key: 'days_per_week', messageKey: `${P}.assumption.days_per_week`, values: { days: DEFAULT_DAYS_PER_WEEK }, source: 'default' },
      // Tax is explained, never computed here (CAL-S01).
      { key: 'tax_excluded', messageKey: `${P}.assumption.tax_excluded`, source: 'default' },
    ],
    warnings: revenue === 0n ? [{ key: 'nothing_to_cover', messageKey: `${P}.warning.nothing_to_cover` }] : [],
    ruleVersionIds: [],
  };
}

export const serviceHourlyRate = defineCalculator<Input>({
  code: 'service_hourly_rate',
  version: SERVICE_HOURLY_RATE_VERSION,
  blueprintId: 'F4.08',
  group: 'pricing',
  complexity: 'basic',
  input,
  example: {
    currency: 'JOD', target_annual_pay: '24000000', annual_overhead: '6000000', target_profit: '2400000',
    working_weeks: '46', hours_per_week: '40', utilization_percent: '60',
  },
  fields: [
    { key: 'target_annual_pay', kind: 'money', period: 'per_year', labelKey: `${P}.field.target_annual_pay`, helpKey: `${P}.help.target_annual_pay` },
    { key: 'annual_overhead', kind: 'money', period: 'per_year', labelKey: `${P}.field.annual_overhead`, helpKey: `${P}.help.annual_overhead` },
    { key: 'target_profit', kind: 'money', period: 'per_year', labelKey: `${P}.field.target_profit` },
    { key: 'working_weeks', kind: 'number', unit: 'weeks', min: '0', max: '53', labelKey: `${P}.field.working_weeks`, helpKey: `${P}.help.working_weeks` },
    { key: 'hours_per_week', kind: 'number', unit: 'hours', min: '0', max: '168', labelKey: `${P}.field.hours_per_week` },
    { key: 'utilization_percent', kind: 'percent', min: '0', max: '100', labelKey: `${P}.field.utilization_percent`, helpKey: `${P}.help.utilization_percent` },
    { key: 'days_per_week', kind: 'number', unit: 'days', min: '1', max: '7', optional: true, labelKey: `${P}.field.days_per_week` },
  ],
  compute,
});
