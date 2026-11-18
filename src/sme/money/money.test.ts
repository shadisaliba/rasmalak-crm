import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  add, allocateProportionally, fromMajorNumber, MAX_ABS_MINOR, money, MoneyError, mulRatio,
  negate, parseMajor, sub, sum, toMajorString, zero,
} from './money';
import { CURRENCY_CODES, CURRENCY_TABLE, minorUnits } from './currencies';

const jod = (minor: bigint) => money(minor, 'JOD');
const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof MoneyError ? e.code : 'OTHER'; }
  return 'NO_ERROR';
};

describe('currencies', () => {
  it('uses ISO 4217 minor units', () => {
    expect(minorUnits('JOD')).toBe(3);
    expect(minorUnits('USD')).toBe(2);
    for (const c of ['KWD', 'BHD', 'OMR', 'IQD', 'TND', 'LYD'] as const) expect(minorUnits(c)).toBe(3);
    for (const c of ['EUR', 'GBP', 'SAR', 'AED', 'QAR', 'EGP'] as const) expect(minorUnits(c)).toBe(2);
    expect(CURRENCY_CODES).toHaveLength(14);
    for (const c of CURRENCY_CODES) expect(CURRENCY_TABLE[c].nameAr).not.toBe('');
  });
});

describe('parseMajor', () => {
  it('reads three-decimal dinars exactly', () => {
    expect(parseMajor('1234.567', 'JOD').minor).toBe(1_234_567n);
    expect(parseMajor('1,234.567', 'JOD').minor).toBe(1_234_567n);
    expect(parseMajor('0.001', 'JOD').minor).toBe(1n);
    expect(parseMajor('12', 'JOD').minor).toBe(12_000n);
    expect(parseMajor('12.5', 'JOD').minor).toBe(12_500n);
  });

  it('reads Arabic-Indic digits and Arabic separators', () => {
    expect(parseMajor('١٬٢٣٤٫٥٦٧', 'JOD').minor).toBe(1_234_567n);
    expect(parseMajor('٣٠٠', 'JOD').minor).toBe(300_000n);
    expect(parseMajor('۱۲٫۵', 'JOD').minor).toBe(12_500n);
  });

  it('reads negative amounts, including a typographic minus', () => {
    expect(parseMajor('-12.345', 'JOD').minor).toBe(-12_345n);
    expect(parseMajor('−5', 'USD').minor).toBe(-500n);
    expect(parseMajor('+5', 'USD').minor).toBe(500n);
  });

  it('rejects more decimals than the currency allows', () => {
    expect(code(() => parseMajor('1.2345', 'JOD'))).toBe('TOO_MANY_DECIMALS');
    expect(code(() => parseMajor('1.005', 'USD'))).toBe('TOO_MANY_DECIMALS');
  });

  it('rejects malformed input and ambiguous grouping', () => {
    for (const bad of ['', 'abc', '1,5', '12,34.5', '1.2.3', '.5', '5.', '1 000', '--1', '1e3']) {
      expect(code(() => parseMajor(bad, 'JOD'))).toBe('INVALID_AMOUNT');
    }
  });

  it('guards against overflow', () => {
    expect(code(() => parseMajor('9000000000000.001', 'JOD'))).toBe('OVERFLOW');
    expect(parseMajor('9000000000000.000', 'JOD').minor).toBe(MAX_ABS_MINOR);
    expect(code(() => money(MAX_ABS_MINOR + 1n, 'JOD'))).toBe('OVERFLOW');
    expect(code(() => money(-MAX_ABS_MINOR - 1n, 'JOD'))).toBe('OVERFLOW');
  });
});

describe('toMajorString', () => {
  it('always prints the currency decimals', () => {
    expect(toMajorString(jod(1_234_567n))).toBe('1234.567');
    expect(toMajorString(jod(5n))).toBe('0.005');
    expect(toMajorString(jod(-5n))).toBe('-0.005');
    expect(toMajorString(zero('USD'))).toBe('0.00');
    expect(toMajorString(money(-123_456n, 'USD'))).toBe('-1234.56');
  });

  it('round-trips through parseMajor', () => {
    for (const minor of [0n, 1n, -1n, 999n, 1000n, 1_234_567n, -98_765_432n]) {
      expect(parseMajor(toMajorString(jod(minor)), 'JOD').minor).toBe(minor);
    }
  });
});

