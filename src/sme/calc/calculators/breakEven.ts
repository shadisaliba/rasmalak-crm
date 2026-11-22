import { z } from 'zod';
import { defineCalculator } from '../core/define';
import type { CalcOutcome, ResultTable, ResultValue, TraceStep, Warning } from '../core/types';
import { ceilToInteger, countValue, currencyField, dec, Dec, majorText, minorField, noneValue, percentValue, roundingNote, roundMinor } from '../core/values';
import { checkedMoney } from './shared';

// F4.02: break-even units = fixed costs / (unit price − unit variable cost), rounded up.
export const BREAK_EVEN_VERSION = '1.0.0';

const SENSITIVITY_STEPS = [
  { key: 'minus_20', percent: '-20' },
  { key: 'minus_10', percent: '-10' },
  { key: 'base', percent: '0' },
  { key: 'plus_10', percent: '10' },
  { key: 'plus_20', percent: '20' },
];

const input = z.object({
  currency: currencyField,
  fixed_costs: minorField(),
  unit_price: minorField(),
  unit_variable_cost: minorField(),
});
type Input = z.infer<typeof input>;

const P = 'calc.break_even';

function compute(i: Input): CalcOutcome {
  const contribution = i.unit_price - i.unit_variable_cost;
  if (contribution <= 0n) {
    return { ok: false, errors: [{ code: 'NEGATIVE_CONTRIBUTION', field: 'unit_price', messageKey: `${P}.error.negative_contribution` }] };
  }

  const unitsExact = dec(i.fixed_costs).div(dec(contribution));
  const units = ceilToInteger(unitsExact);
  // Sales at the rounded-up unit count: a whole number of units at a whole price needs no rounding.
  const sales = units * i.unit_price;
  const margin = dec(contribution).div(dec(i.unit_price));

  const trace: TraceStep[] = [
    {
      labelKey: `${P}.trace.unit_contribution`, formula: 'unit_price − unit_variable_cost',
      inputs: { unit_price: majorText(i.unit_price, i.currency), unit_variable_cost: majorText(i.unit_variable_cost, i.currency) },
      result: majorText(contribution, i.currency),
    },
    {
      labelKey: `${P}.trace.units`, formula: 'fixed_costs / unit_contribution, rounded up to a whole unit',
      inputs: { fixed_costs: majorText(i.fixed_costs, i.currency), unit_contribution: majorText(contribution, i.currency) },
      result: units.toString(), rounding: roundingNote(unitsExact, units, 'up'),
    },
    {
      labelKey: `${P}.trace.sales`, formula: 'break_even_units × unit_price',
      inputs: { break_even_units: units.toString(), unit_price: majorText(i.unit_price, i.currency) },
      result: majorText(sales, i.currency),
    },
  ];

  // Rows move the price, columns move the variable cost; each cell is the break-even units.
  const unitsAt = (pricePercent: string, costPercent: string): ResultValue => {
    const price = dec(i.unit_price).mul(new Dec(100).plus(pricePercent)).div(100);
    const cost = dec(i.unit_variable_cost).mul(new Dec(100).plus(costPercent)).div(100);
    const cellContribution = price.minus(cost);
    if (cellContribution.lte(0)) return noneValue(`${P}.none.negative_contribution`);
    return countValue(ceilToInteger(dec(i.fixed_costs).div(cellContribution)));
  };
  const sensitivity: ResultTable = {
    key: 'sensitivity', titleKey: `${P}.table.sensitivity`, kind: 'sensitivity',
    columns: [
      { key: 'unit_price', labelKey: `${P}.col.unit_price` },
      ...SENSITIVITY_STEPS.map(c => ({ key: `cost_${c.key}`, labelKey: `${P}.col.cost_${c.key}` })),
    ],
    rows: SENSITIVITY_STEPS.map(r => ({
      key: `price_${r.key}`,
      labelKey: `${P}.row.price_${r.key}`,
      cells: {
        unit_price: checkedMoney(roundMinor(dec(i.unit_price).mul(new Dec(100).plus(r.percent)).div(100)), i.currency),
        ...Object.fromEntries(SENSITIVITY_STEPS.map(c => [`cost_${c.key}`, unitsAt(r.percent, c.percent)])),
      },
    })),
  };

  const warnings: Warning[] = i.fixed_costs === 0n ? [{ key: 'no_fixed_costs', messageKey: `${P}.warning.no_fixed_costs` }] : [];

  return {
    ok: true,
    output: {
      figures: [
        { key: 'break_even_units', labelKey: `${P}.figure.break_even_units`, value: countValue(units), primary: true },
        { key: 'break_even_sales', labelKey: `${P}.figure.break_even_sales`, value: checkedMoney(sales, i.currency), primary: true },
        { key: 'unit_contribution', labelKey: `${P}.figure.unit_contribution`, value: checkedMoney(contribution, i.currency) },
        { key: 'contribution_margin', labelKey: `${P}.figure.contribution_margin`, value: percentValue(margin) },
      ],
      tables: [sensitivity],
    },
    trace,
    assumptions: [
      { key: 'same_period', messageKey: `${P}.assumption.same_period`, source: 'default' },
      { key: 'linear', messageKey: `${P}.assumption.linear`, source: 'default' },
    ],
    warnings,
    ruleVersionIds: [],
  };
}

export const breakEven = defineCalculator<Input>({
  code: 'break_even',
  version: BREAK_EVEN_VERSION,
  blueprintId: 'F4.02',
  group: 'pricing',
  complexity: 'basic',
  input,
  example: { currency: 'JOD', fixed_costs: '2500000', unit_price: '3500', unit_variable_cost: '1250' },
  fields: [
    { key: 'fixed_costs', kind: 'money', period: 'per_period', labelKey: `${P}.field.fixed_costs`, helpKey: `${P}.help.fixed_costs` },
    { key: 'unit_price', kind: 'money', period: 'per_unit', labelKey: `${P}.field.unit_price`, helpKey: `${P}.help.unit_price` },
    { key: 'unit_variable_cost', kind: 'money', period: 'per_unit', labelKey: `${P}.field.unit_variable_cost`, helpKey: `${P}.help.unit_variable_cost` },
  ],
  compute,
});
