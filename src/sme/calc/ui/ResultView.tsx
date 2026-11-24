'use client';

import type { CSSProperties } from 'react';
import { Chip } from '@/sme/ledger/ui/shared';
import type { Assumption, CalcResult, ResultTable, TraceStep, Warning } from '../core/types';
import { useCalcText } from './format';

export interface ResultData {
  version: string;
  as_of: string;
  output: CalcResult;
  trace: TraceStep[];
  assumptions: Assumption[];
  warnings: Warning[];
}

const sectionTitle: CSSProperties = { fontSize: '14px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' };
const cell: CSSProperties = { padding: '8px 10px', textAlign: 'start', borderBlockEnd: '0.5px solid var(--ds-border)', whiteSpace: 'nowrap' };

/** CAL-03: the result, its sensitivity, the formula trace and every assumption behind it. */
export function ResultView({ result }: { result: ResultData }) {
  const T = useCalcText();
  const primary = result.output.figures.filter(f => f.primary);
  const others = result.output.figures.filter(f => !f.primary);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
        {primary.map(f => (
          <div key={f.key} style={{ padding: '12px 14px', borderRadius: '12px', background: 'var(--ds-bg-tinted)', border: '0.5px solid var(--ds-border-tinted)' }}>
            <div style={{ fontSize: '12px', color: 'var(--ds-text-muted)' }}>{T.t(f.labelKey)}</div>
            <div style={{ fontSize: '22px', fontWeight: 600, color: f.value.kind === 'none' ? 'var(--ds-text-muted)' : 'var(--ds-text-heading)', marginBlockStart: '4px', overflowWrap: 'anywhere' }}>{T.value(f.value)}</div>
          </div>
        ))}
      </div>

      {others.length > 0 && (
        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '8px 16px', margin: 0, fontSize: '14px' }}>
          {others.map(f => (
            <div key={f.key} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--ds-text-body)' }}>{T.t(f.labelKey)}</dt>
              <dd style={{ margin: 0, fontWeight: 500, textAlign: 'end', color: f.value.kind === 'none' ? 'var(--ds-text-muted)' : 'var(--ds-text-heading)' }}>{T.value(f.value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {result.warnings.length > 0 && (
        <div role="status" style={{ padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--ds-warning-border)', background: 'var(--ds-warning-bg)', color: 'var(--ds-warning-text)', fontSize: '13px' }}>
          <strong style={{ display: 'block', marginBlockEnd: '4px' }}>{T.t('tools.result.warnings')}</strong>
          <ul style={{ margin: 0, paddingInlineStart: '18px' }}>{result.warnings.map(w => <li key={w.key}>{T.tv(w.messageKey, w.values)}</li>)}</ul>
        </div>
      )}

      {result.output.tables.map(table => <ResultTableView key={table.key} table={table} />)}

      {result.assumptions.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={sectionTitle}>{T.t('tools.result.assumptions')}</h3>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {result.assumptions.map(a => (
              <li key={a.key} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', lineHeight: 1.6 }}>
                <Chip tone={a.source === 'unverified_user_rate' ? 'warning' : 'neutral'}>{T.t(`tools.assumption.source.${a.source}`)}</Chip>
                <span>{T.tv(a.messageKey, a.values)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details>
        <summary style={{ ...sectionTitle, cursor: 'pointer' }}>{T.t('tools.result.trace')}</summary>
        <ol style={{ margin: '10px 0 0', paddingInlineStart: '20px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
          {result.trace.map((step, n) => (
            <li key={n}>
              <div style={{ fontWeight: 600 }}>{T.t(step.labelKey)}</div>
              <div style={{ color: 'var(--ds-text-muted)' }}>{T.t('tools.result.formula')}: <code dir="ltr">{step.formula}</code></div>
              <div style={{ color: 'var(--ds-text-muted)' }} dir="ltr">
                {Object.entries(step.inputs).map(([k, v]) => `${k} = ${v}`).join(' · ')} → <strong>{step.result}</strong>
              </div>
              {step.rounding && (
                <div style={{ color: 'var(--ds-text-muted)' }}>
                  {T.t(step.rounding.mode === 'up' ? 'tools.result.roundedUp' : 'tools.result.rounded', { exact: step.rounding.exact, rounded: step.rounding.rounded })}
                </div>
              )}
            </li>
          ))}
        </ol>
      </details>

      <p style={{ fontSize: '12px', color: 'var(--ds-text-muted)', margin: 0 }}>{T.t('tools.result.meta', { version: result.version, date: T.date(result.as_of) })}</p>
    </div>
  );
}

function ResultTableView({ table }: { table: ResultTable }) {
  const T = useCalcText();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
      <h3 style={sectionTitle}>{T.t(table.titleKey)}</h3>
      <div style={{ overflowX: 'auto', border: '0.5px solid var(--ds-border)', borderRadius: '12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr>
              {table.rows.some(r => r.labelKey) && <th style={{ ...cell, fontWeight: 500, color: 'var(--ds-text-muted)' }} />}
              {table.columns.map(c => <th key={c.key} scope="col" style={{ ...cell, fontWeight: 500, color: 'var(--ds-text-muted)' }}>{T.t(c.labelKey)}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map(row => (
              <tr key={row.key}>
                {row.labelKey && <th scope="row" style={{ ...cell, fontWeight: 500 }}>{T.tv(row.labelKey, row.labelValues)}</th>}
                {table.columns.map(c => {
                  const v = row.cells[c.key];
                  return <td key={c.key} style={{ ...cell, color: v?.kind === 'none' ? 'var(--ds-text-muted)' : undefined }}>{v ? T.value(v) : ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
