import { z } from 'zod';
import { defineCalculator } from '../core/define';
import type { Assumption, CalcOutcome, ResultValue, TraceStep, Warning } from '../core/types';
import { currencyField, daysValue, dec, Dec, decimalField, majorText, minorField, noneValue, ratioValue } from '../core/values';
import { checkedMoney, shownValue } from './shared';

// F4.04: working capital, current ratio and the cash conversion cycle (DSO + DIO − DPO).
export const WORKING_CAPITAL_VERSION = '1.0.0';

const input = z.object({
  currency: currencyField,
  // An overdrawn account is real, so cash may be negative.
  cash: minorField({ allowNegative: true }),
  receivables: minorField(),
  inventory: minorField().optional(),
  other_current_assets: minorField().optional(),
  payables: minorField(),
  other_current_liabilities: minorField().optional(),
  period_revenue: minorField().optional(),
  period_cogs: minorField().optional(),
  period_days: decimalField({ min: '0', max: '366', integer: true }).optional(),
});
type Input = z.infer<typeof input>;

const P = 'calc.working_capital';

const OPTIONAL_BALANCES = ['inventory', 'other_current_assets', 'other_current_liabilities'] as const;

function compute(i: Input): CalcOutcome {
  // Days ratios compare balances with a period's flow; without the period's length they mean nothing.
  const usesPeriod = i.period_revenue !== undefined || i.period_cogs !== undefined;
  if (usesPeriod && (!i.period_days || i.period_days.isZero())) {
    return { ok: false, errors: [{ code: 'PERIOD_MISMATCH', field: 'period_days', messageKey: `${P}.error.period_days` }] };
  }

  const inventory = i.inventory ?? 0n;
  const currentAssets = i.cash + i.receivables + inventory + (i.other_current_assets ?? 0n);
  const currentLiabilities = i.payables + (i.other_current_liabilities ?? 0n);
  const workingCapital = currentAssets - currentLiabilities;
  const m = (v: bigint) => majorText(v, i.currency);

  const trace: TraceStep[] = [
    {
      labelKey: `${P}.trace.current_assets`, formula: 'cash + receivables + inventory + other_current_assets',
      inputs: { cash: m(i.cash), receivables: m(i.receivables), inventory: m(inventory), other_current_assets: m(i.other_current_assets ?? 0n) },
      result: m(currentAssets),
    },
    {
      labelKey: `${P}.trace.current_liabilities`, formula: 'payables + other_current_liabilities',
      inputs: { payables: m(i.payables), other_current_liabilities: m(i.other_current_liabilities ?? 0n) },
      result: m(currentLiabilities),
    },
    {
      labelKey: `${P}.trace.working_capital`, formula: 'current_assets − current_liabilities',
      inputs: { current_assets: m(currentAssets), current_liabilities: m(currentLiabilities) },
      result: m(workingCapital),
    },
  ];

  let currentRatio: ResultValue = noneValue(`${P}.none.no_liabilities`);
  if (currentLiabilities > 0n) {
    currentRatio = ratioValue(dec(currentAssets).div(dec(currentLiabilities)));
    trace.push({
      labelKey: `${P}.trace.current_ratio`, formula: 'current_assets / current_liabilities',
      inputs: { current_assets: m(currentAssets), current_liabilities: m(currentLiabilities) },
      result: shownValue(currentRatio),
    });
  }

  // balance / flow × days, only when the flow is above zero.
  const daysOf = (key: 'dso' | 'dpo' | 'dio', formula: string, balanceName: string, balance: bigint, flowName: string, flow: bigint | undefined): Dec | null => {
    if (flow === undefined || flow <= 0n || !i.period_days) return null;
    const exact = dec(balance).div(dec(flow)).mul(i.period_days);
    trace.push({
      labelKey: `${P}.trace.${key}`, formula,
      inputs: { [balanceName]: m(balance), [flowName]: m(flow), period_days: i.period_days.toString() },
      result: shownValue(daysValue(exact)),
    });
    return exact;
  };
  const dso = daysOf('dso', 'receivables / period_revenue × period_days', 'receivables', i.receivables, 'period_revenue', i.period_revenue);
  const dpo = daysOf('dpo', 'payables / period_cogs × period_days', 'payables', i.payables, 'period_cogs', i.period_cogs);
  const dio = daysOf('dio', 'inventory / period_cogs × period_days', 'inventory', inventory, 'period_cogs', i.period_cogs);

  let cycle: ResultValue = noneValue(`${P}.none.needs_all_days`);
  if (dso && dpo && dio) {
    // From the exact day counts, so the cycle is rounded once.
    const exact = dso.plus(dio).minus(dpo);
    cycle = daysValue(exact);
    trace.push({
      labelKey: `${P}.trace.cash_conversion_cycle`, formula: 'dso + dio − dpo',
      inputs: { dso: dso.toString(), dio: dio.toString(), dpo: dpo.toString() },
      result: shownValue(cycle),
    });
  }

  const assumptions: Assumption[] = [
    { key: 'balances_on_one_date', messageKey: `${P}.assumption.balances_on_one_date`, source: 'default' },
    ...OPTIONAL_BALANCES.filter(k => i[k] === undefined)
      .map((k): Assumption => ({ key: `${k}_zero`, messageKey: `${P}.assumption.${k}_zero`, source: 'default' })),
  ];
  if (dpo || dio) assumptions.push({ key: 'cogs_basis', messageKey: `${P}.assumption.cogs_basis`, source: 'default' });

  const warnings: Warning[] = [];
  if (workingCapital < 0n) warnings.push({ key: 'negative_working_capital', messageKey: `${P}.warning.negative_working_capital` });
  if (i.cash < 0n) warnings.push({ key: 'negative_cash', messageKey: `${P}.warning.negative_cash` });

  return {
    ok: true,
    output: {
      figures: [
        { key: 'working_capital', labelKey: `${P}.figure.working_capital`, value: checkedMoney(workingCapital, i.currency), primary: true },
        { key: 'current_ratio', labelKey: `${P}.figure.current_ratio`, value: currentRatio, primary: true },
        { key: 'current_assets', labelKey: `${P}.figure.current_assets`, value: checkedMoney(currentAssets, i.currency) },
        { key: 'current_liabilities', labelKey: `${P}.figure.current_liabilities`, value: checkedMoney(currentLiabilities, i.currency) },
        { key: 'dso', labelKey: `${P}.figure.dso`, value: dso ? daysValue(dso) : noneValue(`${P}.none.needs_revenue`) },
        { key: 'dio', labelKey: `${P}.figure.dio`, value: dio ? daysValue(dio) : noneValue(`${P}.none.needs_cogs`) },
        { key: 'dpo', labelKey: `${P}.figure.dpo`, value: dpo ? daysValue(dpo) : noneValue(`${P}.none.needs_cogs`) },
        { key: 'cash_conversion_cycle', labelKey: `${P}.figure.cash_conversion_cycle`, value: cycle },
      ],
      tables: [],
    },
    trace,
    assumptions,
    warnings,
    ruleVersionIds: [],
  };
}

