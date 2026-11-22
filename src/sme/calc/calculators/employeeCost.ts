import { z } from 'zod';
import { defineCalculator } from '../core/define';
import type { ApprovedParam, Assumption, CalcContext, CalcOutcome, ResultTable, TraceStep, Warning } from '../core/types';
import { currencyField, dec, Dec, decimalField, isoDateField, majorText, minorField, roundingNote, roundMinor } from '../core/values';
import { checkedMoney } from './shared';

// F4.09: full employer cost = wage + allowances + employer social security + other costs.
// The employer rate and any wage cap come only from rule versions in force on the start date,
// or from a rate the user enters, which stays labelled unverified (R16).
export const EMPLOYEE_COST_VERSION = '1.0.0';

export const SSC_EMPLOYER_RATE = { key: 'jo.ssc.employer_rate' };
export const SSC_WAGE_CAP = { key: 'jo.ssc.wage_cap_monthly' };

const MONTHS_PER_YEAR = 12n;

const input = z.object({
  currency: currencyField,
  gross_monthly_wage: minorField(),
  allowances: minorField().optional(),
  other_employer_costs: minorField().optional(),
  start_date: isoDateField,
  // Which pay counts toward social security is the user's call, not something this tool asserts.
  ssc_base: z.enum(['wage_and_allowances', 'wage_only']).optional(),
  employer_ssc_rate_unverified: decimalField({ min: '0', max: '100' }).optional(),
});
type Input = z.infer<typeof input>;

const P = 'calc.employee_cost';

function compute(i: Input, ctx: CalcContext): CalcOutcome {
  const allowances = i.allowances ?? 0n;
  const other = i.other_employer_costs ?? 0n;
  if (allowances > 0n && !i.ssc_base) {
    return { ok: false, errors: [{ code: 'VALIDATION_FAILED', field: 'ssc_base', messageKey: `${P}.error.ssc_base_required` }] };
  }

  const rateParam = usable(ctx.getRuleParam(SSC_EMPLOYER_RATE, i.start_date), 'percent');
  const ratePercent = rateParam ? new Dec(rateParam.value) : i.employer_ssc_rate_unverified;
  if (!ratePercent) {
    return { ok: false, errors: [{ code: 'RULE_NOT_VERIFIED', field: 'employer_ssc_rate_unverified', messageKey: `${P}.error.rule_not_verified` }] };
  }
  const capParam = usable(ctx.getRuleParam(SSC_WAGE_CAP, i.start_date), 'money_minor');
  // A jo.* cap is a Jordanian dinar amount; it cannot be applied to a wage in another currency.
  if (capParam && i.currency !== 'JOD') {
    return { ok: false, errors: [{ code: 'CURRENCY_MISMATCH', field: 'currency', messageKey: `${P}.error.cap_currency` }] };
  }

  const m = (v: bigint) => majorText(v, i.currency);
  const cap = capParam ? BigInt(capParam.value) : null;
  const includesAllowances = i.ssc_base === 'wage_and_allowances';
  const uncappedBase = i.gross_monthly_wage + (includesAllowances ? allowances : 0n);
  const base = cap !== null && uncappedBase > cap ? cap : uncappedBase;
  const sscExact = dec(base).mul(ratePercent).div(100);
  const ssc = roundMinor(sscExact);
  const monthly = i.gross_monthly_wage + allowances + ssc + other;
  const annual = monthly * MONTHS_PER_YEAR;

  const trace: TraceStep[] = [
    {
      labelKey: `${P}.trace.ssc_base`, formula: cap === null ? 'gross_monthly_wage + allowances_if_included' : 'min(gross_monthly_wage + allowances_if_included, wage_cap)',
      inputs: {
        gross_monthly_wage: m(i.gross_monthly_wage), allowances_if_included: m(includesAllowances ? allowances : 0n),
        ...(cap === null ? {} : { wage_cap: m(cap) }),
      },
      result: m(base),
    },
    {
      labelKey: `${P}.trace.employer_ssc`, formula: 'ssc_base × employer_rate_percent / 100',
      inputs: { ssc_base: m(base), employer_rate_percent: ratePercent.toString() },
      result: m(ssc), rounding: roundingNote(sscExact, ssc),
    },
    {
      labelKey: `${P}.trace.monthly_cost`, formula: 'gross_monthly_wage + allowances + employer_ssc + other_employer_costs',
      inputs: { gross_monthly_wage: m(i.gross_monthly_wage), allowances: m(allowances), employer_ssc: m(ssc), other_employer_costs: m(other) },
      result: m(monthly),
    },
    {
      labelKey: `${P}.trace.annual_cost`, formula: 'monthly_cost × 12',
      inputs: { monthly_cost: m(monthly) },
      result: m(annual),
    },
  ];

  const row = (key: string, amount: bigint) => ({
    key, labelKey: `${P}.row.${key}`,
    cells: { monthly: checkedMoney(amount, i.currency), annual: checkedMoney(amount * MONTHS_PER_YEAR, i.currency) },
  });
  const breakdown: ResultTable = {
    key: 'breakdown', titleKey: `${P}.table.breakdown`, kind: 'breakdown',
    columns: [{ key: 'monthly', labelKey: `${P}.col.monthly` }, { key: 'annual', labelKey: `${P}.col.annual` }],
    rows: [
      row('wage', i.gross_monthly_wage), row('allowances', allowances), row('employer_ssc', ssc),
      row('other_costs', other), row('total', monthly),
    ],
  };

  const assumptions: Assumption[] = [
    rateParam
      ? { key: 'ssc_rate', messageKey: `${P}.assumption.ssc_rate_rule`, values: { rate: rateParam.value, date: i.start_date }, source: 'rule' }
      : { key: 'ssc_rate', messageKey: `${P}.assumption.ssc_rate_unverified`, values: { rate: ratePercent.toString() }, source: 'unverified_user_rate' },
    capParam
      ? { key: 'wage_cap', messageKey: `${P}.assumption.wage_cap_rule`, values: { cap: m(BigInt(capParam.value)), date: i.start_date }, source: 'rule' }
      : { key: 'wage_cap', messageKey: `${P}.assumption.no_wage_cap`, source: 'default' },
    includesAllowances
      ? { key: 'ssc_base', messageKey: `${P}.assumption.base_with_allowances`, source: 'user' }
      : { key: 'ssc_base', messageKey: `${P}.assumption.base_wage_only`, source: i.ssc_base ? 'user' : 'default' },
    { key: 'twelve_months', messageKey: `${P}.assumption.twelve_months`, source: 'default' },
  ];

  const warnings: Warning[] = [];
  if (rateParam && i.employer_ssc_rate_unverified !== undefined) {
    warnings.push({ key: 'unverified_rate_ignored', messageKey: `${P}.warning.unverified_rate_ignored` });
  }
  if (base < uncappedBase) warnings.push({ key: 'cap_applied', messageKey: `${P}.warning.cap_applied` });

  return {
    ok: true,
    output: {
      figures: [
        { key: 'monthly_cost', labelKey: `${P}.figure.monthly_cost`, value: checkedMoney(monthly, i.currency), primary: true },
        { key: 'annual_cost', labelKey: `${P}.figure.annual_cost`, value: checkedMoney(annual, i.currency), primary: true },
        { key: 'employer_ssc', labelKey: `${P}.figure.employer_ssc`, value: checkedMoney(ssc, i.currency) },
        { key: 'ssc_base', labelKey: `${P}.figure.ssc_base`, value: checkedMoney(base, i.currency) },
      ],
      tables: [breakdown],
    },
    trace,
    assumptions,
    warnings,
    ruleVersionIds: [rateParam, capParam].flatMap(p => (p ? [p.ruleVersionId] : [])),
  };
}

