import { z } from 'zod';
import { defineCalculator } from '../core/define';
import type { Assumption, CalcError, CalcOutcome, ResultFigure, ResultTable, ResultValue, TraceStep, Warning } from '../core/types';
import { countValue, currencyField, dec, Dec, decimalField, majorText, minorField, noneValue, percentValue, roundingNote, roundMinor } from '../core/values';
import { checkedMoney, shownValue, sumMinor } from './shared';

// F4.06: instalment, cost of credit and the effective annual rate with fees included.
// The reducing-balance core is ported from the consumer simpleLoanCalculator (main @720f174,
// docs/PORTED_FROM_CONSUMER.md): M = P × r(1+r)^n / ((1+r)^n − 1), or P / n at a zero rate.
export const LOAN_AFFORDABILITY_VERSION = '1.0.0';

const PERIODS_PER_YEAR = { monthly: 12, quarterly: 4 } as const;
const STRESS_POINTS = ['0', '2', '4'];

const IRR_MAX_ITERATIONS = 100;
const IRR_TOLERANCE = new Dec('1e-24');

const input = z.object({
  currency: currencyField,
  principal: minorField(),
  term_months: decimalField({ min: '1', max: '600', integer: true }),
  annual_rate_percent: decimalField({ min: '0', max: '100' }),
  rate_basis: z.enum(['reducing_balance', 'flat']),
  fee_type: z.enum(['fixed', 'percent']).default('fixed'),
  fee_amount: minorField().optional(),
  fee_percent: decimalField({ min: '0', max: '100' }).optional(),
  payment_frequency: z.enum(['monthly', 'quarterly']),
});
type Input = z.infer<typeof input>;

const P = 'calc.loan_affordability';

// ── Effective rate ──────────────────────────────────────────

export interface PeriodicRateSolution {
  periodicRate: Dec;
  iterations: number;
  converged: boolean;
}

/**
 * The per-period rate i at which the payments, discounted, equal the amount actually received:
 * Σ payment_k / (1 + i)^k = received. Newton–Raphson from i = 0: the left side falls and is convex
 * in i, so when the payments add up to at least the amount received every step stays at or below
 * the root and the iteration climbs to it without overshooting.
 */
export function solvePeriodicRate(received: bigint, payments: readonly bigint[]): PeriodicRateSolution {
  let rate = new Dec(0);
  for (let iteration = 1; iteration <= IRR_MAX_ITERATIONS; iteration++) {
    const v = new Dec(1).div(rate.plus(1));
    let f = dec(-received);
    let slope = new Dec(0);
    let discount = new Dec(1);
    payments.forEach((payment, index) => {
      discount = discount.mul(v);
      f = f.plus(dec(payment).mul(discount));
      slope = slope.minus(dec(payment).mul(index + 1).mul(discount).mul(v));
    });
    if (slope.isZero()) return { periodicRate: rate, iterations: iteration, converged: f.isZero() };
    const step = f.div(slope);
    rate = rate.minus(step);
    if (step.abs().lte(IRR_TOLERANCE)) return { periodicRate: rate, iterations: iteration, converged: true };
  }
  return { periodicRate: rate, iterations: IRR_MAX_ITERATIONS, converged: false };
}

// ── Schedule ────────────────────────────────────────────────

interface Row { opening: bigint; payment: bigint; principal: bigint; interest: bigint; closing: bigint }

function schedule(principal: bigint, n: number, instalment: bigint, interestFor: (k: number, opening: bigint) => bigint): Row[] {
  const rows: Row[] = [];
  let balance = principal;
  for (let k = 1; k <= n; k++) {
    const interest = interestFor(k, balance);
    // The last payment clears what rounding left; no row repays more than is owed or less than nothing.
    let part = k === n ? balance : instalment - interest;
    if (part < 0n) part = 0n;
    if (part > balance) part = balance;
    rows.push({ opening: balance, payment: part + interest, principal: part, interest, closing: balance - part });
    balance -= part;
  }
  return rows;
}

interface Loan {
  instalment: bigint;
  rows: Row[];
  totalInterest: bigint;
  totalRepayment: bigint;
  steps: TraceStep[];
}

