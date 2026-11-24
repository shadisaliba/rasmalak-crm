import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { shapeArabic } from '../writers/pdf/arabic';
import { toPdf } from '../server/pdf';
import { displayValue, minorToDecimal, toCsv, toXlsx, type ReportDoc } from './render';

const doc = (locale: 'ar' | 'en'): ReportDoc => ({
  code: 'receivables_ageing', locale,
  title: locale === 'ar' ? 'أعمار الذمم المدينة' : 'Receivables ageing',
  subtitle: 'Org A',
  provenance: [
    { label: locale === 'ar' ? 'المنشأة' : 'Organization', value: 'شركة أ للتجارة' },
    { label: 'Note', value: 'Management report. Not a statutory financial statement.' },
  ],
  sections: [{
    title: locale === 'ar' ? 'الفواتير المفتوحة' : 'Open invoices',
    columns: [
      { key: 'number', label: '#', kind: 'text' },
      { key: 'customer', label: locale === 'ar' ? 'العميل' : 'Customer', kind: 'text' },
      { key: 'due', label: 'Due', kind: 'date' },
      { key: 'outstanding', label: 'Outstanding', kind: 'money' },
    ],
    rows: [
      { number: 'INV-1', customer: 'النور, للتجارة', due: '2026-11-14', outstanding: '1234500' },
      { number: 'INV-2', customer: 'Zaid "Bakery"', due: '2026-12-01', outstanding: '-5' },
    ],
  }],
});

describe('values', () => {
  it('writes JOD minor units as exact three-decimal strings', () => {
    expect(['1234500', '5', '-5', '0', '1000'].map(minorToDecimal)).toEqual(['1234.500', '0.005', '-0.005', '0.000', '1.000']);
  });

  it('shows Arabic-Indic digits and separators in Arabic, Western ones in English', () => {
    expect(displayValue('1234500', 'money', 'en')).toBe('1,234.500');
    expect(displayValue('1234500', 'money', 'ar')).toBe('١٬٢٣٤٫٥٠٠');
    expect(displayValue('2026-11-14', 'date', 'ar')).toBe('١٤/١١/٢٠٢٦');
    expect(displayValue('12.5', 'percent', 'ar')).toBe('١٢٫٥٪');
    expect(displayValue('النور', 'text', 'ar')).toBe('النور');
  });
});

describe('CSV', () => {
  it('starts with a UTF-8 BOM, carries the provenance, and quotes commas and quotes', () => {
    const buf = toCsv(doc('ar'));
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.subarray(3).toString('utf8');
    expect(text).toContain('Management report. Not a statutory financial statement.');
    expect(text).toContain('INV-1,"النور, للتجارة",2026-11-14,1234.500');
    expect(text).toContain('INV-2,"Zaid ""Bakery""",2026-12-01,-0.005');
  });
});

describe('XLSX', () => {
  it('is a zip with an About sheet and amounts as three-decimal numbers', () => {
    const buf = toXlsx(doc('en'));
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    // The writer stores entries deflated; find the first sheet's XML in the archive.
    const files = readZip(buf);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']));
    expect(files['xl/worksheets/sheet2.xml']).toContain('<c r="D2" t="n" s="7"><v>1234.5</v></c>');
    expect(files['xl/sharedStrings.xml']).toContain('Management report. Not a statutory financial statement.');
  });
});

describe('PDF (W3a-10 acceptance: Arabic renders joined, with Arabic-Indic numerals)', () => {
  it('builds a PDF for each language', () => {
    for (const locale of ['ar', 'en'] as const) {
      const pdf = toPdf(doc(locale));
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    }
  });

  it('joins Arabic letters into their contextual forms, as the ported shaper tests require', () => {
    // "العميل": every letter becomes a presentation form (U+FE70–U+FEFF), none left isolated in
    // its base form, and the glyph order is reversed for right-to-left drawing.
    const shaped = shapeArabic('العميل');
    expect(shaped.every(cp => cp >= 0xfe70 && cp <= 0xfeff)).toBe(true);
    expect(shaped).toMatchInlineSnapshot(`
      [
        65246,
        65268,
        65252,
        65228,
        65247,
        65165,
      ]
    `);
    // Digits in Arabic cells are Arabic-Indic before shaping, so the PDF shows ١٢٣٤ not 1234.
    expect(shapeArabic(displayValue('1234500', 'money', 'ar')).filter(cp => cp >= 0x0660 && cp <= 0x0669)).toHaveLength(7);
  });
});

/** Minimal zip reader for the writer's own output (stored or deflated entries). */
function readZip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString();
    const data = buf.subarray(i + 30 + nameLen + extraLen, i + 30 + nameLen + extraLen + size);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    i += 30 + nameLen + extraLen + size;
  }
  return out;
}
