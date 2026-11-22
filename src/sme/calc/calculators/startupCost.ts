import { z } from 'zod';
import { defineCalculator } from '../core/define';
import type { CalcError, CalcOutcome, ResultTable, ResultValue, TraceStep, Warning } from '../core/types';
import { currencyField, dec, decimalField, majorText, minorField, noneValue, roundingNote, roundMinor } from '../core/values';
import { checkedMoney, sumMinor } from './shared';

// F4.05: funding needed = (one-off costs + monthly costs × months) × (1 + contingency), as a
// low / base / high range. Every amount, official fees included, is entered by the user (R16).
export const STARTUP_COST_VERSION = '1.0.0';

export const STARTUP_CATEGORIES = [
  'registration_licensing', 'equipment', 'fit_out', 'initial_stock', 'deposits', 'marketing', 'other',
] as const;
type Category = (typeof STARTUP_CATEGORIES)[number];

const SCENARIOS = ['low', 'base', 'high'] as const;
type Scenario = (typeof SCENARIOS)[number];

const MAX_ITEMS = 50;

const item = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(STARTUP_CATEGORIES),
  low: minorField(),
  base: minorField(),
  high: minorField(),
});

const input = z.object({
  currency: currencyField,
  items: z.array(item).max(MAX_ITEMS),
  monthly_operating_costs: minorField(),
  months_to_cover: decimalField({ min: '0', max: '120', integer: true }),
  contingency_percent: decimalField({ min: '0', max: '100' }),
});
type Input = z.infer<typeof input>;

const P = 'calc.startup_cost';

function compute(i: Input): CalcOutcome {
  const errors: CalcError[] = [];
  i.items.forEach((it, n) => {
    if (it.low > it.base) errors.push({ code: 'VALIDATION_FAILED', field: `items.${n}.low`, messageKey: `${P}.error.low_above_base` });
    else if (it.base > it.high) errors.push({ code: 'VALIDATION_FAILED', field: `items.${n}.high`, messageKey: `${P}.error.high_below_base` });
  });
  if (errors.length > 0) return { ok: false, errors };

  const months = BigInt(i.months_to_cover.toFixed(0));
  const operating = i.monthly_operating_costs * months;
  const m = (v: bigint) => majorText(v, i.currency);

  const trace: TraceStep[] = [{
    labelKey: `${P}.trace.operating`, formula: 'monthly_operating_costs × months_to_cover',
    inputs: { monthly_operating_costs: m(i.monthly_operating_costs), months_to_cover: months.toString() },
    result: m(operating),
  }];

  const totals = {} as Record<Scenario, { oneOff: bigint; contingency: bigint; total: bigint }>;
  for (const s of SCENARIOS) {
    const oneOff = sumMinor(i.items.map(it => it[s]));
    const subtotal = oneOff + operating;
    const contingencyExact = dec(subtotal).mul(i.contingency_percent).div(100);
    const contingency = roundMinor(contingencyExact);
    totals[s] = { oneOff, contingency, total: subtotal + contingency };
    trace.push(
      {
        labelKey: `${P}.trace.one_off_${s}`, formula: `Σ item.${s}`,
        inputs: { items: i.items.length.toString() },
        result: m(oneOff),
      },
      {
        labelKey: `${P}.trace.contingency_${s}`, formula: '(one_off + operating) × contingency_percent / 100',
        inputs: { one_off: m(oneOff), operating: m(operating), contingency_percent: i.contingency_percent.toString() },
        result: m(contingency), rounding: roundingNote(contingencyExact, contingency),
      },
      {
        labelKey: `${P}.trace.total_${s}`, formula: 'one_off + operating + contingency',
        inputs: { one_off: m(oneOff), operating: m(operating), contingency: m(contingency) },
        result: m(totals[s].total),
      },
    );
  }

  const byScenario = (pick: (s: Scenario) => bigint): Record<string, ResultValue> =>
    Object.fromEntries(SCENARIOS.map(s => [s, checkedMoney(pick(s), i.currency)]));

  // Every category is listed, entered or not, so the table doubles as a checklist.
  const breakdown: ResultTable = {
    key: 'breakdown', titleKey: `${P}.table.breakdown`, kind: 'breakdown',
    columns: SCENARIOS.map(s => ({ key: s, labelKey: `${P}.col.${s}` })),
    rows: [
      ...STARTUP_CATEGORIES.map(c => {
        const inCategory = i.items.filter(it => it.category === c);
        return {
          key: c, labelKey: `${P}.category.${c}`,
          cells: inCategory.length === 0
            ? Object.fromEntries(SCENARIOS.map(s => [s, noneValue(`${P}.none.not_entered`)]))
            : byScenario(s => sumMinor(inCategory.map(it => it[s]))),
        };
      }),
      { key: 'operating', labelKey: `${P}.row.operating`, labelValues: { months: months.toString() }, cells: byScenario(() => operating) },
      { key: 'contingency', labelKey: `${P}.row.contingency`, labelValues: { percent: i.contingency_percent.toString() }, cells: byScenario(s => totals[s].contingency) },
      { key: 'total', labelKey: `${P}.row.total`, cells: byScenario(s => totals[s].total) },
    ],
  };

  const missing = (c: Category) => !i.items.some(it => it.category === c);
  const warnings: Warning[] = [];
  if (missing('registration_licensing')) warnings.push({ key: 'no_official_fees', messageKey: `${P}.warning.no_official_fees` });
  if (totals.base.total === 0n) warnings.push({ key: 'nothing_entered', messageKey: `${P}.warning.nothing_entered` });

  return {
    ok: true,
    output: {
      figures: [
        { key: 'funding_low', labelKey: `${P}.figure.funding_low`, value: checkedMoney(totals.low.total, i.currency), primary: true },
        { key: 'funding_base', labelKey: `${P}.figure.funding_base`, value: checkedMoney(totals.base.total, i.currency), primary: true },
        { key: 'funding_high', labelKey: `${P}.figure.funding_high`, value: checkedMoney(totals.high.total, i.currency), primary: true },
        { key: 'one_off_base', labelKey: `${P}.figure.one_off_base`, value: checkedMoney(totals.base.oneOff, i.currency) },
        { key: 'operating', labelKey: `${P}.figure.operating`, value: checkedMoney(operating, i.currency) },
      ],
      tables: [breakdown],
    },
    trace,
    assumptions: [
      { key: 'user_entered_amounts', messageKey: `${P}.assumption.user_entered_amounts`, source: 'user' },
      { key: 'contingency', messageKey: `${P}.assumption.contingency`, values: { percent: i.contingency_percent.toString() }, source: 'user' },
      { key: 'months', messageKey: `${P}.assumption.months`, values: { months: months.toString() }, source: 'user' },
    ],
    warnings,
    ruleVersionIds: [],
  };
}

