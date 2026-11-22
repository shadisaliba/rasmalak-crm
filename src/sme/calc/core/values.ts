import Decimal from 'decimal.js';
import { z } from 'zod';
import { CURRENCY_CODES, minorUnits, type CurrencyCode } from '@/sme/money';
import type { ResultValue, TraceStep } from './types';

// Rates and ratios use decimal.js; money stays in bigint minor units until the result (R5).
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

// Comfortably inside the money module's limit, so results never overflow it.
const MAX_INPUT_MINOR = 1_000_000_000_000_000n;
const INTEGER = /^-?\d{1,19}$/;
const DECIMAL = /^-?\d{1,15}(?:\.\d{1,10})?$/;

// ── Wire schemas ────────────────────────────────────────────

export const currencyField = z.enum(CURRENCY_CODES as [CurrencyCode, ...CurrencyCode[]]).default('JOD');

/** Minor units as an integer string. Non-negative unless allowed. */
export function minorField(options: { allowNegative?: boolean } = {}) {
  return z.string().trim().regex(INTEGER, 'not_an_amount')
    .transform(v => BigInt(v))
    .refine(v => v <= MAX_INPUT_MINOR && v >= -MAX_INPUT_MINOR, 'too_large')
    .refine(v => options.allowNegative || v >= 0n, 'negative_not_allowed');
}

/** A decimal string such as a percent ("12.5") or a count of hours. */
export function decimalField(options: { min?: string; max?: string; integer?: boolean } = {}) {
  return z.string().trim().regex(DECIMAL, 'not_a_number')
    .transform(v => new Dec(v))
    .refine(v => !options.integer || v.isInteger(), 'not_an_integer')
    .refine(v => options.min === undefined || v.gte(options.min), 'below_minimum')
    .refine(v => options.max === undefined || v.lte(options.max), 'above_maximum');
}

export const isoDateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'not_a_date');

// ── Rounding (once, half away from zero, recorded) ──────────

/** Rounds an exact amount of minor units to an integer, half away from zero. */
export function roundMinor(exact: Dec): bigint {
  return BigInt(exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

/** Rounds up (toward +∞), for counts such as break-even units where a fraction means one more. */
export function ceilToInteger(exact: Dec): bigint {
  return BigInt(exact.toDecimalPlaces(0, Decimal.ROUND_CEIL).toFixed(0));
}

export function roundingNote(exact: Dec, rounded: bigint, mode: 'half_away_from_zero' | 'up' = 'half_away_from_zero'): TraceStep['rounding'] {
  return { mode, exact: exact.toString(), rounded: rounded.toString() };
}

export function dec(value: bigint | number | string): Dec {
  return new Dec(typeof value === 'bigint' ? value.toString() : value);
}

// ── Result values ───────────────────────────────────────────

export function moneyValue(minor: bigint, currency: CurrencyCode): ResultValue {
  return { kind: 'money', minor: minor.toString(), currency };
}

/** A percent result; `ratio` 0.355 is shown as 35.5 %. Kept to 4 decimals of a percent. */
export function percentValue(ratio: Dec): ResultValue {
  return { kind: 'percent', value: ratio.mul(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString() };
}

export function ratioValue(value: Dec, places = 4): ResultValue {
  return { kind: 'ratio', value: value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toString() };
}

export function countValue(value: bigint | Dec): ResultValue {
  return { kind: 'count', value: value.toString() };
}

export function daysValue(value: Dec): ResultValue {
  return { kind: 'days', value: value.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString() };
}

export function hoursValue(value: Dec): ResultValue {
  return { kind: 'hours', value: value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString() };
}

export function noneValue(reasonKey: string): ResultValue {
  return { kind: 'none', reasonKey };
}

/** Major-unit text of an amount for traces, e.g. 12500n JOD → "12.500". */
export function majorText(minor: bigint, currency: CurrencyCode): string {
  return dec(minor).div(new Dec(10).pow(minorUnits(currency))).toFixed(minorUnits(currency));
}