describe('arithmetic', () => {
  it('adds, subtracts, negates and sums exactly in fils', () => {
    expect(add(jod(300_000n), jod(500_000n)).minor).toBe(800_000n);
    expect(sub(jod(800_000n), jod(300_000n)).minor).toBe(500_000n);
    expect(negate(jod(1n)).minor).toBe(-1n);
    expect(sum([jod(100n), jod(200n), jod(-50n)], 'JOD').minor).toBe(250n);
    expect(sum([], 'JOD')).toEqual(zero('JOD'));
  });

  it('never mixes currencies', () => {
    expect(code(() => add(jod(1n), money(1n, 'USD')))).toBe('CURRENCY_MISMATCH');
    expect(code(() => sum([money(1n, 'USD')], 'JOD'))).toBe('CURRENCY_MISMATCH');
  });

  it('avoids float error that JS numbers would introduce', () => {
    const tenth = parseMajor('0.1', 'JOD');
    const fifth = parseMajor('0.2', 'JOD');
    expect(toMajorString(add(tenth, fifth))).toBe('0.300');
    expect(0.1 + 0.2).not.toBe(0.3); // the reason money is not a number
  });

  it('guards sums against overflow', () => {
    expect(code(() => add(jod(MAX_ABS_MINOR), jod(1n)))).toBe('OVERFLOW');
  });
});

describe('mulRatio rounds once, half away from zero by default', () => {
  it('rounds halves away from zero for positive and negative amounts', () => {
    expect(mulRatio(jod(5n), '0.5').minor).toBe(3n);   // 2.5 -> 3
    expect(mulRatio(jod(-5n), '0.5').minor).toBe(-3n); // -2.5 -> -3
    expect(mulRatio(jod(3n), '0.5').minor).toBe(2n);   // 1.5 -> 2
    expect(mulRatio(jod(1n), '0.4').minor).toBe(0n);
  });

  it('supports other explicit modes', () => {
    expect(mulRatio(jod(5n), '0.5', 'half_even').minor).toBe(2n);
    expect(mulRatio(jod(10n), '0.15', 'toward_zero').minor).toBe(1n);
    expect(mulRatio(jod(10n), '0.15', 'away_from_zero').minor).toBe(2n);
  });

  it('applies a rate to three-decimal dinars precisely', () => {
    // 1,234.567 JOD at 1.41 USD per JOD, still in JOD-sized minor units here.
    expect(mulRatio(jod(1_234_567n), new Decimal('1.41')).minor).toBe(1_740_739n); // 1740739.47
    expect(mulRatio(jod(1_000_000n), '0.16').minor).toBe(160_000n);
  });
});

describe('allocateProportionally', () => {
  it('preserves the total exactly', () => {
    const parts = allocateProportionally(jod(1_000n), [1n, 1n, 1n]);
    expect(parts.map(p => p.minor)).toEqual([334n, 333n, 333n]);
    expect(sum(parts, 'JOD').minor).toBe(1_000n);
  });

  it('gives leftover units to the largest remainders', () => {
    const parts = allocateProportionally(jod(100n), [1n, 2n, 3n]);
    expect(parts.map(p => p.minor)).toEqual([17n, 33n, 50n]);
    expect(sum(parts, 'JOD').minor).toBe(100n);
  });

  it('handles negative totals and zero weights', () => {
    const parts = allocateProportionally(jod(-1_000n), [0n, 1n, 2n]);
    expect(parts.map(p => p.minor)).toEqual([0n, -333n, -667n]);
    expect(sum(parts, 'JOD').minor).toBe(-1_000n);
  });

  it('preserves totals across many random splits', () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);
    for (let n = 0; n < 500; n++) {
      const total = BigInt(rand() % 10_000_000) - 5_000_000n;
      const weights = Array.from({ length: 1 + (rand() % 7) }, () => BigInt(rand() % 1000));
      if (!weights.some(w => w > 0n)) weights[0] = 1n;
      expect(sum(allocateProportionally(jod(total), weights), 'JOD').minor).toBe(total);
    }
  });

  it('rejects invalid weights', () => {
    expect(code(() => allocateProportionally(jod(1n), []))).toBe('INVALID_WEIGHTS');
    expect(code(() => allocateProportionally(jod(1n), [0n, 0n]))).toBe('INVALID_WEIGHTS');
    expect(code(() => allocateProportionally(jod(1n), [-1n, 2n]))).toBe('INVALID_WEIGHTS');
  });
});

describe('fromMajorNumber (legacy CRM numeric columns only)', () => {
  it('converts through decimal, not float arithmetic', () => {
    expect(fromMajorNumber(0.1 + 0.2, 'JOD').minor).toBe(300n);
    expect(fromMajorNumber(1234.567, 'JOD').minor).toBe(1_234_567n);
    expect(fromMajorNumber(-0.0005, 'JOD').minor).toBe(-1n);
    expect(fromMajorNumber(19.995, 'USD').minor).toBe(2_000n);
  });

  it('rejects non-finite values', () => {
    expect(code(() => fromMajorNumber(Number.NaN, 'JOD'))).toBe('INVALID_AMOUNT');
    expect(code(() => fromMajorNumber(Number.POSITIVE_INFINITY, 'JOD'))).toBe('INVALID_AMOUNT');
  });
});
