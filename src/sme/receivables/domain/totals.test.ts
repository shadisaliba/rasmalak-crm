import { describe, expect, it } from 'vitest';
import { invoiceTotals, lineAmounts, percentToBp } from './totals';

// Same cases as supabase/tests/110_sme_receivables.sql.
describe('invoice totals', () => {
  it('rounds each line once, half away from zero', () => {
    expect(lineAmounts('1.5', 333n, 1600)).toEqual({ subtotal: 500n, tax: 80n });
    expect(lineAmounts('2', 400000n, 0)).toEqual({ subtotal: 800000n, tax: 0n });
    expect(lineAmounts('0.001', 500n, 0)).toEqual({ subtotal: 1n, tax: 0n });
  });

  it('sums lines', () => {
    expect(invoiceTotals([{ quantity: '1.5', unitPriceMinor: 333n, taxRateBp: 1600 }, { quantity: '2', unitPriceMinor: 400000n, taxRateBp: 0 }]))
      .toEqual({ subtotal: 800500n, tax: 80n, total: 800580n });
  });

  it('reads percentages as basis points', () => {
    expect(percentToBp('16')).toBe(1600);
    expect(percentToBp('7.25')).toBe(725);
    expect(percentToBp('101')).toBeNull();
    expect(percentToBp('x')).toBeNull();
  });
});
