import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { contextWithoutRules, runCalculation } from '../core/run';
import { solvePeriodicRate } from './loanAffordability';
import { figure, missingMessageKeys, moneyResult, ok, table } from './testSupport';

const ctx = contextWithoutRules('2026-11-22');

// A flat-rate equipment loan as often quoted: 15,000 JOD, 6 % flat, 36 months, 1 % fee.
const flatOffer = {
  currency: 'JOD',
  principal: '15000000',
  term_months: '36',
  annual_rate_percent: '6',
  rate_basis: 'flat',
  fee_type: 'percent',
  fee_percent: '1',
  payment_frequency: 'monthly',
};
const reducing = { currency: 'JOD', principal: '10000000', term_months: '24', annual_rate_percent: '9', rate_basis: 'reducing_balance', payment_frequency: 'monthly' };

const run = (input: Record<string, string>) => runCalculation('loan_affordability', input, ctx).outcome;
const pct = (value: string) => ({ kind: 'percent', value });

const D40 = Decimal.clone({ precision: 40 });

/** Σ payment / (1 + i)^k − received, which the solved rate must bring to zero. */
function residual(received: bigint, payments: bigint[], rate: string): Decimal {
  const i = new D40(rate);
  return payments.reduce((sum, p, k) => sum.plus(new D40(p.toString()).div(i.plus(1).pow(k + 1))), new D40(0)).minus(received.toString());
}

