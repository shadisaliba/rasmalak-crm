import Decimal from 'decimal.js';
import { minorUnits, type CurrencyCode } from './currencies';

// Rule R5: money is bigint minor units plus an ISO 4217 code. Rates and ratios use decimal.js.
// JS `number` never carries money through arithmetic here.

export interface Money {
  readonly minor: bigint;
  readonly currency: CurrencyCode;
}

// Comfortably inside Postgres bigint and Number.MAX_SAFE_INTEGER, so any value that passes can
// cross JSON or a numeric column without silent precision loss.
export const MAX_ABS_MINOR = 9_000_000_000_000_000n;

export type MoneyErrorCode = 'INVALID_AMOUNT' | 'TOO_MANY_DECIMALS' | 'OVERFLOW' | 'CURRENCY_MISMATCH' | 'INVALID_WEIGHTS';

export class MoneyError extends Error {
  constructor(readonly code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export type Rounding = 'half_away_from_zero' | 'half_even' | 'away_from_zero' | 'toward_zero';

const DECIMAL_ROUNDING: Record<Rounding, Decimal.Rounding> = {
  half_away_from_zero: Decimal.ROUND_HALF_UP,
  half_even: Decimal.ROUND_HALF_EVEN,
  away_from_zero: Decimal.ROUND_UP,
  toward_zero: Decimal.ROUND_DOWN,
};

// Enough significant digits for a 16-digit amount multiplied by a high-precision rate.
const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

function checked(minor: bigint, currency: CurrencyCode): Money {
  if (minor > MAX_ABS_MINOR || minor < -MAX_ABS_MINOR) {
    throw new MoneyError('OVERFLOW', `Amount exceeds ±${MAX_ABS_MINOR} minor units`);
  }
  return Object.freeze({ minor, currency });
}

export function money(minor: bigint, currency: CurrencyCode): Money {
  return checked(minor, currency);
}

export function zero(currency: CurrencyCode): Money {
  return checked(0n, currency);
}

// Arabic-Indic and Extended Arabic-Indic (Persian) digits, typed on Arabic and Persian keyboards.
function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));
}

const UNGROUPED = /^\d+(?:\.(\d+))?$/;
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.(\d+))?$/;

/**
 * Parses a user-entered major-unit amount ("1,234.567", "١٬٢٣٤٫٥٦٧", "-12.5") into minor units.
 * Thousands separators must group by three, so "1,5" is rejected rather than read as 15.
 * More decimals than the currency allows is an error, never a silent rounding.
 */
export function parseMajor(input: string, currency: CurrencyCode): Money {
  let text = normalizeDigits(input.trim())
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/[−‒–]/g, '-'); // typographic minus signs
  let negative = false;
  if (text.startsWith('-') || text.startsWith('+')) {
    negative = text.startsWith('-');
    text = text.slice(1);
  }
  const match = UNGROUPED.exec(text) ?? GROUPED.exec(text);
  if (!match) throw new MoneyError('INVALID_AMOUNT', `Not an amount: "${input}"`);

  const digits = minorUnits(currency);
  const fraction = match[1] ?? '';
  if (fraction.length > digits) {
    throw new MoneyError('TOO_MANY_DECIMALS', `${currency} allows at most ${digits} decimal places`);
  }
  const whole = text.split('.')[0].replace(/,/g, '');
  const minor = BigInt(whole + fraction.padEnd(digits, '0'));
  return checked(negative ? -minor : minor, currency);
}

/** Plain major-unit string with exactly the currency's decimals and no grouping, e.g. "-1234.567". */
export function toMajorString(value: Money): string {
  const digits = minorUnits(value.currency);
  const negative = value.minor < 0n;
  const abs = (negative ? -value.minor : value.minor).toString().padStart(digits + 1, '0');
  const whole = abs.slice(0, abs.length - digits);
  const fraction = abs.slice(abs.length - digits);
  return `${negative ? '-' : ''}${whole}${digits > 0 ? `.${fraction}` : ''}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError('CURRENCY_MISMATCH', `Cannot combine ${a.currency} with ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return checked(a.minor + b.minor, a.currency);
}

export function sub(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return checked(a.minor - b.minor, a.currency);
}

export function negate(a: Money): Money {
  return checked(-a.minor, a.currency);
}

/** The currency is explicit so that an empty list still has one. */
export function sum(values: readonly Money[], currency: CurrencyCode): Money {
  let total = 0n;
  for (const v of values) {
    if (v.currency !== currency) throw new MoneyError('CURRENCY_MISMATCH', `Cannot add ${v.currency} to a ${currency} sum`);
    total += v.minor;
  }
  return checked(total, currency);
}

/**
 * Multiplies by a rate or ratio and rounds once, to whole minor units.
 * Callers that keep a calculation trace record the rounding mode they passed.
 */
export function mulRatio(value: Money, ratio: Decimal.Value, rounding: Rounding = 'half_away_from_zero'): Money {
  const exact = new D(value.minor.toString()).times(new D(ratio));
  return checked(BigInt(exact.toDecimalPlaces(0, DECIMAL_ROUNDING[rounding]).toFixed(0)), value.currency);
}

/**
 * Splits a total across non-negative integer weights so the parts always add back to the total
 * exactly (largest-remainder method; ties go to the earlier weight).
 */
export function allocateProportionally(total: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0 || weights.some(w => w < 0n)) {
    throw new MoneyError('INVALID_WEIGHTS', 'Weights must be a non-empty list of non-negative integers');
  }
  const weightSum = weights.reduce((acc, w) => acc + w, 0n);
  if (weightSum === 0n) throw new MoneyError('INVALID_WEIGHTS', 'Weights must not all be zero');

  const negative = total.minor < 0n;
  const amount = negative ? -total.minor : total.minor;
  const shares = weights.map(w => (amount * w) / weightSum);
  const remainders = weights.map((w, i) => ({ i, r: (amount * w) % weightSum }));
  let leftover = amount - shares.reduce((acc, s) => acc + s, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    shares[i] += 1n;
    leftover -= 1n;
  }
  return shares.map(s => checked(negative ? -s : s, total.currency));
}

/**
 * Boundary adapter for legacy CRM numeric columns (deal values, quote lines) that reach the
 * client as JS numbers. SME code never holds money as a number; it starts from parseMajor or
 * from bigint minor units.
 */
export function fromMajorNumber(amount: number, currency: CurrencyCode): Money {
  if (!Number.isFinite(amount)) throw new MoneyError('INVALID_AMOUNT', `Not a finite amount: ${amount}`);
  const scaled = new D(amount.toString()).times(new D(10).pow(minorUnits(currency)));
  return checked(BigInt(scaled.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)), currency);
}
