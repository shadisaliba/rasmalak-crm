export const DATE_FORMATS = ['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd', 'dd-mm-yyyy', 'dd.mm.yyyy', 'dd/mm/yy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export type AmountMode = 'signed' | 'debit_credit';
export type DecimalSeparator = '.' | ',';
export type TextEncodingName = 'utf-8' | 'windows-1256';
export type FileKind = 'csv' | 'xlsx';

/** Column indexes in the file (0-based); the header row is a record index. */
export interface ColumnMapping {
  header_row: number;
  date: number;
  description: number[];
  amount?: number;
  debit?: number;
  credit?: number;
  reference?: number;
}

export interface ParseOptions {
  date_format: DateFormat;
  amount_mode: AmountMode;
  decimal_separator: DecimalSeparator;
  encoding?: TextEncodingName;
  delimiter?: ',' | ';' | '\t';
  sheet?: string;
}

export type Cell = string | number | boolean | null;

export interface RowIssue {
  field: 'value_date' | 'amount' | 'description' | 'fx';
  code: string;
}

/** One statement line as staged for review (sme_import_rows). */
export interface StagedRow {
  row_number: number;
  raw: Record<string, string>;
  value_date: string | null;
  amount_minor: string | null;
  description: string;
  external_ref: string | null;
  suggested_category_code: string | null;
  channel: string;
  issues: RowIssue[];
}

export type ParseFailure = { code: 'PARSE_FAILED' | 'FILE_TOO_LARGE'; reason: string };
