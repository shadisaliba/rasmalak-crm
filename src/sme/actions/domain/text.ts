/**
 * Turns an action's raw params into message values. Shared by the screen (react-intl) and the
 * worker's notifications, so both read the same. Plural counts stay numbers for ICU.
 */
const MONEY = new Set(['amount', 'buffer', 'spent', 'usual', 'total']);
const DATE = new Set(['week', 'due', 'date']);
const PLURAL = new Set(['days', 'count']);

export interface ValueFormatters {
  money(minor: string): string;
  date(iso: string): string;
  number(value: number): string;
  category(code: string): string;
}

export function actionValues(params: Record<string, unknown>, f: ValueFormatters): Record<string, string | number> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => {
    if (MONEY.has(k)) return [k, f.money(String(v))];
    if (DATE.has(k)) return [k, f.date(String(v))];
    if (PLURAL.has(k)) return [k, Number(v)];
    if (k === 'percent') return [k, f.number(Number(v))];
    if (k === 'category') return [k, f.category(String(v))];
    return [k, typeof v === 'number' ? v : String(v ?? '')];
  }));
}
