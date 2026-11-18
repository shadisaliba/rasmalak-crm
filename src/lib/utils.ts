import { DEFAULT_CURRENCY } from './constants';
import { formatMoney, fromMajorNumber, INTL_LOCALE, isCurrencyCode, type FormatMoneyOptions, type UiLocale } from '@/sme/money';

/**
 * Formats a CRM amount that reaches the client as a JS number (legacy numeric columns).
 * Currencies in the money table use their ISO minor units (JOD: 3) via formatMoney; others are
 * display-only and fall back to Intl's defaults. Arabic uses Arabic-Indic numerals.
 */
export function formatCurrency(
  amount: number,
  currencyCode: string = DEFAULT_CURRENCY,
  language: UiLocale = 'ar',
  options: Pick<FormatMoneyOptions, 'wholeUnits'> = {},
): string {
  if (isCurrencyCode(currencyCode)) {
    return formatMoney(fromMajorNumber(amount, currencyCode), language, options);
  }
  try {
    return new Intl.NumberFormat(INTL_LOCALE[language], {
      style: 'currency',
      currency: currencyCode,
      ...(options.wholeUnits ? { maximumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(INTL_LOCALE[language]).format(amount)} ${currencyCode}`;
  }
}

/** Arabic → Arabic-Indic numerals (٠١٢٣٤), English → Western (01234). Not for money. */
export function fmtNum(value: number, language: UiLocale, decimals?: number): string {
  const opts: Intl.NumberFormatOptions = {};
  if (decimals != null) {
    opts.minimumFractionDigits = decimals;
    opts.maximumFractionDigits = decimals;
  }
  return new Intl.NumberFormat(INTL_LOCALE[language], opts).format(value);
}

/** Returns e.g. "٢٥٫٣%" for Arabic or "25.3%" for English. */
export function fmtPct(value: number, language: UiLocale, decimals: number = 1): string {
  return `${fmtNum(value, language, decimals)}%`;
}

// ar-JO keeps the Gregorian calendar; the previous ar-SA default rendered Hijri dates.
export function formatDate(dateString: string, language: UiLocale = 'ar'): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[language], {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(dateString));
}

/**
 * Validate password meets security requirements:
 * 8+ characters, at least one uppercase, one lowercase, one number.
 */
export function validatePassword(password: string): boolean {
  return password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /[0-9]/.test(password);
}
