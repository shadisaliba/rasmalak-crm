import { MoneyError, minorUnits, parseMajor, type CurrencyCode } from '@/sme/money';
import type { Cell, DecimalSeparator } from './types';

export type AmountResult = { minor: bigint } | { error: 'invalid' | 'too_many_decimals' } | null;

const CURRENCY_TOKENS = /(JOD|JD|USD|EUR|GBP|SAR|AED|د\.?\s*أ\.?|دينار|دولار|\$|€|£)/giu;

/**
 * A statement amount in minor units of the account currency. Accepts signs written as a leading
 * or trailing minus, parentheses, or CR / DR markers. Never rounds: more decimals than the
 * currency allows is an error.
 */
export function parseAmountCell(value: Cell, currency: CurrencyCode, decimalSeparator: DecimalSeparator): AmountResult {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { error: 'invalid' };
    const fixed = value.toFixed(minorUnits(currency));
    // Spreadsheet floats carry binary noise (12.4999999); anything beyond that is real precision.
    if (Math.abs(Number(fixed) - value) > 1e-9 * Math.max(1, Math.abs(value))) return { error: 'too_many_decimals' };
    return { minor: parseMajor(fixed, currency).minor };
  }

  let text = String(value).replace(/[  \s]/g, '').replace(CURRENCY_TOKENS, '');
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  const marker = /(CR|DR)$/i.exec(text) ?? /^(CR|DR)/i.exec(text);
  if (marker) {
    negative = marker[1].toUpperCase() === 'DR';
    text = text.replace(/^(CR|DR)|(CR|DR)$/i, '');
  }
  if (/[-−]$/.test(text)) { negative = true; text = text.slice(0, -1); }
  if (/^[-−]/.test(text)) { negative = true; text = text.slice(1); }
  if (/^\+/.test(text)) text = text.slice(1);
  if (decimalSeparator === ',') text = text.replace(/\./g, '').replace(/,/g, '.');

  try {
    const minor = parseMajor(text, currency).minor;
    return { minor: negative ? -minor : minor };
  } catch (err) {
    return { error: err instanceof MoneyError && err.code === 'TOO_MANY_DECIMALS' ? 'too_many_decimals' : 'invalid' };
  }
}
