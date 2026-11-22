import 'server-only';
import { ReportDocument, AVAIL_H } from '@/sme/reports/writers/pdf/builder';
import { CONTENT_W, MARGIN_X, drawTable, type TableRow } from '@/sme/reports/writers/pdf/layout';

const ROW_H = 18;
const FONT = 10;
// The table writer does not wrap, so long items are split by an approximate character budget.
const CHARS_PER_LINE = 130;
const ROWS_PER_PAGE = Math.floor((AVAIL_H - 70) / ROW_H);

function wrap(text: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > CHARS_PER_LINE) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** LRN-02: a printable checklist of a lesson's checkpoint items and actions. */
export function checklistPdf(options: { title: string; subtitle: string; doneLabel: string; itemLabel: string; items: string[]; isArabic: boolean }): Buffer {
  const doc = new ReportDocument({ locale: options.isArabic ? 'ar' : 'en', currencySymbol: '' });
  const rows: TableRow[] = options.items.flatMap((item, n) =>
    wrap(item).map((line, i) => ({ cells: [i === 0 ? String(n + 1) : '', line, ''], altFill: n % 2 === 1 })));
  const pages: TableRow[][] = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += ROWS_PER_PAGE) pages.push(rows.slice(i, i + ROWS_PER_PAGE));
  const columns = [
    { label: '#', width: 30, align: 'center' as const },
    { label: options.itemLabel, width: CONTENT_W - 30 - 60 },
    { label: options.doneLabel, width: 60, align: 'center' as const },
  ];
  pages.forEach((pageRows, p) => {
    const ctx = doc.newPage(p === 0);
    doc.drawPageHeader(ctx, options.title, options.subtitle);
    drawTable(ctx, MARGIN_X, ctx.y, columns, [{ cells: columns.map(c => c.label), isHeader: true }, ...pageRows], { fontSize: FONT, rowHeight: ROW_H });
    doc.finalizePage(ctx, p + 1, pages.length);
  });
  return doc.build();
}
