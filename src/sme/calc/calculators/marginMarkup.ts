import { z } from 'zod';
import { defineCalculator } from '../core/define';
import type { CalcOutcome, ResultTable, ResultValue, TraceStep, Warning } from '../core/types';
import { currencyField, dec, majorText, minorField, noneValue, percentValue } from '../core/values';
import { checkedMoney, shownValue } from './shared';

// F4.03: the same gross profit two ways: margin is a share of revenue, markup a share of cost.
export const MARGIN_MARKUP_VERSION = '1.0.0';

const input = z.object({
  currency: currencyField,
  net_revenue: minorField(),
  cogs: minorField(),
});
type Input = z.infer<typeof input>;

const P = 'calc.margin_markup';

function compute(i: Input): CalcOutcome {
  if (i.net_revenue === 0n) {
    return { ok: false, errors: [{ code: 'ZERO_DENOMINATOR', field: 'net_revenue', messageKey: `${P}.error.zero_revenue` }] };
  }

  const grossProfit = i.net_revenue - i.cogs;
  const marginRatio = dec(grossProfit).div(dec(i.net_revenue));
  const margin = percentValue(marginRatio);
  const markup: ResultValue = i.cogs === 0n ? noneValue(`${P}.none.no_cost`) : percentValue(dec(grossProfit).div(dec(i.cogs)));

  const trace: TraceStep[] = [
    {
      labelKey: `${P}.trace.gross_profit`, formula: 'net_revenue − cogs',
      inputs: { net_revenue: majorText(i.net_revenue, i.currency), cogs: majorText(i.cogs, i.currency) },
      result: majorText(grossProfit, i.currency),
    },
    {
      labelKey: `${P}.trace.gross_margin`, formula: 'gross_profit / net_revenue × 100',
      inputs: { gross_profit: majorText(grossProfit, i.currency), net_revenue: majorText(i.net_revenue, i.currency) },
      result: shownValue(margin),
    },
  ];
  if (markup.kind === 'percent') {
    trace.push({
      labelKey: `${P}.trace.markup`, formula: 'gross_profit / cogs × 100',
      inputs: { gross_profit: majorText(grossProfit, i.currency), cogs: majorText(i.cogs, i.currency) },
      result: markup.value,
    });
  }

  const sideBySide: ResultTable = {
    key: 'side_by_side', titleKey: `${P}.table.side_by_side`, kind: 'breakdown',
    columns: [
      { key: 'based_on', labelKey: `${P}.col.based_on` },
      { key: 'gross_profit', labelKey: `${P}.col.gross_profit` },
      { key: 'percent', labelKey: `${P}.col.percent` },
    ],
    rows: [
      {
        key: 'margin', labelKey: `${P}.row.margin`,
        cells: { based_on: checkedMoney(i.net_revenue, i.currency), gross_profit: checkedMoney(grossProfit, i.currency), percent: margin },
      },
      {
        key: 'markup', labelKey: `${P}.row.markup`,
        cells: { based_on: checkedMoney(i.cogs, i.currency), gross_profit: checkedMoney(grossProfit, i.currency), percent: markup },
      },
    ],
  };

  const warnings: Warning[] = [];
  if (i.cogs === 0n) warnings.push({ key: 'no_cost', messageKey: `${P}.warning.no_cost` });
  if (grossProfit < 0n) warnings.push({ key: 'loss', messageKey: `${P}.warning.loss` });

  return {
    ok: true,
    output: {
      figures: [
        { key: 'gross_profit', labelKey: `${P}.figure.gross_profit`, value: checkedMoney(grossProfit, i.currency) },
        { key: 'gross_margin', labelKey: `${P}.figure.gross_margin`, value: margin, primary: true },
        { key: 'markup', labelKey: `${P}.figure.markup`, value: markup, primary: true },
      ],
      tables: [sideBySide],
    },
    trace,
    assumptions: [{ key: 'net_of_discounts', messageKey: `${P}.assumption.net_of_discounts`, source: 'default' }],
    warnings,
    ruleVersionIds: [],
  };
}

export const marginMarkup = defineCalculator<Input>({
  code: 'margin_markup',
  version: MARGIN_MARKUP_VERSION,
  blueprintId: 'F4.03',
  group: 'pricing',
  complexity: 'basic',
  input,
  example: { currency: 'JOD', net_revenue: '18500000', cogs: '11100000' },
  fields: [
    { key: 'net_revenue', kind: 'money', period: 'per_period', labelKey: `${P}.field.net_revenue`, helpKey: `${P}.help.net_revenue` },
    { key: 'cogs', kind: 'money', period: 'per_period', labelKey: `${P}.field.cogs`, helpKey: `${P}.help.cogs` },
  ],
  compute,
});
