import { z } from 'zod';
import { defineCalculator } from '../core/define';
import type { Assumption, CalcContext, CalcOutcome, ResultFigure, TraceStep, Warning } from '../core/types';
import { currencyField, dec, Dec, decimalField, majorText, minorField, noneValue, roundingNote, roundMinor } from '../core/values';
import { checkedMoney } from './shared';

// F4.07: price before tax = full unit cost / (1 − target margin). The margin is on the pre-tax
// price; the sales tax rate comes only from a reviewed rule version or a rate the user enters (R16).
export const PRODUCT_PRICING_VERSION = '1.0.0';

export const SALES_TAX_RATE = { key: 'jo.gst.standard_rate' };

const input = z.object({
  currency: currencyField,
  unit_cost: minorField(),
  freight: minorField().optional(),
  import_costs: minorField().optional(),
  overhead_per_unit: minorField().optional(),
  target_margin_percent: decimalField({ min: '0' }),
  sales_tax_mode: z.enum(['excluded', 'included', 'none']),
  sales_tax_rate_unverified: decimalField({ min: '0', max: '100' }).optional(),
});
type Input = z.infer<typeof input>;

const P = 'calc.product_pricing';

type TaxRate = { percent: Dec; assumption: Assumption; ruleVersionIds: string[]; warnings: Warning[] };

function resolveTaxRate(i: Input, ctx: CalcContext): TaxRate | null {
  const param = ctx.getRuleParam(SALES_TAX_RATE, ctx.asOf);
  if (param && param.unit === 'percent') {
    return {
      percent: new Dec(param.value),
      assumption: { key: 'tax_rate', messageKey: `${P}.assumption.tax_rate_rule`, values: { rate: param.value }, source: 'rule' },
      ruleVersionIds: [param.ruleVersionId],
      // A reviewed rate always wins over one typed in.
      warnings: i.sales_tax_rate_unverified !== undefined ? [{ key: 'unverified_rate_ignored', messageKey: `${P}.warning.unverified_rate_ignored` }] : [],
    };
  }
  if (i.sales_tax_rate_unverified !== undefined) {
    const rate = i.sales_tax_rate_unverified.toString();
    return {
      percent: i.sales_tax_rate_unverified,
      assumption: { key: 'tax_rate', messageKey: `${P}.assumption.tax_rate_unverified`, values: { rate }, source: 'unverified_user_rate' },
      ruleVersionIds: [],
      warnings: [],
    };
  }
  return null;
}

