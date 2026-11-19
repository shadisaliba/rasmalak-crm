import { read, utils } from 'xlsx';
import type { Cell } from './types';

/**
 * Reads cell values only: no formulas, styles or HTML, and at most `maxRows` rows per sheet, so
 * an uploaded workbook cannot make the parser do more than read data.
 */
export function readWorkbook(bytes: Uint8Array, maxRows: number) {
  const workbook = read(bytes, { type: 'array', dense: true, cellFormula: false, cellHTML: false, cellStyles: false, cellDates: false, sheetRows: maxRows + 50 });
  return {
    sheets: workbook.SheetNames,
    table(sheet: string): { table: Cell[][]; firstRowNumber: number } | null {
      const ws = workbook.Sheets[sheet];
      if (!ws) return null;
      const start = ws['!ref'] ? utils.decode_range(ws['!ref']).s.r : 0;
      const table = utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
      return { table, firstRowNumber: start + 1 };
    },
  };
}
