'use client';

import { useEffect, useState } from 'react';
import { smeApi } from '@/sme/api/client';
import { isCurrencyCode } from '@/sme/money';
import type { FxQuote } from '@/sme/money/fx';
import { FX_RATE_PATTERN, toBaseMinor } from '../domain/fx';
import { FX_SOURCE_LABEL_KEYS, Field, asciiDecimal, formGrid, input, muted, useLedgerText } from './shared';

export interface FxValue {
  rate: string;
  rate_date: string;
  source: 'aggregator:open.er-api.com' | 'manual';
  reason?: string;
}

interface FxFieldsProps {
  orgId: string;
  currency: string;
  /** Value date of the entry; the stored rate on or before it is offered. */
  date: string;
  amountMinor: bigint | null;
  onChange: (value: FxValue | null) => void;
}

/**
 * Rate for a foreign-currency entry. Offers the stored market rate with its real source and
 * date; the user can override it with a reason, which is recorded with the posting.
 */
export function FxFields({ orgId, currency, date, amountMinor, onChange }: FxFieldsProps) {
  const L = useLedgerText();
  const [quote, setQuote] = useState<{ for: string; value: FxQuote | null } | null>(null);
  const [override, setOverride] = useState(false);
  const [manualRate, setManualRate] = useState('');
  const [reason, setReason] = useState('');
  const quoteKey = `${currency}|${date}`;

  useEffect(() => {
    if (!date || currency === 'JOD') return;
    let ignore = false;
    smeApi<{ quote: FxQuote | null }>(`fx/quote?currency=${encodeURIComponent(currency)}&date=${encodeURIComponent(date)}`, { orgId })
      .then(r => { if (!ignore) setQuote({ for: `${currency}|${date}`, value: r.ok ? r.data.quote : null }); });
    return () => { ignore = true; };
  }, [orgId, currency, date]);

  const current = quote?.for === quoteKey ? quote.value : null;
  const loading = quote?.for !== quoteKey;
  const manual = override || (!loading && !current);
  const rate = manual ? manualRate : current?.rate ?? '';
  const rateValid = FX_RATE_PATTERN.test(rate) && Number(rate) > 0;

  useEffect(() => {
    if (manual) {
      onChange(rateValid && reason.trim() ? { rate, rate_date: date, source: 'manual', reason: reason.trim() } : null);
    } else if (current) {
      onChange({ rate: current.rate, rate_date: current.rateDate, source: 'aggregator:open.er-api.com' });
    } else {
      onChange(null);
    }
    // onChange is a setter from the parent; listing it would re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, rate, rateValid, reason, date, current]);

  if (currency === 'JOD') return null;
  const preview = rateValid && amountMinor !== null && isCurrencyCode(currency) ? toBaseMinor(amountMinor, currency, rate) : null;

  return (
    <fieldset style={{ border: '1px dashed var(--ds-border)', borderRadius: '10px', padding: '10px 12px', margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <legend style={{ fontSize: '13px', fontWeight: 500, padding: '0 4px', color: 'var(--ds-text-heading)' }}>{L.t('sme.fx.title', { currency })}</legend>
      {loading ? (
        <p style={muted}>{L.t('common.loading')}</p>
      ) : current && !override ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--ds-text-body)' }}>
          {L.t('sme.fx.quote', { one: 1, currency, rate: L.decimal(current.rate), date: L.date(current.rateDate), source: L.t(FX_SOURCE_LABEL_KEYS[current.source]) })}
          {current.stale && <span style={{ display: 'block', ...muted }}>{L.t('sme.fx.staleQuote')}</span>}
        </p>
      ) : !current ? (
        <p style={muted}>{L.t('sme.fx.noQuote')}</p>
      ) : null}
      {current && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--ds-text-body)' }}>
          <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
          {L.t('sme.fx.override')}
        </label>
      )}
      {manual && (
        <div style={formGrid}>
          <Field text={L.t('sme.fx.rate', { one: 1, currency })}>
            <input value={manualRate} inputMode="decimal" dir="ltr" onChange={e => setManualRate(asciiDecimal(e.target.value))} style={input} />
          </Field>
          <Field text={L.t('sme.fx.reason')}>
            <input value={reason} onChange={e => setReason(e.target.value)} style={input} />
          </Field>
        </div>
      )}
      {preview !== null && <p style={muted}>{L.t('sme.fx.preview', { amount: L.amount(preview, 'JOD') })}</p>}
    </fieldset>
  );
}