function compute(i: Input, ctx: CalcContext): CalcOutcome {
  if (i.target_margin_percent.gte(100)) {
    return { ok: false, errors: [{ code: 'VALIDATION_FAILED', field: 'target_margin_percent', messageKey: `${P}.error.margin_too_high` }] };
  }
  let tax: TaxRate | null = null;
  if (i.sales_tax_mode !== 'none') {
    tax = resolveTaxRate(i, ctx);
    if (!tax) {
      return { ok: false, errors: [{ code: 'RULE_NOT_VERIFIED', field: 'sales_tax_rate_unverified', messageKey: `${P}.error.rule_not_verified` }] };
    }
  }

  const m = (v: bigint) => majorText(v, i.currency);
  const freight = i.freight ?? 0n;
  const importCosts = i.import_costs ?? 0n;
  const overhead = i.overhead_per_unit ?? 0n;
  const landedCost = i.unit_cost + freight + importCosts;
  const fullCost = landedCost + overhead;
  const priceExact = dec(fullCost).div(new Dec(1).minus(i.target_margin_percent.div(100)));

  const trace: TraceStep[] = [{
    labelKey: `${P}.trace.full_cost`, formula: 'unit_cost + freight + import_costs + overhead_per_unit',
    inputs: { unit_cost: m(i.unit_cost), freight: m(freight), import_costs: m(importCosts), overhead_per_unit: m(overhead) },
    result: m(fullCost),
  }];

  let before: bigint;
  let taxAmount: bigint | null = null;
  let after: bigint | null = null;
  if (!tax) {
    before = roundMinor(priceExact);
    trace.push({
      labelKey: `${P}.trace.price_before_tax`, formula: 'full_cost / (1 − target_margin_percent / 100)',
      inputs: { full_cost: m(fullCost), target_margin_percent: i.target_margin_percent.toString() },
      result: m(before), rounding: roundingNote(priceExact, before),
    });
  } else if (i.sales_tax_mode === 'excluded') {
    // Tax is charged on the invoiced pre-tax price.
    before = roundMinor(priceExact);
    const taxExact = dec(before).mul(tax.percent).div(100);
    taxAmount = roundMinor(taxExact);
    after = before + taxAmount;
    trace.push(
      {
        labelKey: `${P}.trace.price_before_tax`, formula: 'full_cost / (1 − target_margin_percent / 100)',
        inputs: { full_cost: m(fullCost), target_margin_percent: i.target_margin_percent.toString() },
        result: m(before), rounding: roundingNote(priceExact, before),
      },
      {
        labelKey: `${P}.trace.tax_added`, formula: 'price_before_tax × tax_rate_percent / 100',
        inputs: { price_before_tax: m(before), tax_rate_percent: tax.percent.toString() },
        result: m(taxAmount), rounding: roundingNote(taxExact, taxAmount),
      },
      {
        labelKey: `${P}.trace.price_after_tax`, formula: 'price_before_tax + tax',
        inputs: { price_before_tax: m(before), tax: m(taxAmount) },
        result: m(after),
      },
    );
  } else {
    // The shelf price is rounded first and the tax is taken out of it, as on a tax-inclusive receipt.
    const afterExact = priceExact.mul(new Dec(100).plus(tax.percent)).div(100);
    after = roundMinor(afterExact);
    const taxExact = dec(after).mul(tax.percent).div(new Dec(100).plus(tax.percent));
    taxAmount = roundMinor(taxExact);
    before = after - taxAmount;
    trace.push(
      {
        labelKey: `${P}.trace.price_after_tax`, formula: 'full_cost / (1 − target_margin_percent / 100) × (1 + tax_rate_percent / 100)',
        inputs: { full_cost: m(fullCost), target_margin_percent: i.target_margin_percent.toString(), tax_rate_percent: tax.percent.toString() },
        result: m(after), rounding: roundingNote(afterExact, after),
      },
      {
        labelKey: `${P}.trace.tax_included`, formula: 'price_after_tax × tax_rate_percent / (100 + tax_rate_percent)',
        inputs: { price_after_tax: m(after), tax_rate_percent: tax.percent.toString() },
        result: m(taxAmount), rounding: roundingNote(taxExact, taxAmount),
      },
      {
        labelKey: `${P}.trace.price_before_tax`, formula: 'price_after_tax − tax',
        inputs: { price_after_tax: m(after), tax: m(taxAmount) },
        result: m(before),
      },
    );
  }

  const contribution = before - landedCost;
  const profit = before - fullCost;
  trace.push({
    labelKey: `${P}.trace.unit_contribution`, formula: 'price_before_tax − (unit_cost + freight + import_costs)',
    inputs: { price_before_tax: m(before), landed_cost: m(landedCost) },
    result: m(contribution),
  });

  const noTax = noneValue(`${P}.none.no_tax`);
  const figures: ResultFigure[] = [
    { key: 'price_before_tax', labelKey: `${P}.figure.price_before_tax`, value: checkedMoney(before, i.currency), primary: i.sales_tax_mode !== 'included' },
    { key: 'tax_amount', labelKey: `${P}.figure.tax_amount`, value: taxAmount === null ? noTax : checkedMoney(taxAmount, i.currency) },
    { key: 'price_after_tax', labelKey: `${P}.figure.price_after_tax`, value: after === null ? noTax : checkedMoney(after, i.currency), primary: i.sales_tax_mode === 'included' },
    { key: 'unit_contribution', labelKey: `${P}.figure.unit_contribution`, value: checkedMoney(contribution, i.currency), primary: true },
    { key: 'unit_profit', labelKey: `${P}.figure.unit_profit`, value: checkedMoney(profit, i.currency) },
    { key: 'full_unit_cost', labelKey: `${P}.figure.full_unit_cost`, value: checkedMoney(fullCost, i.currency) },
  ];

  const assumptions: Assumption[] = [
    { key: 'tax_mode', messageKey: `${P}.assumption.tax_mode_${i.sales_tax_mode}`, source: 'user' },
    ...(tax ? [tax.assumption] : []),
    { key: 'margin_on_price', messageKey: `${P}.assumption.margin_on_price`, values: { margin: i.target_margin_percent.toString() }, source: 'user' },
    { key: 'import_costs_entered', messageKey: `${P}.assumption.import_costs_entered`, source: 'user' },
  ];

  const warnings: Warning[] = [...(tax?.warnings ?? [])];
  if (i.sales_tax_mode === 'none' && i.sales_tax_rate_unverified !== undefined) warnings.push({ key: 'rate_not_used', messageKey: `${P}.warning.rate_not_used` });
  if (fullCost === 0n) warnings.push({ key: 'nothing_to_price', messageKey: `${P}.warning.nothing_to_price` });

  return {
    ok: true,
    output: { figures, tables: [] },
    trace,
    assumptions,
    warnings,
    ruleVersionIds: tax?.ruleVersionIds ?? [],
  };
}

