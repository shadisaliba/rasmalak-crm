import Decimal from 'decimal.js';
import { minorUnits, type CurrencyCode } from '@/sme/money';

/**
 * Preview of the base amount the database will compute (sme_ledger_insert): amount × rate,
 * scaled to JOD's three decimals, rounded once, half away from zero. The database value is the
 * one stored; this only shows the user what to expect.
 */
export function toBaseMinor(amountMinor: bigint, currency: CurrencyCode, rate: string): bigint {
  if (currency === 'JOD') return amountMinor;
  const scaled = new Decimal(amountMinor.toString()).times(rate).times(new Decimal(10).pow(3 - minorUnits(currency)));
  return BigInt(scaled.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed());
}

export const FX_RATE_PATTERN = /^[0-9]{1,12}(\.[0-9]{1,12})?$/;
