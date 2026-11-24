'use client';

import { useLedgerText } from '@/sme/ledger/ui/shared';
import type { ForecastAssumption, Wire } from '../domain/types';

const MONEY_PARAMS = new Set(['amount', 'p25', 'p50', 'p75']);
const DATE_PARAMS = new Set(['date']);
// Plural selectors stay numbers (ICU localizes `#`); other numbers are formatted here, because a
// plain {placeholder} is inserted as typed, which would show Latin digits in Arabic.
const PLURAL_PARAMS = new Set(['count', 'accounts']);
const NUMBER_PARAMS = new Set(['days', 'invoices', 'weeks']);

/** Forecast text: assumption sentences with their amounts, dates and numbers in the UI locale. */
export function useForecastText() {
  const L = useLedgerText();
  const jod = (minor: string | bigint) => L.amount(minor, 'JOD');
  const params = (raw: Record<string, string | number>) => Object.fromEntries(Object.entries(raw).map(([k, v]) => {
    if (MONEY_PARAMS.has(k)) return [k, jod(String(v))];
    if (DATE_PARAMS.has(k)) return [k, L.date(String(v))];
    if (k === 'cadence') return [k, L.t(`forecast.cadence.${v}`)];
    if (k === 'pct' || k === 'rate') return [k, L.decimal(String(v))];
    if (PLURAL_PARAMS.has(k)) return [k, Number(v)];
    if (NUMBER_PARAMS.has(k)) return [k, L.number(Number(v))];
    return [k, v];
  }));
  return {
    ...L,
    jod,
    assumption: (a: Wire<ForecastAssumption>) => L.t(`forecast.assumption.${a.key}`, params(a.params)),
  };
}