export const workingCapital = defineCalculator<Input>({
  code: 'working_capital',
  version: WORKING_CAPITAL_VERSION,
  blueprintId: 'F4.04',
  group: 'cash_planning',
  complexity: 'intermediate',
  input,
  example: {
    currency: 'JOD', cash: '8200000', receivables: '14500000', inventory: '9800000', other_current_assets: '0',
    payables: '11300000', other_current_liabilities: '2500000',
    period_revenue: '45000000', period_cogs: '30000000', period_days: '90',
  },
  fields: [
    { key: 'cash', kind: 'money', allowNegative: true, prefill: 'cash_total', labelKey: `${P}.field.cash`, helpKey: `${P}.help.cash` },
    { key: 'receivables', kind: 'money', prefill: 'receivables_outstanding', labelKey: `${P}.field.receivables`, helpKey: `${P}.help.receivables` },
    { key: 'inventory', kind: 'money', optional: true, labelKey: `${P}.field.inventory`, helpKey: `${P}.help.inventory` },
    { key: 'other_current_assets', kind: 'money', optional: true, labelKey: `${P}.field.other_current_assets`, helpKey: `${P}.help.other_current_assets` },
    { key: 'payables', kind: 'money', prefill: 'payables_outstanding', labelKey: `${P}.field.payables`, helpKey: `${P}.help.payables` },
    { key: 'other_current_liabilities', kind: 'money', optional: true, labelKey: `${P}.field.other_current_liabilities`, helpKey: `${P}.help.other_current_liabilities` },
    { key: 'period_revenue', kind: 'money', period: 'per_period', optional: true, labelKey: `${P}.field.period_revenue`, helpKey: `${P}.help.period_revenue` },
    { key: 'period_cogs', kind: 'money', period: 'per_period', optional: true, labelKey: `${P}.field.period_cogs`, helpKey: `${P}.help.period_cogs` },
    { key: 'period_days', kind: 'number', unit: 'days', integer: true, min: '0', max: '366', optional: true, labelKey: `${P}.field.period_days`, helpKey: `${P}.help.period_days` },
  ],
  compute,
});
