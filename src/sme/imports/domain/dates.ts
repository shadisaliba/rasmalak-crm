import { DATE_FORMATS, type Cell, type DateFormat } from './types';

const PATTERNS: Record<DateFormat, { re: RegExp; order: ['d' | 'm' | 'y', 'd' | 'm' | 'y', 'd' | 'm' | 'y'] }> = {
  'dd/mm/yyyy': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['d', 'm', 'y'] },
  'mm/dd/yyyy': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['m', 'd', 'y'] },
  'yyyy-mm-dd': { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ['y', 'm', 'd'] },
  'dd-mm-yyyy': { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: ['d', 'm', 'y'] },
  'dd.mm.yyyy': { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ['d', 'm', 'y'] },
  'dd/mm/yy': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, order: ['d', 'm', 'y'] },
};

function asciiDigits(text: string): string {
  return text.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Excel serial day (1900 date system) to ISO date. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** A statement date in the confirmed format, as YYYY-MM-DD, or null. A time part is ignored. */
export function parseDateCell(value: Cell, format: DateFormat): string | null {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return excelSerialToIso(value);
  const text = asciiDigits(String(value)).trim().split(/[ T]/)[0];
  const { re, order } = PATTERNS[format];
  const match = re.exec(text);
  if (!match) return null;
  const parts: Record<'d' | 'm' | 'y', number> = { d: 0, m: 0, y: 0 };
  order.forEach((key, i) => { parts[key] = Number(match[i + 1]); });
  if (format === 'dd/mm/yy') parts.y += 2000;
  return iso(parts.y, parts.m, parts.d);
}

/**
 * The formats every sample satisfies, best first. Day-first wins a tie because Jordanian banks
 * use it; the user still confirms.
 */
export function suggestDateFormat(samples: Cell[]): { format: DateFormat; ambiguous: boolean } | null {
  const values = samples.filter(v => v !== null && v !== '');
  if (!values.length) return null;
  if (values.every(v => typeof v === 'number')) return { format: 'dd/mm/yyyy', ambiguous: false };
  const fits = DATE_FORMATS.filter(f => values.every(v => parseDateCell(v, f) !== null));
  if (!fits.length) return null;
  return { format: fits[0], ambiguous: fits.includes('dd/mm/yyyy') && fits.includes('mm/dd/yyyy') };
}

export function addYears(isoDate: string, years: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}