/** A rule parameter this calculator cannot read is treated as not published, never guessed at. */
function usable(param: ApprovedParam | null, unit: ApprovedParam['unit']): ApprovedParam | null {
  if (!param || param.unit !== unit) return null;
  if (unit === 'money_minor' && !/^\d+$/.test(param.value)) return null;
  return param;
}

export const employeeCost = defineCalculator<Input>({
  code: 'employee_cost',
  version: EMPLOYEE_COST_VERSION,
  blueprintId: 'F4.09',
  group: 'people_costs',
  complexity: 'intermediate',
  input,
  ruleParams: [SSC_EMPLOYER_RATE, SSC_WAGE_CAP],
  // No rate here (R16): without a reviewed rule the example stops at RULE_NOT_VERIFIED.
  example: {
    currency: 'JOD', gross_monthly_wage: '650000', allowances: '100000', other_employer_costs: '45000',
    start_date: '2026-12-01', ssc_base: 'wage_and_allowances',
  },
  fields: [
    { key: 'gross_monthly_wage', kind: 'money', period: 'per_month', labelKey: `${P}.field.gross_monthly_wage`, helpKey: `${P}.help.gross_monthly_wage` },
    { key: 'allowances', kind: 'money', period: 'per_month', optional: true, labelKey: `${P}.field.allowances`, helpKey: `${P}.help.allowances` },
    { key: 'other_employer_costs', kind: 'money', period: 'per_month', optional: true, labelKey: `${P}.field.other_employer_costs`, helpKey: `${P}.help.other_employer_costs` },
    { key: 'start_date', kind: 'date', labelKey: `${P}.field.start_date`, helpKey: `${P}.help.start_date` },
    {
      key: 'ssc_base', kind: 'select', optional: true, labelKey: `${P}.field.ssc_base`, helpKey: `${P}.help.ssc_base`,
      options: [
        { value: 'wage_and_allowances', labelKey: `${P}.option.wage_and_allowances` },
        { value: 'wage_only', labelKey: `${P}.option.wage_only` },
      ],
    },
    { key: 'employer_ssc_rate_unverified', kind: 'percent', min: '0', max: '100', optional: true, labelKey: `${P}.field.employer_ssc_rate_unverified`, helpKey: `${P}.help.employer_ssc_rate_unverified` },
  ],
  compute,
});
