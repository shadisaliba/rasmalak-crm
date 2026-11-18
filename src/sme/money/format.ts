import { minorUnits } from './currencies';
import { toMajorString, type Money } from './money';

export type UiLocale = 'ar' | 'en';

// Arabic UI uses Arabic-Indic numerals (rule R1); English uses Jordanian conventions.
export const INTL_LOCALE: Record<UiLocale, string> = {
  ar: 'ar-JO-u-nu-arab',
  en: 'en-JO',
};

export type CurrencyDisplay = 'symbol' | 'narrowSymbol' | 'code' | 'name' | 'none';

export interface FormatMoneyOptions {
  currencyDisplay?: CurrencyDisplay;
  /** Summary tiles show whole units; Intl rounds half away from zero (halfExpand). */
  wholeUnits?: boolean;
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never';
}

export function formatMoney(value: Money, locale: UiLocale, options: FormatMoneyOptions = {}): string {
  const digits = options.wholeUnits ? 0 : minorUnits(value.currency);
  const display = options.currencyDisplay ?? 'symbol';
  const format = new Intl.NumberFormat(INTL_LOCALE[locale], {
    ...(display === 'none'
      ? { style: 'decimal' as const }
      : { style: 'currency' as const, currency: value.currency, currencyDisplay: display }),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: options.signDisplay ?? 'auto',
  });
  // Intl formats a decimal string exactly; converting to a number first could lose precision.
  return format.format(toMajorString(value) as Intl.StringNumericLiteral);
}