describe('loan_affordability (F4.06)', () => {
  it('costs a flat-rate offer with its fee and gives the effective rate (golden)', () => {
    const r = runCalculation('loan_affordability', flatOffer, ctx);
    expect(r.version).toBe('1.0.0');
    const o = r.outcome;
    // Interest 15,000 × 6 % × 3 years = 2,700; instalment 17,700 / 36 = 491.6666… → 491.667 JOD.
    expect(figure(o, 'instalment')).toEqual(moneyResult('491667'));
    expect(figure(o, 'total_interest')).toEqual(moneyResult('2700000'));
    // 35 × 491.667 = 17,208.345, so the last payment is 17,700 − 17,208.345 = 491.655.
    expect(figure(o, 'final_payment')).toEqual(moneyResult('491655'));
    expect(figure(o, 'total_repayment')).toEqual(moneyResult('17700000'));
    // Fee 1 % = 150; cost of credit 2,700 + 150 = 2,850.
    expect(figure(o, 'fees')).toEqual(moneyResult('150000'));
    expect(figure(o, 'total_cost_of_credit')).toEqual(moneyResult('2850000'));
    // IRR on 14,850 received against those 36 payments: 0.98159 % a month, (1 + i)^12 − 1 = 12.4362 %
    // (checked independently by bisection).
    expect(figure(o, 'effective_annual_rate')).toEqual(pct('12.4362'));
    expect(figure(o, 'number_of_payments')).toEqual({ kind: 'count', value: '36' });
    expect(ok(o).warnings).toEqual([expect.objectContaining({ key: 'flat_rate', values: { quoted: '6', effective: '12.4362' } })]);
  });

  it('stress-tests the rate at +2 and +4 points (golden)', () => {
    const stress = table(run(flatOffer), 'stress');
    expect(stress.kind).toBe('sensitivity');
    expect(stress.rows.map(r => r.key)).toEqual(['base', 'plus_2', 'plus_4']);
    const row = (n: number) => stress.rows[n].cells;
    expect(row(0).instalment).toEqual(moneyResult('491667'));
    // 8 % flat: interest 3,600, instalment 18,600 / 36 = 516.667, cost 3,750, effective 16.3729 %.
    expect(row(1)).toEqual({ annual_rate: pct('8'), instalment: moneyResult('516667'), total_repayment: moneyResult('18600000'), total_cost: moneyResult('3750000'), effective_rate: pct('16.3729') });
    // 10 % flat: interest 4,500, instalment 541.667, cost 4,650, effective 20.3217 %.
    expect(row(2)).toEqual({ annual_rate: pct('10'), instalment: moneyResult('541667'), total_repayment: moneyResult('19500000'), total_cost: moneyResult('4650000'), effective_rate: pct('20.3217') });
  });

  it('converts a known flat quote to its effective rate', () => {
    // 10,000 JOD at 5 % flat over 12 months: 875 a month. Bisection gives i = 0.758718 % a month,
    // 9.1046 % nominal and (1 + i)^12 − 1 = 9.4943 % effective.
    const o = ok(run({ ...flatOffer, principal: '10000000', term_months: '12', annual_rate_percent: '5', fee_type: 'fixed', fee_percent: '0' }));
    expect(figure(o, 'instalment')).toEqual(moneyResult('875000'));
    expect(figure(o, 'effective_annual_rate')).toEqual(pct('9.4943'));
    expect(o.output.figures.map(f => f.key)).not.toContain('final_payment');
  });

  it('builds a reducing-balance schedule from the ported formula (golden)', () => {
    const o = ok(run(reducing));
    // r = 0.75 %; 10,000 × r(1 + r)^24 / ((1 + r)^24 − 1) = 456.8474… → 456.847 JOD.
    expect(figure(o, 'instalment')).toEqual(moneyResult('456847'));
    expect(o.trace.find(s => s.labelKey.endsWith('trace.instalment'))?.rounding).toEqual(expect.objectContaining({ mode: 'half_away_from_zero', rounded: '456847' }));
    expect(figure(o, 'total_interest')).toEqual(moneyResult('964337'));
    expect(figure(o, 'final_payment')).toEqual(moneyResult('456856'));
    // Without fees the effective rate is the monthly rate compounded: 1.0075^12 − 1 = 9.3807 %.
    expect(figure(o, 'effective_annual_rate')).toEqual(pct('9.3807'));

    const schedule = table(o, 'schedule');
    expect(schedule.rows).toHaveLength(24);
    // First month: interest 10,000 × 0.75 % = 75, so 381.847 of the loan is repaid.
    expect(schedule.rows[0].cells).toEqual({
      period: { kind: 'count', value: '1' }, opening_balance: moneyResult('10000000'), payment: moneyResult('456847'),
      principal: moneyResult('381847'), interest: moneyResult('75000'), closing_balance: moneyResult('9618153'),
    });
    expect(schedule.rows[23].cells.closing_balance).toEqual(moneyResult('0'));
    // Each row's opening balance is the previous row's closing balance.
    for (let k = 1; k < 24; k++) expect(schedule.rows[k].cells.opening_balance).toEqual(schedule.rows[k - 1].cells.closing_balance);
  });

  it('pays quarterly and includes a fixed fee in the effective rate', () => {
    // 20,000 JOD at 8 % reducing, 12 quarterly payments, 250 JOD fee: r = 2 %, instalment 1,891.192.
    const o = ok(run({ ...reducing, principal: '20000000', term_months: '36', annual_rate_percent: '8', payment_frequency: 'quarterly', fee_type: 'fixed', fee_amount: '250000' }));
    expect(figure(o, 'instalment')).toEqual(moneyResult('1891192'));
    expect(o.output.figures[0].labelKey).toBe('calc.loan_affordability.figure.instalment_quarterly');
    expect(figure(o, 'number_of_payments')).toEqual({ kind: 'count', value: '12' });
    expect(figure(o, 'total_interest')).toEqual(moneyResult('2694304'));
    expect(figure(o, 'total_cost_of_credit')).toEqual(moneyResult('2944304'));
    expect(figure(o, 'effective_annual_rate')).toEqual(pct('9.1178'));
  });

  it('blocks a term that is not whole quarters with PERIOD_MISMATCH', () => {
    expect(run({ ...reducing, term_months: '10', payment_frequency: 'quarterly' })).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'PERIOD_MISMATCH', field: 'term_months' })] });
  });

  it('handles a zero rate: equal instalments, and the fee is the only cost', () => {
    const o = ok(run({ ...reducing, principal: '1200000', term_months: '12', annual_rate_percent: '0', fee_type: 'fixed', fee_amount: '12000' }));
    expect(figure(o, 'instalment')).toEqual(moneyResult('100000'));
    expect(figure(o, 'total_interest')).toEqual(moneyResult('0'));
    expect(figure(o, 'total_cost_of_credit')).toEqual(moneyResult('12000'));
    // 1,188 received for 12 × 100 repaid is 1.8755 % a year.
    expect(figure(o, 'effective_annual_rate')).toEqual(pct('1.8755'));
    const free = ok(run({ ...reducing, annual_rate_percent: '0' }));
    expect(figure(free, 'effective_annual_rate')).toEqual(pct('0'));
    expect(free.assumptions.find(a => a.key === 'fees')).toEqual(expect.objectContaining({ messageKey: 'calc.loan_affordability.assumption.no_fees', source: 'default' }));
  });

  it('rejects a zero or negative loan, a missing percentage fee and fees as large as the loan', () => {
    expect(run({ ...reducing, principal: '0' })).toEqual({ ok: false, errors: [expect.objectContaining({ code: 'VALIDATION_FAILED', field: 'principal', messageKey: 'calc.loan_affordability.error.no_principal' })] });
    expect(run({ ...reducing, principal: '-1' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'principal', messageKey: 'tools.error.negative_not_allowed' })] });
    expect(run({ ...reducing, fee_type: 'percent' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'fee_percent', messageKey: 'tools.error.required' })] });
    expect(run({ ...reducing, fee_type: 'fixed', fee_amount: '10000000' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'fee_amount', messageKey: 'calc.loan_affordability.error.fee_too_high' })] });
    expect(run({ ...reducing, fee_type: 'percent', fee_percent: '100' })).toEqual({ ok: false, errors: [expect.objectContaining({ field: 'fee_percent', messageKey: 'calc.loan_affordability.error.fee_too_high' })] });
    expect(run({ ...reducing, rate_basis: 'compound' }).ok).toBe(false);
    expect(run({ ...reducing, term_months: '12.5' }).ok).toBe(false);
  });

  it('rounds a percentage fee once and records it', () => {
    // 1.5 % of 10,000.333 JOD = 150.004995 → 150.005 JOD.
    const o = ok(run({ ...reducing, principal: '10000333', fee_type: 'percent', fee_percent: '1.5' }));
    expect(figure(o, 'fees')).toEqual(moneyResult('150005'));
    expect(o.trace.find(s => s.labelKey.endsWith('trace.fee'))?.rounding).toEqual({ mode: 'half_away_from_zero', exact: '150004.995', rounded: '150005' });
  });

  it('keeps every schedule row non-negative and the totals exact (property test over random fils values)', () => {
    let seed = 20261122;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    for (let n = 0; n < 60; n++) {
      const principal = 1n + BigInt(next() % 90_000_000);
      const quarterly = next() % 2 === 0;
      const months = quarterly ? 3 * (1 + (next() % 40)) : 1 + (next() % 120);
      const rate = `${next() % 25}.${next() % 100}`;
      const o = ok(run({
        currency: 'JOD', principal: principal.toString(), term_months: String(months), annual_rate_percent: rate,
        rate_basis: next() % 2 === 0 ? 'flat' : 'reducing_balance', payment_frequency: quarterly ? 'quarterly' : 'monthly',
      }));
      const rows = table(o, 'schedule').rows.map(r => Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, BigInt((v as { minor?: string; value?: string }).minor ?? (v as { value: string }).value)])));
      const repaid = rows.reduce((t, r) => t + r.principal, 0n);
      const interest = rows.reduce((t, r) => t + r.interest, 0n);
      expect(repaid).toBe(principal);
      expect(rows.every(r => r.principal >= 0n && r.interest >= 0n && r.payment === r.principal + r.interest)).toBe(true);
      expect(rows[rows.length - 1].closing_balance).toBe(0n);
      expect(figure(o, 'total_repayment')).toEqual(moneyResult(principal + interest));
      expect(figure(o, 'effective_annual_rate')?.kind).toBe('percent');
    }
  });

  it('every key it can show exists in Arabic and English', () => {
    for (const outcome of [
      run(flatOffer), run(reducing), run({ ...reducing, payment_frequency: 'quarterly', fee_type: 'fixed', fee_amount: '1000' }),
      run({ ...reducing, principal: '0' }), run({ ...reducing, term_months: '10', payment_frequency: 'quarterly' }), run({ ...reducing, fee_type: 'fixed', fee_amount: '10000000' }),
    ]) {
      expect(missingMessageKeys(outcome)).toEqual([]);
    }
  });
});

