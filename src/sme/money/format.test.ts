import { describe, expect, it } from 'vitest';
import { formatMoney } from './format';
import { money, parseMajor } from './money';

const ARABIC_DIGITS = /[٠-٩]/;
const WESTERN_DIGITS = /[0-9]/;

describe('formatMoney', () => {
  it('renders three Arabic-Indic decimal places for JOD in Arabic', () => {
    const text = formatMoney({ minor: 1_234_567n, currency: 'JOD' }, 'ar');
    expect(text).toMatch(ARABIC_DIGITS);
    expect(text).not.toMatch(WESTERN_DIGITS);
    expect(text).toContain('١٬٢٣٤٫٥٦٧');
  });

  it('renders 1,234.567 for JOD in English', () => {
    const text = formatMoney({ minor: 1_234_567n, currency: 'JOD' }, 'en');
    expect(text).toContain('1,234.567');
    expect(text).toContain('JOD');
  });

  it('keeps trailing zeros to the currency precision', () => {
    expect(formatMoney(money(800_000n, 'JOD'), 'en', { currencyDisplay: 'none' })).toBe('800.000');
    expect(formatMoney(money(5n, 'USD'), 'en', { currencyDisplay: 'none' })).toBe('0.05');
  });

  it('shows the sign of negative amounts', () => {
    expect(formatMoney(money(-12_345n, 'JOD'), 'en', { currencyDisplay: 'none' })).toBe('-12.345');
    expect(formatMoney(money(-12_345n, 'JOD'), 'ar', { currencyDisplay: 'none' })).toMatch(/١٢٫٣٤٥/);
  });

  it('formats values beyond float precision exactly', () => {
    const big = parseMajor('8999999999999.999', 'JOD');
    expect(formatMoney(big, 'en', { currencyDisplay: 'none' })).toBe('8,999,999,999,999.999');
  });

  it('rounds summary tiles to whole units half away from zero', () => {
    expect(formatMoney(money(1_234_500n, 'JOD'), 'en', { currencyDisplay: 'none', wholeUnits: true })).toBe('1,235');
    expect(formatMoney(money(-1_234_500n, 'JOD'), 'en', { currencyDisplay: 'none', wholeUnits: true })).toBe('-1,235');
    expect(formatMoney(money(1_234_499n, 'JOD'), 'en', { currencyDisplay: 'none', wholeUnits: true })).toBe('1,234');
  });
});
