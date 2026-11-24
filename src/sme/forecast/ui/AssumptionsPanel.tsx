'use client';

import Link from 'next/link';
import { Chip, card, muted, secondaryButton } from '@/sme/ledger/ui/shared';
import type { DetectedSeriesSummary, ForecastAssumption, ForecastResult, Wire } from '../domain/types';
import { useForecastText } from './text';

const heading: React.CSSProperties = { fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' };
const small: React.CSSProperties = { ...secondaryButton, padding: '3px 9px', fontSize: '12px' };

export function AssumptionsPanel({ result, canChange, onEdit }: {
  result: Wire<ForecastResult>;
  canChange: boolean;
  onEdit: (handle: NonNullable<ForecastAssumption['handle']>) => void;
}) {
  const F = useForecastText();
  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }} aria-labelledby="forecast-assumptions" id="assumptions">
      <h2 id="forecast-assumptions" style={heading}>{F.t('forecast.assumptions.title')}</h2>
      <p style={muted}>{F.t('forecast.assumptions.description')}</p>
      <ul data-testid="forecast-assumptions" style={{ margin: 0, paddingInlineStart: '18px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--ds-text-body)' }}>
        {result.assumptions.map(a => (
          <li key={a.id} data-assumption={a.key}>
            <span>{F.assumption(a)}</span>
            {canChange && a.handle && (
              <button type="button" style={{ ...small, marginInlineStart: '8px' }} onClick={() => onEdit(a.handle!)}>{F.t('forecast.assumptions.edit')}</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DetectedSeriesPanel({ series, canChange, busy, onDismiss, onKeep }: {
  series: Array<Wire<DetectedSeriesSummary>>;
  canChange: boolean;
  busy: boolean;
  onDismiss: (key: string, dismiss: boolean) => void;
  onKeep: (s: Wire<DetectedSeriesSummary>) => void;
}) {
  const F = useForecastText();
  if (!series.length) return null;
  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }} aria-labelledby="forecast-detected">
      <h2 id="forecast-detected" style={heading}>{F.t('forecast.detected.title')}</h2>
      <p style={muted}>{F.t('forecast.detected.description')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {series.map(s => (
          <li key={s.key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', fontSize: '13px' }}>
            <span style={{ flex: '1 1 160px', overflowWrap: 'anywhere', color: 'var(--ds-text-body)' }}>
              {s.label} · {s.direction === 'in' ? '+' : '−'}{F.jod(s.amountMinor)} {F.t(`forecast.cadence.${s.cadence}`)}
            </span>
            <span style={muted}>{F.t('forecast.detected.next', { date: F.date(s.nextDate) })}</span>
            <Chip tone={s.status === 'included' ? 'info' : 'neutral'}>{F.t(`forecast.detected.status.${s.status}`)}</Chip>
            {canChange && s.status === 'included' && (
              <>
                {s.cadence !== 'biweekly' && <button type="button" style={small} disabled={busy} onClick={() => onKeep(s)}>{F.t('forecast.detected.keep')}</button>}
                <button type="button" style={small} disabled={busy} onClick={() => onDismiss(s.key, true)}>{F.t('forecast.detected.remove')}</button>
              </>
            )}
            {canChange && s.status === 'dismissed' && (
              <button type="button" style={small} disabled={busy} onClick={() => onDismiss(s.key, false)}>{F.t('forecast.detected.restore')}</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function UncertainPanel({ result }: { result: Wire<ForecastResult> }) {
  const F = useForecastText();
  if (!result.uncertainReceivables.length) return null;
  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} aria-labelledby="forecast-uncertain">
      <h2 id="forecast-uncertain" style={heading}>{F.t('forecast.uncertain.title')}</h2>
      <p style={muted}>{F.t('forecast.uncertain.description')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
        {result.uncertainReceivables.map(r => (
          <li key={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', alignItems: 'center' }}>
            <Link href={`/crm/money/receivables/${r.id}`} style={{ color: 'var(--ds-primary)' }}>{r.number}</Link>
            <span style={{ flex: '1 1 120px' }}>{r.partyName}</span>
            <span style={muted}>{F.t('forecast.uncertain.overdue', { days: F.number(r.daysOverdue) })}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{F.jod(r.outstandingMinor)}</span>
            {r.included && <Chip tone="info">{F.t('forecast.source.scenario')}</Chip>}
          </li>
        ))}
      </ul>
    </section>
  );
}
