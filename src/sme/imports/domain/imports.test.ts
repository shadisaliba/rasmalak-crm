import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, parseCsvTable } from '@/crm/migration/csvParser';
import { parseAmountCell } from './amounts';
import { suggestCategory, suggestChannel } from './categorize';
import { guessMapping } from './columns';
import { parseDateCell, suggestDateFormat, excelSerialToIso } from './dates';
import { detectEncoding, decodeText } from './decode';
import { isFailure, tableFromFile } from './file';
import { buildStagedRows } from './statement';
import type { ColumnMapping, ParseOptions } from './types';

describe('csv', () => {
  it('handles quotes, doubled quotes, delimiters and newlines inside quotes, CRLF and a BOM', () => {
    const text = '﻿a,b\r\n"1,5","He said ""hi"""\r\n"multi\nline",x\r\n\r\nlast,';
    expect(parseCsvTable(text)).toEqual([['a', 'b'], ['1,5', 'He said "hi"'], ['multi\nline', 'x'], [''], ['last', '']]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(detectDelimiter('date;amount\n01/10/2026;"1,5"\n02/10/2026;2')).toBe(';');
    expect(detectDelimiter('date\tamount\n1\t2')).toBe('\t');
    expect(detectDelimiter('date,amount\n1,2')).toBe(',');
  });

  it('keeps the contact import behaviour', () => {
    expect(parseCsv('name,email\n Ali , a@x.test \n\n')).toEqual({ headers: ['name', 'email'], rows: [{ name: 'Ali', email: 'a@x.test' }], totalRows: 1 });
  });
});

describe('encoding', () => {
  it('is certain about UTF-8 Arabic and suggests Windows-1256 otherwise', () => {
    expect(detectEncoding(new TextEncoder().encode('البيان'))).toEqual({ encoding: 'utf-8', certain: true });
    const cp1256 = new Uint8Array([0xc7, 0xe1, 0xc8, 0xed, 0xc7, 0xe4]);
    expect(detectEncoding(cp1256)).toEqual({ encoding: 'windows-1256', certain: false });
    expect(decodeText(cp1256, 'windows-1256')).toBe('البيان');
    expect(() => decodeText(cp1256, 'utf-8')).toThrow();
  });
});

describe('dates', () => {
  it('parses the confirmed format only, and rejects impossible dates', () => {
    expect(parseDateCell('05/10/2026', 'dd/mm/yyyy')).toBe('2026-10-05');
    expect(parseDateCell('05/10/2026', 'mm/dd/yyyy')).toBe('2026-05-10');
    expect(parseDateCell('٠٥/١٠/٢٠٢٦ 10:30', 'dd/mm/yyyy')).toBe('2026-10-05');
    expect(parseDateCell('31/02/2026', 'dd/mm/yyyy')).toBeNull();
    expect(parseDateCell('2026-10-05', 'dd/mm/yyyy')).toBeNull();
    expect(parseDateCell(46300, 'dd/mm/yyyy')).toBe(excelSerialToIso(46300));
  });

  it('suggests day-first when samples are ambiguous', () => {
    expect(suggestDateFormat(['01/10/2026', '02/10/2026'])).toEqual({ format: 'dd/mm/yyyy', ambiguous: true });
    expect(suggestDateFormat(['25/10/2026'])).toEqual({ format: 'dd/mm/yyyy', ambiguous: false });
    expect(suggestDateFormat(['10/25/2026'])).toEqual({ format: 'mm/dd/yyyy', ambiguous: false });
  });
});

describe('amounts', () => {
  const jod = (v: Parameters<typeof parseAmountCell>[0], sep: '.' | ',' = '.') => parseAmountCell(v, 'JOD', sep);
  it('reads signs, separators and Arabic digits without rounding', () => {
    expect(jod('1,250.000')).toEqual({ minor: 1250000n });
    expect(jod('-42.75')).toEqual({ minor: -42750n });
    expect(jod('(88.400)')).toEqual({ minor: -88400n });
    expect(jod('12.500-')).toEqual({ minor: -12500n });
    expect(jod('30.000 DR')).toEqual({ minor: -30000n });
    expect(jod('JOD 15 CR')).toEqual({ minor: 15000n });
    expect(jod('١٬٢٥٠٫٥')).toEqual({ minor: 1250500n });
    expect(jod('1.250,5', ',')).toEqual({ minor: 1250500n });
    expect(jod('1.2345')).toEqual({ error: 'too_many_decimals' });
    expect(jod('abc')).toEqual({ error: 'invalid' });
    expect(jod('')).toBeNull();
  });

  it('accepts spreadsheet floats but not extra precision', () => {
    expect(jod(12.499999999999998)).toEqual({ minor: 12500n });
    expect(jod(12.3456)).toEqual({ error: 'too_many_decimals' });
  });
});

describe('suggestions', () => {
  it('uses direction-aware bilingual keywords', () => {
    expect(suggestCategory('دفعة رواتب أكتوبر', -1n)).toBe('salaries_wages');
    expect(suggestCategory('Careem business rides', -1n)).toBe('transport');
    expect(suggestCategory('Taxi to client', -1n)).toBe('transport');
    expect(suggestCategory('تحصيل فاتورة رقم 1043', 1n)).toBe('sales');
    expect(suggestCategory('قسط قرض', -1n)).toBe('loan_principal');
    expect(suggestCategory('قرض', 1n)).toBe('loan_proceeds');
    expect(suggestCategory('Something unknown', -1n)).toBeNull();
  });

  it('guesses the payment channel', () => {
    expect(suggestChannel('CliQ transfer from Sara')).toBe('cliq');
    expect(suggestChannel('POS settlement')).toBe('pos_card');
    expect(suggestChannel('سحب صراف آلي')).toBe('cash');
    expect(suggestChannel('حوالة واردة')).toBe('bank_transfer');
  });

  it('guesses columns from Arabic and English headers, ignoring the balance', () => {
    expect(guessMapping(['التاريخ', 'البيان', 'رقم المرجع', 'المبلغ', 'الرصيد'])).toEqual({
      mapping: { date: 0, description: [1], reference: 2, amount: 3 }, amountMode: 'signed',
    });
    expect(guessMapping(['Value Date', 'Narrative', 'Debit', 'Credit', 'Balance']).amountMode).toBe('debit_credit');
  });
});

describe('statement', () => {
  const mapping: ColumnMapping = { header_row: 0, date: 0, description: [1], amount: 3 };
  const options: ParseOptions = { date_format: 'dd/mm/yyyy', amount_mode: 'signed', decimal_separator: '.' };
  const ctx = { currency: 'JOD' as const, today: '2026-11-19', maxRows: 20_000 };

  it('parses the Jordanian fixture into 30 dated, signed rows with file line numbers', async () => {
    const bytes = new Uint8Array(readFileSync('tests/fixtures/sme/bank_statement_jo_01.csv'));
    const file = await tableFromFile(bytes, 'csv', {}, ctx.maxRows);
    if (isFailure(file)) throw new Error(file.reason);
    expect(file.encoding).toEqual({ used: 'utf-8', detected: 'utf-8', certain: true });
    const result = buildStagedRows(file.table, file.firstRowNumber, mapping, options, ctx);
    if (isFailure(result)) throw new Error(result.reason);
    expect(result.rows).toHaveLength(30);
    expect(result.rows[0]).toMatchObject({ row_number: 2, value_date: '2026-10-01', amount_minor: '5000000', external_ref: null, suggested_category_code: 'owner_capital', issues: [] });
    expect(result.rows.reduce((s, r) => s + BigInt(r.amount_minor!), 0n)).toBe(10261700n);
    expect(result.rows[0].raw['الرصيد']).toBe('5,000.000');
  });

  it('flags bad lines instead of failing the file', () => {
    const table = [['d', 'desc', 'x', 'amt'], ['01/10/2026', 'ok', '', '1'], ['', 'Closing balance', '', ''], ['01/12/2026', 'future', '', '1'], ['02/10/2026', 'too precise', '', '1.0001']];
    const result = buildStagedRows(table, 1, mapping, options, ctx);
    if (isFailure(result)) throw new Error(result.reason);
    expect(result.rows.map(r => r.issues)).toEqual([
      [], [{ field: 'value_date', code: 'required' }, { field: 'amount', code: 'required' }],
      [{ field: 'value_date', code: 'out_of_range' }], [{ field: 'amount', code: 'too_many_decimals' }],
    ]);
  });

  it('fails the file for an unusable mapping or too many rows', () => {
    expect(buildStagedRows([['a']], 1, mapping, options, ctx)).toEqual({ code: 'PARSE_FAILED', reason: 'mapping_out_of_range' });
    const big = [['d', 'desc', 'x', 'amt'], ['01/10/2026', 'a', '', '1'], ['01/10/2026', 'b', '', '1']];
    expect(buildStagedRows(big, 1, mapping, options, { ...ctx, maxRows: 1 })).toEqual({ code: 'FILE_TOO_LARGE', reason: 'too_many_rows' });
  });

  it('uses the column for the sign in debit and credit mode', () => {
    const table = [['d', 'desc', 'debit', 'credit'], ['01/10/2026', 'a', '10', ''], ['01/10/2026', 'b', '', '5'], ['01/10/2026', 'c', '-3', '']];
    const result = buildStagedRows(table, 1, { header_row: 0, date: 0, description: [1], debit: 2, credit: 3 }, { ...options, amount_mode: 'debit_credit' }, ctx);
    if (isFailure(result)) throw new Error(result.reason);
    expect(result.rows.map(r => r.amount_minor)).toEqual(['-10000', '5000', '-3000']);
  });
});