function loanAt(i: Input, annualRatePercent: Dec, n: number, periodsPerYear: number): Loan {
  const m = (v: bigint) => majorText(v, i.currency);
  const steps: TraceStep[] = [];
  let instalment: bigint;
  let rows: Row[];
  if (i.rate_basis === 'reducing_balance') {
    const r = annualRatePercent.div(100).div(periodsPerYear);
    const growth = r.plus(1).pow(n);
    const instalmentExact = r.isZero() ? dec(i.principal).div(n) : dec(i.principal).mul(r).mul(growth).div(growth.minus(1));
    instalment = roundMinor(instalmentExact);
    rows = schedule(i.principal, n, instalment, (_k, opening) => roundMinor(dec(opening).mul(r)));
    steps.push(
      {
        labelKey: `${P}.trace.periodic_rate`, formula: 'annual_rate_percent / 100 / periods_per_year',
        inputs: { annual_rate_percent: annualRatePercent.toString(), periods_per_year: periodsPerYear.toString() },
        result: r.toString(),
      },
      {
        labelKey: `${P}.trace.instalment`, formula: r.isZero() ? 'principal / n' : 'principal × r(1 + r)^n / ((1 + r)^n − 1)',
        inputs: { principal: m(i.principal), r: r.toString(), n: n.toString() },
        result: m(instalment), rounding: roundingNote(instalmentExact, instalment),
      },
    );
  } else {
    const interestExact = dec(i.principal).mul(annualRatePercent).div(100).mul(i.term_months).div(12);
    const flatInterest = roundMinor(interestExact);
    const instalmentExact = dec(i.principal + flatInterest).div(n);
    instalment = roundMinor(instalmentExact);
    // Flat-rate lenders spread the interest evenly; rounding the running total keeps the parts exact.
    const share = (k: number) => roundMinor(dec(flatInterest).mul(k).div(n));
    rows = schedule(i.principal, n, instalment, k => share(k) - share(k - 1));
    steps.push(
      {
        labelKey: `${P}.trace.flat_interest`, formula: 'principal × annual_rate_percent / 100 × term_months / 12',
        inputs: { principal: m(i.principal), annual_rate_percent: annualRatePercent.toString(), term_months: i.term_months.toString() },
        result: m(flatInterest), rounding: roundingNote(interestExact, flatInterest),
      },
      {
        labelKey: `${P}.trace.instalment`, formula: '(principal + flat_interest) / n',
        inputs: { principal: m(i.principal), flat_interest: m(flatInterest), n: n.toString() },
        result: m(instalment), rounding: roundingNote(instalmentExact, instalment),
      },
    );
  }
  const totalInterest = sumMinor(rows.map(row => row.interest));
  return { instalment, rows, totalInterest, totalRepayment: i.principal + totalInterest, steps };
}

function effectiveAnnualRate(received: bigint, rows: Row[], periodsPerYear: number): { value: ResultValue; solution: PeriodicRateSolution } {
  const solution = solvePeriodicRate(received, rows.map(row => row.payment));
  const value = solution.converged
    ? percentValue(solution.periodicRate.plus(1).pow(periodsPerYear).minus(1))
    : noneValue(`${P}.none.rate_not_found`);
  return { value, solution };
}

// ── Calculator ──────────────────────────────────────────────