describe('solvePeriodicRate (Newton–Raphson)', () => {
  it('finds the monthly rate of a known annuity and satisfies the equation', () => {
    const payments = Array<bigint>(12).fill(875000n);
    const solution = solvePeriodicRate(10000000n, payments);
    expect(solution.converged).toBe(true);
    expect(solution.iterations).toBeLessThanOrEqual(10);
    // Bisection to 60 digits: 0.0075871840576112834464401046579999…
    expect(solution.periodicRate.toDecimalPlaces(20).toString()).toBe('0.00758718405761128345');
    expect(residual(10000000n, payments, solution.periodicRate.toString()).abs().lt('1e-20')).toBe(true);
  });

  it('returns zero at once when the payments add up to exactly what was received', () => {
    const solution = solvePeriodicRate(1200n, Array<bigint>(12).fill(100n));
    expect(solution).toEqual({ periodicRate: expect.anything(), iterations: 1, converged: true });
    expect(solution.periodicRate.isZero()).toBe(true);
  });

  it('converges on a long, expensive loan without overshooting', () => {
    // 50 years of monthly payments at 3 % a month.
    const r = new Decimal('0.03');
    const instalment = BigInt(new Decimal(1_000_000).mul(r).div(new Decimal(1).minus(r.plus(1).pow(-600))).toDecimalPlaces(0).toFixed(0));
    const solution = solvePeriodicRate(1_000_000n, Array<bigint>(600).fill(instalment));
    expect(solution.converged).toBe(true);
    expect(solution.periodicRate.toDecimalPlaces(6).toString()).toBe('0.03');
  });
});
