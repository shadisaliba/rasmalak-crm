import { XlsxWorkbook, bold, cell, header } from '../writers/xlsx/builder';
import type { Cell } from '../writers/xlsx/xml';

/**
 * Report model and its three renderings (W3a-10, FIN-06). Values arrive raw (minor units, ISO
 * dates, decimal strings); each writer formats them for its medium. PDF rendering lives in
 * ../server/pdf.ts because the font loader reads files.
 */
export type ReportCode = 'cash_summary' | 'income_expense' | 'receivables_ageing' | 'payables_due' | 'transactions';
export const REPORT_CODES: readonly ReportCode[] = ['cash_summary', 'income_expense', 'receivables_ageing', 'payables_due', 'transactions'];
export type ReportFormat = 'csv' | 'xlsx' | 'pdf';

export type ColumnKind = 'text' | 'money' | 'date' | 'count' | 'percent';
export interface ReportColumn { key: string; label: string; kind: ColumnKind }
export type ReportRow = Record<string, string | null>;
export interface ReportSection { title: string; note?: string; columns: ReportColumn[]; rows: ReportRow[] }

export interface ReportDoc {
  code: ReportCode;
  locale: 'ar' | 'en';
  title: string;
  subtitle: string;
  /** Who, what period, when, as of, versions, filters, rows, data quality, and the disclaimer. */
  provenance: Array<{ label: string; value: string }>;
  sections: ReportSection[];
}

export function rowCount(doc: ReportDoc): number {
  return doc.sections.reduce((n, s) => n + s.rows.length, 0);
}

/** JOD minor units as a plain decimal string, e.g. "1234.500"; for files, not for display. */
export function minorToDecimal(minor: string): string {
  const negative = minor.startsWith('-');
  const digits = (negative ? minor.slice(1) : minor).padStart(4, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -3).replace(/^0+(?=\d)/, '')}.${digits.slice(-3)}`;
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function arabicDigits(text: string): string {
  return text.replace(/\d/g, d => AR_DIGITS[Number(d)]).replace(/\./g, '٫').replace(/,/g, '٬');
}

/** A value as people read it in the report's language (PDF and the screen). */
export function displayValue(value: string | null, kind: ColumnKind, locale: 'ar' | 'en'): string {
  if (value === null || value === '') return '';
  let text: string;
  switch (kind) {
    case 'money': {
      const [int, frac] = minorToDecimal(value).split('.');
      text = `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
      break;
    }
    case 'date': text = value.slice(0, 10).split('-').reverse().join('/'); break;
    case 'percent': text = `${value}%`; break;
    default: text = value;
  }
  return locale === 'ar' && kind !== 'text' ? arabicDigits(text).replace('%', '٪') : text;
}

const csvField = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV with a UTF-8 BOM, so Excel opens Arabic correctly. Numbers stay machine-readable. */
export function toCsv(doc: ReportDoc): Buffer {
  const lines: string[] = [csvField(doc.title)];
  for (const p of doc.provenance) lines.push([p.label, p.value].map(csvField).join(','));
  for (const s of doc.sections) {
    lines.push('', csvField(s.title));
    if (s.note) lines.push(csvField(s.note));
    lines.push(s.columns.map(c => csvField(c.label)).join(','));
    for (const r of s.rows) {
      lines.push(s.columns.map(c => {
        const v = r[c.key];
        if (v === null || v === undefined) return '';
        return csvField(c.kind === 'money' ? minorToDecimal(v) : v);
      }).join(','));
    }
  }
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')]);
}

/** XLSX: an "About" sheet with the provenance, then one sheet per section, right to left in Arabic. */
export function toXlsx(doc: ReportDoc): Buffer {
  const wb = new XlsxWorkbook();
  const rtl = doc.locale === 'ar';
  const about = wb.addSheet(doc.locale === 'ar' ? 'حول التقرير' : 'About', { rtl });
  about.addRow([bold(doc.title)]).addRow([cell(doc.subtitle)]).addBlank();
  for (const p of doc.provenance) about.addRow([bold(p.label), cell(p.value)]);
  about.setColWidths([{ col: 1, width: 28 }, { col: 2, width: 70 }]);

  const used = new Set<string>();
  doc.sections.forEach((s, i) => {
    // Sheet names: at most 31 characters, unique, without []:*?/\
    let name = s.title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 28).trim() || `Sheet ${i + 1}`;
    while (used.has(name)) name = `${name.slice(0, 26)} ${i + 1}`;
    used.add(name);
    const sheet = wb.addSheet(name, { rtl });
    if (s.note) sheet.addRow([cell(s.note)]).addBlank();
    sheet.addRow(s.columns.map(c => header(c.label)));
    for (const r of s.rows) {
      sheet.addRow(s.columns.map((c): Cell => {
        const v = r[c.key];
        if (v === null || v === undefined || v === '') return cell(null);
        if (c.kind === 'money') return { v: Number(minorToDecimal(v)), s: 7 };
        if (c.kind === 'count') return { v: Number(v), s: 3 };
        if (c.kind === 'percent') return { v: Number(v) / 100, s: 4 };
        return cell(v);
      }));
    }
    sheet.setColWidths(s.columns.map((c, n) => ({ col: n + 1, width: c.kind === 'text' ? 30 : 16 })));
  });
  return wb.build();
}
