'use client';

import { INTL_LOCALE, formatMoney, isCurrencyCode, money, parseMajor, toMajorString, MoneyError } from '@/sme/money';
import { asciiDecimal, useLedgerText } from '@/sme/ledger/ui/shared';
import type { FieldSpec, ResultValue } from '../core/types';

/** Locale-aware text and formatting for the calculator screens. */
export function useCalcText() {
  const L = useLedgerText();
  const nf = (options: Intl.NumberFormatOptions) => new Intl.NumberFormat(INTL_LOCALE[L.uiLocale], options);
  const exact = (value: string, maxFraction = 2) => nf({ maximumFractionDigits: maxFraction }).format(value as Intl.StringNumericLiteral);

  const value = (v: ResultValue): string => {
    switch (v.kind) {
      case 'money': return isCurrencyCode(v.currency) ? formatMoney(money(BigInt(v.minor), v.currency), L.uiLocale) : `${v.minor} ${v.currency}`;
      // Display only; the exact decimal is in the record.
      case 'percent': return nf({ style: 'percent', maximumFractionDigits: 2 }).format(Number(v.value) / 100);
      case 'ratio': return exact(v.value, 2);
      case 'count': return exact(v.value, 0);
      case 'days': return L.t('tools.value.days', { value: exact(v.value, 1) });
      case 'hours': return L.t('tools.value.hours', { value: exact(v.value, 2) });
      case 'date': return L.date(v.value);
      case 'text': return tv(v.textKey, v.values);
      case 'none': return L.t(v.reasonKey);
    }
  };

  // Numbers and dates inside calculator sentences arrive as plain strings; show them in the UI's locale.
  const local = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? exact(v, 10) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? L.date(v) : v);
  const tv = (id: string, values?: Record<string, string>) =>
    L.t(id, values && Object.fromEntries(Object.entries(values).map(([k, v]) => [k, local(v)])));

  return { ...L, value, exact, tv };
}

export type RawValues = Record<string, string | Record<string, string>[]>;

/** Wire value (minor units for money) to the text shown in an input. */
export function wireToText(field: FieldSpec, wire: unknown, currency: string): string | Record<string, string>[] {
  if (field.kind === 'items') {
    if (!Array.isArray(wire)) return [];
    return wire.map(item => Object.fromEntries(field.itemFields.map(f => [f.key, wireToText(f, (item as Record<string, unknown>)?.[f.key], currency) as string])));
  }
  if (typeof wire !== 'string') return '';
  if (field.kind === 'money' && isCurrencyCode(currency) && /^-?\d+$/.test(wire)) return toMajorString(money(BigInt(wire), currency));
  return wire;
}

export type FieldErrors = Record<string, string>;

/** Text in the inputs to the wire format the calculator validates. Money is parsed exactly. */
export function textToWire(fields: FieldSpec[], raw: RawValues, currency: string): { input: Record<string, unknown>; errors: FieldErrors } {
  const input: Record<string, unknown> = { currency };
  const errors: FieldErrors = {};
  const convert = (field: FieldSpec, text: string, path: string): string | undefined => {
    const trimmed = text.trim();
    if (trimmed === '') return undefined;
    if (field.kind === 'money') {
      if (!isCurrencyCode(currency)) return trimmed;
      try {
        return parseMajor(trimmed, currency).minor.toString();
      } catch (err) {
        errors[path] = err instanceof MoneyError && err.code === 'TOO_MANY_DECIMALS' ? 'tools.error.too_many_decimals' : 'tools.error.not_an_amount';
        return undefined;
      }
    }
    if (field.kind === 'percent' || field.kind === 'number') return asciiDecimal(trimmed).replace(/[,٬]/g, '');
    return trimmed;
  };
  for (const field of fields) {
    const value = raw[field.key];
    if (field.kind === 'items') {
      const items = Array.isArray(value) ? value : [];
      input[field.key] = items.map((item, n) => {
        const out: Record<string, string> = {};
        for (const sub of field.itemFields) {
          const v = convert(sub, item[sub.key] ?? '', `${field.key}.${n}.${sub.key}`);
          if (v !== undefined) out[sub.key] = v;
        }
        return out;
      });
      continue;
    }
    const v = convert(field, typeof value === 'string' ? value : '', field.key);
    if (v !== undefined) input[field.key] = v;
    else if (!field.optional && !errors[field.key]) errors[field.key] = 'tools.error.required';
  }
  return { input, errors };
}
