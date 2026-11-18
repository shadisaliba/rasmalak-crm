import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDate } from './utils';

describe('formatCurrency (legacy CRM numbers)', () => {
  it('uses ISO minor units and the UI locale', () => {
    expect(formatCurrency(1234.567, 'JOD', 'en')).toContain('1,234.567');
    expect(formatCurrency(1234.567, 'JOD', 'ar')).toContain('١٬٢٣٤٫٥٦٧');
    expect(formatCurrency(19.99, 'USD', 'en')).toContain('19.99');
  });

  it('keeps the sign the previous implementation dropped', () => {
    expect(formatCurrency(-50, 'JOD', 'en')).toMatch(/-/);
  });

  it('falls back for display-only currencies outside the money table', () => {
    expect(formatCurrency(1000, 'MAD', 'en')).toMatch(/1,000/);
  });
});

describe('formatDate', () => {
  it('uses the Gregorian calendar in Arabic', () => {
    const text = formatDate('2026-11-18T12:00:00Z', 'ar');
    expect(text).toContain('٢٠٢٦');
    expect(text).toContain('تشرين الثاني'); // Levantine month name used in Jordan
    expect(text).not.toContain('١٤٤٨'); // the Hijri year ar-SA used to show
  });
});