const categoryOptions = STARTUP_CATEGORIES.map(c => ({ value: c, labelKey: `${P}.category.${c}` }));

export const startupCost = defineCalculator<Input>({
  code: 'startup_cost',
  version: STARTUP_COST_VERSION,
  blueprintId: 'F4.05',
  group: 'cash_planning',
  complexity: 'intermediate',
  input,
  // Official fees are left out on purpose: they are never supplied by Rasmalak (R16).
  example: {
    currency: 'JOD',
    items: [
      { name: 'آلة القهوة والمطحنة', category: 'equipment', low: '3500000', base: '4200000', high: '5000000' },
      { name: 'ديكور المحل وتجهيزه', category: 'fit_out', low: '6000000', base: '8000000', high: '11000000' },
      { name: 'بضاعة الافتتاح', category: 'initial_stock', low: '1200000', base: '1500000', high: '2000000' },
      { name: 'تأمين إيجار المحل', category: 'deposits', low: '1500000', base: '1500000', high: '1500000' },
      { name: 'حملة الافتتاح', category: 'marketing', low: '400000', base: '700000', high: '1000000' },
    ],
    monthly_operating_costs: '2800000', months_to_cover: '3', contingency_percent: '10',
  },
  fields: [
    {
      key: 'items', kind: 'items', maxItems: MAX_ITEMS, labelKey: `${P}.field.items`, helpKey: `${P}.help.items`, addLabelKey: `${P}.add_item`,
      itemFields: [
        { key: 'name', kind: 'text', maxLength: 80, labelKey: `${P}.field.item_name` },
        { key: 'category', kind: 'select', options: categoryOptions, labelKey: `${P}.field.item_category` },
        { key: 'low', kind: 'money', period: 'one_off', labelKey: `${P}.field.item_low`, helpKey: `${P}.help.item_low` },
        { key: 'base', kind: 'money', period: 'one_off', labelKey: `${P}.field.item_base`, helpKey: `${P}.help.item_base` },
        { key: 'high', kind: 'money', period: 'one_off', labelKey: `${P}.field.item_high`, helpKey: `${P}.help.item_high` },
      ],
    },
    { key: 'monthly_operating_costs', kind: 'money', period: 'per_month', labelKey: `${P}.field.monthly_operating_costs`, helpKey: `${P}.help.monthly_operating_costs` },
    { key: 'months_to_cover', kind: 'number', unit: 'months', integer: true, min: '0', max: '120', labelKey: `${P}.field.months_to_cover`, helpKey: `${P}.help.months_to_cover` },
    { key: 'contingency_percent', kind: 'percent', min: '0', max: '100', labelKey: `${P}.field.contingency_percent`, helpKey: `${P}.help.contingency_percent` },
  ],
  compute,
});
