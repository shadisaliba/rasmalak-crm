/**
 * CSV Parser
 * ==========
 * RFC 4180 parsing (quoted fields, doubled quotes, delimiters and newlines inside quotes, CRLF)
 * with a configurable delimiter. Used by the CRM contact import and the SME statement import.
 */

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

export type CsvDelimiter = ',' | ';' | '\t';

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parses CSV text into records of raw (untrimmed) fields. Every record is kept, including blank
 * lines (as `['']`), so record numbers match the file for provenance.
 */
export function parseCsvTable(text: string, delimiter: CsvDelimiter = ','): string[][] {
  const input = stripBom(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += char;
      }
      i++;
      continue;
    }
    if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === delimiter) {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      if (char === '\r' && input[i + 1] === '\n') i++;
    } else {
      field += char;
    }
    i++;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** The delimiter that splits the first lines most consistently into more than one field. */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = stripBom(text).split(/\r?\n/).filter(l => l.trim()).slice(0, 10).join('\n');
  let best: CsvDelimiter = ',';
  let bestScore = 0;
  for (const candidate of [',', ';', '\t'] as const) {
    const counts = parseCsvTable(sample, candidate).map(r => r.length);
    if (!counts.length) continue;
    const width = counts[0];
    const consistent = counts.filter(c => c === width).length;
    const score = width > 1 ? consistent * width : 0;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Parse a CSV string into headers and row objects (CRM contact import). Blank lines are skipped
 * and values trimmed.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter = ','): CsvParseResult {
  const records = parseCsvTable(text, delimiter).filter(r => !(r.length === 1 && r[0].trim() === ''));
  if (records.length === 0) return { headers: [], rows: [], totalRows: 0 };

  const headers = records[0].map(h => h.trim());
  const rows: Record<string, string>[] = records.slice(1).map(values => {
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = (values[j] ?? '').trim();
    return row;
  });
  return { headers, rows, totalRows: rows.length };
}

/**
 * Read a File object as text.
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
