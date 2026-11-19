import { detectDelimiter, parseCsvTable } from '@/crm/migration/csvParser';
import { decodeText, detectEncoding } from './decode';
import type { Cell, FileKind, ParseFailure, ParseOptions, TextEncodingName } from './types';

export interface FileTable {
  table: Cell[][];
  /** Line (CSV) or sheet row (XLSX) number of table[0], 1-based. */
  firstRowNumber: number;
  encoding?: { used: TextEncodingName; detected: TextEncodingName; certain: boolean };
  delimiter?: ',' | ';' | '\t';
  sheets?: string[];
  sheet?: string;
}

export function fileKindOf(fileName: string): FileKind | null {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.csv') ? 'csv' : lower.endsWith('.xlsx') ? 'xlsx' : null;
}

/** The file as a table of cells. Shared by the browser preview and the parsing worker. */
export async function tableFromFile(
  bytes: Uint8Array, kind: FileKind, options: Partial<ParseOptions>, maxRows: number,
): Promise<FileTable | ParseFailure> {
  if (kind === 'csv') {
    const detected = detectEncoding(bytes);
    const used = options.encoding ?? detected.encoding;
    let text: string;
    try {
      text = decodeText(bytes, used);
    } catch {
      return { code: 'PARSE_FAILED', reason: 'encoding' };
    }
    const delimiter = options.delimiter ?? detectDelimiter(text);
    return { table: parseCsvTable(text, delimiter), firstRowNumber: 1, encoding: { used, detected: detected.encoding, certain: detected.certain }, delimiter };
  }
  const { readWorkbook } = await import('./xlsx');
  let workbook: ReturnType<typeof readWorkbook>;
  try {
    workbook = readWorkbook(bytes, maxRows);
  } catch {
    return { code: 'PARSE_FAILED', reason: 'unreadable_workbook' };
  }
  const sheet = options.sheet ?? workbook.sheets[0];
  const result = sheet ? workbook.table(sheet) : null;
  if (!result) return { code: 'PARSE_FAILED', reason: 'sheet_not_found' };
  return { ...result, sheets: workbook.sheets, sheet };
}

export function isFailure(value: unknown): value is ParseFailure {
  return typeof value === 'object' && value !== null && 'code' in value && 'reason' in value;
}
