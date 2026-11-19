import Decimal from 'decimal.js';

// Mirror of sme_invoice_line_amounts: quantity × unit price, then tax at the line's rate, each
// rounded once, half away from zero. The database recomputes and must agree (R5).
export function lineAmounts(quantity: string, unitPriceMinor: bigint, taxRateBp: number): { subtotal: bigint; tax: bigint } {
  const subtotal = new Decimal(quantity).times(unitPriceMinor.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const tax = subtotal.times(taxRateBp).dividedBy(10000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { subtotal: BigInt(subtotal.toFixed()), tax: BigInt(tax.toFixed()) };
}

export function invoiceTotals(lines: Array<{ quantity: string; unitPriceMinor: bigint; taxRateBp: number }>) {
  let subtotal = 0n;
  let tax = 0n;
  for (const l of lines) {
    const a = lineAmounts(l.quantity, l.unitPriceMinor, l.taxRateBp);
    subtotal += a.subtotal;
    tax += a.tax;
  }
  return { subtotal, tax, total: subtotal + tax };
}

export const QUANTITY_PATTERN = /^[0-9]{1,15}(\.[0-9]{1,3})?$/;

/** "16" or "16.5" percent to basis points; null when not a percentage with at most 2 decimals. */
export function percentToBp(text: string): number | null {
  const t = text.trim();
  if (!/^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(t)) return null;
  const bp = Math.round(Number(t) * 100);
  return bp <= 10000 ? bp : null;
}

export type InvoiceStatus = 'draft' | 'open' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'written_off';