function compute(i: Input): CalcOutcome {
  const errors: CalcError[] = [];
  if (i.principal === 0n) errors.push({ code: 'VALIDATION_FAILED', field: 'principal', messageKey: `${P}.error.no_principal` });
  if (i.fee_type === 'percent' && i.fee_percent === undefined) {
    errors.push({ code: 'VALIDATION_FAILED', field: 'fee_percent', messageKey: 'tools.error.required' });
  }
  const monthsPerPeriod = i.payment_frequency === 'quarterly' ? 3 : 1;
  if (!i.term_months.mod(monthsPerPeriod).isZero()) {
    errors.push({ code: 'PERIOD_MISMATCH', field: 'term_months', messageKey: `${P}.error.term_not_quarters` });
  }
  if (errors.length > 0) return { ok: false, errors };

  const m = (v: bigint) => majorText(v, i.currency);
  const periodsPerYear = PERIODS_PER_YEAR[i.payment_frequency];
  const n = i.term_months.div(monthsPerPeriod).toNumber();

  const trace: TraceStep[] = [];
  let fee = i.fee_amount ?? 0n;
  if (i.fee_type === 'percent' && i.fee_percent !== undefined) {
    const feeExact = dec(i.principal).mul(i.fee_percent).div(100);
    fee = roundMinor(feeExact);
    trace.push({
      labelKey: `${P}.trace.fee`, formula: 'principal × fee_percent / 100',
      inputs: { principal: m(i.principal), fee_percent: i.fee_percent.toString() },
      result: m(fee), rounding: roundingNote(feeExact, fee),
    });
  }
  if (fee >= i.principal) {
    return { ok: false, errors: [{ code: 'VALIDATION_FAILED', field: i.fee_type === 'percent' ? 'fee_percent' : 'fee_amount', messageKey: `${P}.error.fee_too_high` }] };
  }
  const received = i.principal - fee;

  const base = loanAt(i, i.annual_rate_percent, n, periodsPerYear);
  const ear = effectiveAnnualRate(received, base.rows, periodsPerYear);
  const costOfCredit = base.totalInterest + fee;
  const finalPayment = base.rows[base.rows.length - 1].payment;

  trace.push(
    ...base.steps,
    {
      labelKey: `${P}.trace.total_repayment`, formula: 'Σ payment_k',
      inputs: { payments: n.toString(), total_interest: m(base.totalInterest) },
      result: m(base.totalRepayment),
    },
    {
      labelKey: `${P}.trace.cost_of_credit`, formula: 'total_interest + fees',
      inputs: { total_interest: m(base.totalInterest), fees: m(fee) },
      result: m(costOfCredit),
    },
    {
      labelKey: `${P}.trace.effective_rate`, formula: '(1 + i)^periods_per_year − 1, where Σ payment_k / (1 + i)^k = principal − fees',
      inputs: {
        received: m(received), periods_per_year: periodsPerYear.toString(),
        i: ear.solution.periodicRate.toString(), iterations: ear.solution.iterations.toString(),
      },
      result: shownValue(ear.value),
    },
  );

  const figures: ResultFigure[] = [
    { key: 'instalment', labelKey: `${P}.figure.instalment_${i.payment_frequency}`, value: checkedMoney(base.instalment, i.currency), primary: true },
    { key: 'total_cost_of_credit', labelKey: `${P}.figure.total_cost_of_credit`, value: checkedMoney(costOfCredit, i.currency), primary: true },
    { key: 'effective_annual_rate', labelKey: `${P}.figure.effective_annual_rate`, value: ear.value, primary: true },
    { key: 'total_repayment', labelKey: `${P}.figure.total_repayment`, value: checkedMoney(base.totalRepayment, i.currency) },
    { key: 'total_interest', labelKey: `${P}.figure.total_interest`, value: checkedMoney(base.totalInterest, i.currency) },
    { key: 'fees', labelKey: `${P}.figure.fees`, value: checkedMoney(fee, i.currency) },
    { key: 'number_of_payments', labelKey: `${P}.figure.number_of_payments`, value: countValue(BigInt(n)) },
  ];
  if (finalPayment !== base.instalment) {
    figures.push({ key: 'final_payment', labelKey: `${P}.figure.final_payment`, value: checkedMoney(finalPayment, i.currency) });
  }

  const scheduleTable: ResultTable = {
    key: 'schedule', titleKey: `${P}.table.schedule`, kind: 'schedule',
    columns: ['period', 'opening_balance', 'payment', 'principal', 'interest', 'closing_balance'].map(c => ({ key: c, labelKey: `${P}.col.${c}` })),
    rows: base.rows.map((row, index) => ({
      key: `p${index + 1}`,
      cells: {
        period: countValue(BigInt(index + 1)),
        opening_balance: checkedMoney(row.opening, i.currency),
        payment: checkedMoney(row.payment, i.currency),
        principal: checkedMoney(row.principal, i.currency),
        interest: checkedMoney(row.interest, i.currency),
        closing_balance: checkedMoney(row.closing, i.currency),
      },
    })),
  };

  const stressTable: ResultTable = {
    key: 'stress', titleKey: `${P}.table.stress`, kind: 'sensitivity',
    columns: ['annual_rate', 'instalment', 'total_repayment', 'total_cost', 'effective_rate'].map(c => ({ key: c, labelKey: `${P}.col.${c}` })),
    rows: STRESS_POINTS.map(points => {
      const rate = i.annual_rate_percent.plus(points);
      const loan = points === '0' ? base : loanAt(i, rate, n, periodsPerYear);
      return {
        key: points === '0' ? 'base' : `plus_${points}`,
        labelKey: points === '0' ? `${P}.row.stress_base` : `${P}.row.stress_plus_${points}`,
        cells: {
          annual_rate: percentValue(rate.div(100)),
          instalment: checkedMoney(loan.instalment, i.currency),
          total_repayment: checkedMoney(loan.totalRepayment, i.currency),
          total_cost: checkedMoney(loan.totalInterest + fee, i.currency),
          effective_rate: points === '0' ? ear.value : effectiveAnnualRate(received, loan.rows, periodsPerYear).value,
        },
      };
    }),
  };

  const assumptions: Assumption[] = [
    i.rate_basis === 'flat'
      ? { key: 'rate_basis', messageKey: `${P}.assumption.flat`, values: { rate: i.annual_rate_percent.toString() }, source: 'user' }
      : { key: 'rate_basis', messageKey: `${P}.assumption.reducing_balance`, values: { rate: i.annual_rate_percent.toString() }, source: 'user' },
    fee > 0n
      ? { key: 'fees', messageKey: `${P}.assumption.fees_upfront`, values: { received: m(received) }, source: 'user' }
      : { key: 'fees', messageKey: `${P}.assumption.no_fees`, source: i.fee_amount === undefined && i.fee_percent === undefined ? 'default' : 'user' },
    { key: 'effective_rate', messageKey: `${P}.assumption.effective_rate`, source: 'default' },
  ];

  const warnings: Warning[] = [];
  if (i.rate_basis === 'flat' && ear.value.kind === 'percent' && !i.annual_rate_percent.isZero()) {
    warnings.push({ key: 'flat_rate', messageKey: `${P}.warning.flat_rate`, values: { quoted: i.annual_rate_percent.toString(), effective: ear.value.value } });
  }
  if (!ear.solution.converged) warnings.push({ key: 'rate_not_found', messageKey: `${P}.warning.rate_not_found` });

  return {
    ok: true,
    output: { figures, tables: [stressTable, scheduleTable] },
    trace,
    assumptions,
    warnings,
    ruleVersionIds: [],
  };
}