export const productPricing = defineCalculator<Input>({
  code: 'product_pricing',
  version: PRODUCT_PRICING_VERSION,
  blueprintId: 'F4.07',
  group: 'pricing',
  complexity: 'intermediate',
  input,
  ruleParams: [SALES_TAX_RATE],
  // No tax rate here (R16): without a reviewed rule the example stops at RULE_NOT_VERIFIED.
  example: {
    currency: 'JOD', unit_cost: '12400', freight: '850', import_costs: '1150', overhead_per_unit: '2000',
    target_margin_percent: '35', sales_tax_mode: 'excluded',
  },
  fields: [
    { key: 'unit_cost', kind: 'money', period: 'per_unit', labelKey: `${P}.field.unit_cost`, helpKey: `${P}.help.unit_cost` },
    { key: 'freight', kind: 'money', period: 'per_unit', optional: true, labelKey: `${P}.field.freight`, helpKey: `${P}.help.freight` },
    { key: 'import_costs', kind: 'money', period: 'per_unit', optional: true, labelKey: `${P}.field.import_costs`, helpKey: `${P}.help.import_costs` },
    { key: 'overhead_per_unit', kind: 'money', period: 'per_unit', optional: true, labelKey: `${P}.field.overhead_per_unit`, helpKey: `${P}.help.overhead_per_unit` },
    { key: 'target_margin_percent', kind: 'percent', min: '0', labelKey: `${P}.field.target_margin_percent`, helpKey: `${P}.help.target_margin_percent` },
    {
      key: 'sales_tax_mode', kind: 'select', labelKey: `${P}.field.sales_tax_mode`, helpKey: `${P}.help.sales_tax_mode`,
      options: [
        { value: 'excluded', labelKey: `${P}.option.tax_excluded` },
        { value: 'included', labelKey: `${P}.option.tax_included` },
        { value: 'none', labelKey: `${P}.option.tax_none` },
      ],
    },
    { key: 'sales_tax_rate_unverified', kind: 'percent', min: '0', max: '100', optional: true, labelKey: `${P}.field.sales_tax_rate_unverified`, helpKey: `${P}.help.sales_tax_rate_unverified` },
  ],
  compute,
});
