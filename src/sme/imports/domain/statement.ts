import type { CurrencyCode } from '@/sme/money';
import { parseAmountCell, type AmountResult } from './amounts';
import { suggestCategory, suggestChannel } from './categorize';
import { addYears, parseDateCell } from './dates';
import type { Cell, ColumnMapping, ParseFailure, ParseOptions, RowIssue, StagedRow } from './types';

export interface StatementContext {
  currency: CurrencyCode;
  /** Today in Jordan (YYYY-MM-DD); later dates are invalid. */
  today: string;
  maxRows: number;
}

/** Dates further back than this are treated as implausible for a statement. */
export const PLAUSIBLE_YEARS = 10;

const text = (cell: Cell | undefined): string => (cell === null || cell === undefined ? '' : String(cell).trim());
const isBlank = (record: Cell[]) => record.every(c => text(c) === '');

function amountFrom(record: Cell[], mapping: ColumnMapping, options: ParseOptions, currency: CurrencyCode): { minor: bigint | null; issue?: string } {
  const parse = (i: number | undefined): AmountResult => (i === undefined ? null : parseAmountCell(record[i] ?? null, currency, options.decimal_separator));
  const failed = (r: AmountResult) => (r && 'error' in r ? r.error : null);

  if (options.amount_mode === 'signed') {
    const r = parse(mapping.amount);
    if (failed(r)) return { minor: null, issue: failed(r)! };
    if (!r || !('minor' in r) || r.minor === 0n) return { minor: null, issue: 'required' };
    return { minor: r.minor };
  }
  const debit = parse(mapping.debit);
  const credit = parse(mapping.credit);
  const bad = failed(debit) ?? failed(credit);
  if (bad) return { minor: null, issue: bad };
  const d = debit && 'minor' in debit ? debit.minor : 0n;
  const c = credit && 'minor' in credit ? credit.minor : 0n;
  if (d !== 0n && c !== 0n) return { minor: null, issue: 'both_debit_and_credit' };
  if (d === 0n && c === 0n) return { minor: null, issue: 'required' };
  // Some banks print debits as negative numbers already; the column decides the sign.
  return { minor: d !== 0n ? -(d < 0n ? -d : d) : c < 0n ? -c : c };
}

/** Turns the mapped table into staged rows. Pure: the same input always gives the same rows. */
export function buildStagedRows(
  table: Cell[][], firstRowNumber: number, mapping: ColumnMapping, options: ParseOptions, ctx: StatementContext,
): { rows: StagedRow[] } | ParseFailure {
  const header = table[mapping.header_row];
  if (!header) return { code: 'PARSE_FAILED', reason: 'no_header' };
  const width = header.length;
  const columns = [mapping.date, ...mapping.description, mapping.amount, mapping.debit, mapping.credit, mapping.reference].filter((c): c is number => c !== undefined);
  if (columns.some(c => c < 0 || c >= width)) return { code: 'PARSE_FAILED', reason: 'mapping_out_of_range' };
  if (options.amount_mode === 'signed' ? mapping.amount === undefined : mapping.debit === undefined || mapping.credit === undefined) {
    return { code: 'PARSE_FAILED', reason: 'amount_columns' };
  }

  const names = header.map((h, i) => text(h) || `column_${i + 1}`);
  const data = table.slice(mapping.header_row + 1);
  if (data.filter(r => !isBlank(r)).length > ctx.maxRows) return { code: 'FILE_TOO_LARGE', reason: 'too_many_rows' };
  const earliest = addYears(ctx.today, -PLAUSIBLE_YEARS);

  const rows: StagedRow[] = [];
  data.forEach((record, k) => {
    if (isBlank(record)) return;
    const issues: RowIssue[] = [];
    const raw = Object.fromEntries(names.map((n, i) => [n, text(record[i])]));

    const valueDate = parseDateCell(record[mapping.date] ?? null, options.date_format);
    if (!valueDate) issues.push({ field: 'value_date', code: text(record[mapping.date]) ? 'invalid' : 'required' });
    else if (valueDate > ctx.today || valueDate < earliest) issues.push({ field: 'value_date', code: 'out_of_range' });

    const amount = amountFrom(record, mapping, options, ctx.currency);
    if (amount.issue) issues.push({ field: 'amount', code: amount.issue });

    const description = mapping.description.map(i => text(record[i])).filter(Boolean).join(' ').slice(0, 500);
    const reference = mapping.reference === undefined ? '' : text(record[mapping.reference]).slice(0, 120);

    rows.push({
      row_number: firstRowNumber + mapping.header_row + 1 + k,
      raw,
      value_date: valueDate,
      amount_minor: amount.minor === null ? null : amount.minor.toString(),
      description,
      external_ref: reference || null,
      suggested_category_code: amount.minor === null ? null : suggestCategory(description, amount.minor),
      channel: suggestChannel(description),
      issues,
    });
  });

  if (!rows.length) return { code: 'PARSE_FAILED', reason: 'no_rows' };
  return { rows };
}
