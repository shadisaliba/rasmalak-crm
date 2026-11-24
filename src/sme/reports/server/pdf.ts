import 'server-only';
import { ReportDocument, AVAIL_H } from '../writers/pdf/builder';
import { CONTENT_W, MARGIN_X, drawTable, type TableColumn, type TableRow } from '../writers/pdf/layout';
import { displayValue, type ReportDoc } from '../domain/render';

const ROW_H = 15;
const FONT = 8;
const HEADING_H = 22;
const MAX_CELL = 60;

/**
 * PDF with the ported writer and its Arabic shaper: letters join, Arabic-Indic digits, columns
 * right to left in Arabic. Provenance first, then each section, paginated.
 */
export function toPdf(doc: ReportDoc): Buffer {
  const pdf = new ReportDocument({ locale: doc.locale, currencySymbol: '' });
  const blocks: Array<{ heading?: string; columns: TableColumn[]; rows: TableRow[] }> = [];

  const half = CONTENT_W / 3;
  blocks.push({
    columns: [{ label: '', width: half }, { label: '', width: CONTENT_W - half }],
    rows: doc.provenance.map((p, i) => ({ cells: [p.label, p.value.slice(0, 120)], altFill: i % 2 === 1 })),
  });
  for (const s of doc.sections) {
    const weights = s.columns.map(c => (c.kind === 'text' ? 2.2 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const columns: TableColumn[] = s.columns.map((c, i) => ({
      label: c.label, width: (CONTENT_W * weights[i]) / total, align: c.kind === 'text' ? undefined : (doc.locale === 'ar' ? 'left' : 'right'),
    }));
    const rows: TableRow[] = s.rows.map((r, i) => ({
      cells: s.columns.map(c => displayValue(r[c.key] ?? null, c.kind, doc.locale).slice(0, MAX_CELL)),
      altFill: i % 2 === 1,
    }));
    blocks.push({ heading: s.note ? `${s.title} · ${s.note}` : s.title, columns, rows: rows.length ? rows : [{ cells: s.columns.map(() => '') }] });
  }

  // Lay blocks out page by page; a long table continues on the next page with its header again.
  const pages: Array<Array<{ heading?: string; columns: TableColumn[]; rows: TableRow[] }>> = [[]];
  let room = AVAIL_H - 60;
  for (const b of blocks) {
    let rest = b.rows;
    let first = true;
    while (rest.length) {
      const need = (b.heading && first ? HEADING_H : 0) + ROW_H * 2;
      if (room < need) { pages.push([]); room = AVAIL_H - 40; }
      const fit = Math.max(1, Math.floor((room - (b.heading && first ? HEADING_H : 0) - ROW_H) / ROW_H));
      pages[pages.length - 1].push({ heading: first ? b.heading : undefined, columns: b.columns, rows: rest.slice(0, fit) });
      room -= (b.heading && first ? HEADING_H : 0) + ROW_H * (Math.min(fit, rest.length) + 1) + 8;
      rest = rest.slice(fit);
      first = false;
    }
  }

  pages.forEach((page, p) => {
    const ctx = pdf.newPage(p === 0);
    if (p === 0) pdf.drawPageHeader(ctx, doc.title, doc.subtitle);
    for (const part of page) {
      if (part.heading) pdf.drawSectionHeading(ctx, part.heading);
      const headerRow: TableRow = { cells: part.columns.map(c => c.label), isHeader: true };
      const withHeader = part.columns.every(c => c.label === '') ? part.rows : [headerRow, ...part.rows];
      const bottom = drawTable(ctx, MARGIN_X, ctx.y, part.columns, withHeader, { fontSize: FONT, rowHeight: ROW_H });
      ctx.advanceY(bottom - ctx.y + 8);
    }
    pdf.finalizePage(ctx, p + 1, pages.length);
  });
  return pdf.build();
}
