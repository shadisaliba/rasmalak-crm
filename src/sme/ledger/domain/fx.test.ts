import { describe, expect, it } from 'vitest';
import { toBaseMinor } from './fx';
import { isStale, todayInAmman } from './dates';

// Same cases as supabase/tests/070_sme_ledger_service.sql.
describe('base amount preview', () => {
  it('matches the database conversion', () => {
    expect(toBaseMinor(1000n, 'USD', '0.709')).toBe(7090n);
    expect(toBaseMinor(1n, 'USD', '0.05')).toBe(1n);
    expect(toBaseMinor(-1n, 'USD', '0.05')).toBe(-1n);
    expect(toBaseMinor(123456n, 'JOD', '9')).toBe(123456n);
  });
});

describe('staleness', () => {
  it('flags accounts without activity for more than 14 days', () => {
    expect(isStale('2026-11-05', '2026-11-19')).toBe(false);
    expect(isStale('2026-11-04', '2026-11-19')).toBe(true);
    expect(isStale(null, '2026-11-19')).toBe(true);
  });

  it('uses the date in Amman', () => {
    expect(todayInAmman(new Date('2026-11-18T22:30:00Z'))).toBe('2026-11-19');
  });
});
