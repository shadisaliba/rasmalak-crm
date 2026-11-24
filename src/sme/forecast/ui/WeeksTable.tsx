'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { Chip, card, muted, secondaryButton } from '@/sme/ledger/ui/shared';
import type { ForecastLine, ForecastResult, Wire } from '../domain/types';
import { useForecastText } from './text';

const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--ds-border)', textAlign: 'end', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

function lineHref(l: Wire<ForecastLine>): string | null {
  if (!l.refId) return null;
  if (l.source === 'receivable') return `/crm/money/receivables/${l.refId}`;
  if (l.source === 'payable') return `/crm/money/payables/${l.refId}`;
  return null;
}

/** Every week's figures, and the lines behind them (R4 drill-down). */
export function WeeksTable({ result, open, onToggle }: { result: Wire<ForecastResult>; open: number | null; onToggle: (index: number) => void }) {
  const F = useForecastText();
  const [hover, setHover] = useState<number | null>(null);
  const shortfall = (minor: string) => BigInt(minor) < 0n;

  return (
    <section style={{ ...card, padding: 0, overflowX: 'auto', position: 'relative' }} aria-labelledby="forecast-weeks">
      <h2 id="forecast-weeks" style={{ fontSize: '15px', fontWeight: 600, margin: 0, padding: '14px 16px 6px', color: 'var(--ds-text-heading)' }}>{F.t('forecast.chart.title')}</h2>
      <table data-testid="forecast-weeks" style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px', color: 'var(--ds-text-body)' }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: 'start' }}>{F.t('forecast.table.week')}</th>
            <th style={cell}>{F.t('forecast.table.opening')}</th>
            <th style={cell}>{F.t('forecast.table.in')}</th>
            <th style={cell}>{F.t('forecast.table.out')}</th>
            <th style={cell}>{F.t('forecast.table.closing')}</th>
            {result.variableSpend && <th style={cell}>{F.t('forecast.table.band')}</th>}
            <th style={cell}><span className="sr-only">{F.t('forecast.table.show')}</span></th>
          </tr>
        </thead>
        <tbody>
          {result.weeks.map(w => (
            <Fragment key={w.index}>
              <tr id={`week-${w.index}`} data-testid={`forecast-week-${w.index}`} data-shortfall={shortfall(w.closingMinor) || undefined}
                onMouseEnter={() => setHover(w.index)} onMouseLeave={() => setHover(null)}
                style={{ background: shortfall(w.closingMinor) ? 'var(--ds-warning-bg)' : hover === w.index ? 'var(--ds-bg-tinted)' : undefined }}>
                <td style={{ ...cell, textAlign: 'start' }}>{F.date(w.start)}</td>
                <td style={cell}>{F.jod(w.openingMinor)}</td>
                <td style={cell}>{F.jod(w.inMinor)}</td>
                <td style={cell}>{F.jod(w.outMinor)}</td>
                <td style={{ ...cell, fontWeight: 600, color: shortfall(w.closingMinor) ? 'var(--ds-warning-text)' : undefined }} data-testid={`forecast-closing-${w.index}`}>{F.jod(w.closingMinor)}</td>
                {result.variableSpend && <td style={{ ...cell, color: 'var(--ds-text-muted)' }}>{F.jod(w.bandLowMinor)} – {F.jod(w.bandHighMinor)}</td>}
                <td style={cell}>
                  <button type="button" style={{ ...secondaryButton, padding: '3px 8px', fontSize: '12px' }} aria-expanded={open === w.index} aria-controls={`week-lines-${w.index}`}
                    onClick={() => onToggle(w.index)}>
                    {open === w.index ? F.t('forecast.table.hide') : F.t('forecast.table.show')}
                  </button>
                </td>
              </tr>
              {open === w.index && (
                <tr id={`week-lines-${w.index}`}>
                  <td colSpan={result.variableSpend ? 7 : 6} style={{ padding: '6px 16px 12px', borderBottom: '1px solid var(--ds-border)' }}>
                    {w.lines.length === 0 ? <p style={muted}>{F.t('forecast.table.nothing')}</p> : (
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {w.lines.map(l => {
                          const href = lineHref(l);
                          return (
                            <li key={l.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
                              <span style={{ ...muted, minWidth: '90px' }}>{F.date(l.date)}</span>
                              <Chip tone={l.source === 'detected' || l.source === 'scenario' ? 'info' : 'neutral'}>{F.t(`forecast.source.${l.source}`)}</Chip>
                              {l.isEstimate && <Chip tone="warning">{F.t('forecast.line.estimate')}</Chip>}
                              <span style={{ flex: '1 1 140px', overflowWrap: 'anywhere' }}>{href ? <Link href={href} style={{ color: 'var(--ds-primary)' }}>{l.label}</Link> : l.label}</span>
                              <span style={{ fontVariantNumeric: 'tabular-nums', color: l.direction === 'in' ? 'var(--ds-success-text)' : 'var(--ds-text-body)' }}>
                                {l.direction === 'in' ? '+' : '−'}{F.jod(l.amountMinor)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}