export const loanAffordability = defineCalculator<Input>({
  code: 'loan_affordability',
  version: LOAN_AFFORDABILITY_VERSION,
  blueprintId: 'F4.06',
  group: 'financing',
  complexity: 'advanced',
  input,
  example: {
    currency: 'JOD', principal: '15000000', term_months: '36', annual_rate_percent: '6', rate_basis: 'flat',
    fee_type: 'percent', fee_percent: '1', payment_frequency: 'monthly',
  },
  fields: [
    { key: 'principal', kind: 'money', period: 'one_off', labelKey: `${P}.field.principal`, helpKey: `${P}.help.principal` },
    { key: 'term_months', kind: 'number', unit: 'months', integer: true, min: '1', max: '600', labelKey: `${P}.field.term_months` },
    { key: 'annual_rate_percent', kind: 'percent', min: '0', max: '100', labelKey: `${P}.field.annual_rate_percent`, helpKey: `${P}.help.annual_rate_percent` },
    {
      key: 'rate_basis', kind: 'select', labelKey: `${P}.field.rate_basis`, helpKey: `${P}.help.rate_basis`,
      options: [
        { value: 'reducing_balance', labelKey: `${P}.option.reducing_balance` },
        { value: 'flat', labelKey: `${P}.option.flat` },
      ],
    },
    {
      key: 'fee_type', kind: 'select', optional: true, labelKey: `${P}.field.fee_type`,
      options: [
        { value: 'fixed', labelKey: `${P}.option.fee_fixed` },
        { value: 'percent', labelKey: `${P}.option.fee_percent` },
      ],
    },
    { key: 'fee_amount', kind: 'money', period: 'one_off', optional: true, labelKey: `${P}.field.fee_amount`, helpKey: `${P}.help.fee_amount` },
    { key: 'fee_percent', kind: 'percent', min: '0', max: '100', optional: true, labelKey: `${P}.field.fee_percent`, helpKey: `${P}.help.fee_percent` },
    {
      key: 'payment_frequency', kind: 'select', labelKey: `${P}.field.payment_frequency`,
      options: [
        { value: 'monthly', labelKey: `${P}.option.monthly` },
        { value: 'quarterly', labelKey: `${P}.option.quarterly` },
      ],
    },
  ],
  compute,
});
