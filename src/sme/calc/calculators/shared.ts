import { money, type CurrencyCode } from '@/sme/money';
import type { ResultValue } from '../core/types';
import { moneyValue } from '../core/values';

/**
 * moneyValue with the money module's range check. Sums and products of valid inputs can pass the
 * money limit; the MoneyError this throws becomes VALIDATION_FAILED (tools.error.too_large).
 */
export function checkedMoney(minor: bigint, currency: CurrencyCode): ResultValue {
  return moneyValue(money(minor, currency).minor, currency);
}

export function sumMinor(values: readonly bigint[]): bigint {
  return values.reduce((total, v) => total + v, 0n);
}

/** The shown value of a percent, ratio, count or days result, so a trace step matches its figure. */
export function shownValue(v: ResultValue): string {
  return 'value' in v ? v.value : '';
}
