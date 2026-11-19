import type { AmountMode, ColumnMapping } from './types';

const GUESSES: Array<[keyof Omit<ColumnMapping, 'header_row' | 'description'> | 'description', RegExp]> = [
  ['date', /(value\s*date|تاريخ\s*الحق|^date$|تاريخ|date)/i],
  ['description', /(desc|details|narrative|particulars|البيان|الوصف|التفاصيل|شرح)/i],
  ['debit', /(debit|withdraw|مدين|سحب|مسحوب)/i],
  ['credit', /(credit|deposit|دائن|ايداع|إيداع)/i],
  ['reference', /(ref|reference|مرجع|cheque\s*no)/i],
  ['amount', /(amount|المبلغ|القيمة)/i],
];
const BALANCE = /(balance|رصيد)/i;

/** A first guess from header names; the user confirms every column before parsing. */
export function guessMapping(headers: string[]): { mapping: Partial<ColumnMapping>; amountMode: AmountMode } {
  const mapping: Partial<ColumnMapping> = {};
  const taken = new Set<number>();
  for (const [field, re] of GUESSES) {
    const index = headers.findIndex((h, i) => !taken.has(i) && re.test(h.trim()) && !BALANCE.test(h));
    if (index < 0) continue;
    taken.add(index);
    if (field === 'description') mapping.description = [index];
    else mapping[field] = index;
  }
  const amountMode: AmountMode = mapping.amount === undefined && mapping.debit !== undefined && mapping.credit !== undefined ? 'debit_credit' : 'signed';
  return { mapping, amountMode };
}
