'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useOrg } from '@/store/orgStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { Chip, card, secondaryButton } from '@/sme/ledger/ui/shared';
import type { CalcResult } from '../core/types';
import { useCalcText } from './format';

interface SavedRecord {
  id: string;
  calculator_code: string;
  calculator_version: string;
  as_of: string;
  name: string;
  created_at: string;
  output: CalcResult;
  overrides: string[];
  prefill_refs: unknown[];
}

type Load = { status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; items: SavedRecord[] };
const MAX_COMPARE = 3;
const cell: CSSProperties = { padding: '8px 10px', textAlign: 'start', borderBlockEnd: '0.5px solid var(--ds-border)', whiteSpace: 'nowrap' };

/** CAL-04: named scenarios, each with its version, and a side-by-side comparison. */
export function SavedScenarios() {
  const T = useCalcText();
  const { currentOrg } = useOrg();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<{ items: SavedRecord[] }>('calculations?saved=true', { orgId: currentOrg.id }).then(r => {
      if (!ignore) setLoad(r.ok ? { status: 'ready', items: r.data.items } : { status: 'failed', error: r.error });
    });
    return () => { ignore = true; };
  }, [currentOrg, reloadKey]);

  const items = load.status === 'ready' ? load.items : [];
  const chosen = items.filter(i => selected.includes(i.id));
  const sameCalculator = chosen.length > 1 && chosen.every(c => c.calculator_code === chosen[0].calculator_code);
  const toggle = (id: string) => {
    setComparing(false);
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : s.length < MAX_COMPARE ? [...s, id] : s));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title={T.t('tools.saved.title')} description={T.t('tools.saved.description')} back={{ href: '/crm/tools', label: T.t('tools.back') }} />
      <SmeGate permission="sme.calc.run">
        {load.status === 'loading' && <DataState state="loading" />}
        {load.status === 'failed' && <DataState state="failed" message={errorText(load.error, T.intl.locale)} onRetry={() => { setLoad({ status: 'loading' }); setReloadKey(k => k + 1); }} />}
        {load.status === 'ready' && items.length === 0 && (
          <DataState state="empty" message={T.t('tools.saved.empty')} action={<Link href="/crm/tools" style={{ ...secondaryButton, textDecoration: 'none' }}>{T.t('tools.title')}</Link>} />
        )}
        {items.length > 0 && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <button type="button" style={secondaryButton} disabled={!sameCalculator} onClick={() => setComparing(true)}>{T.t('tools.saved.compare')}</button>
              {selected.length > 0 && <button type="button" style={secondaryButton} onClick={() => { setSelected([]); setComparing(false); }}>{T.t('tools.saved.clear')}</button>}
              <span style={{ fontSize: '12px', color: 'var(--ds-text-muted)' }}>{T.t('tools.saved.compareHint')}</span>
            </div>
            {comparing && sameCalculator && <Comparison records={chosen} />}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '12px' }}>
              {items.map(rec => {
                const headline = rec.output.figures.find(f => f.primary) ?? rec.output.figures[0];
                return (
                  <li key={rec.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' }}>
                      <input type="checkbox" checked={selected.includes(rec.id)} onChange={() => toggle(rec.id)} aria-label={T.t('tools.saved.select', { name: rec.name })} style={{ marginBlockStart: '3px' }} />
                      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                        <strong style={{ fontSize: '14px', overflowWrap: 'anywhere' }}>{rec.name}</strong>
                        <span style={{ fontSize: '12px', color: 'var(--ds-text-muted)' }}>{T.t(`calc.${rec.calculator_code}.title`)} · {T.dateTime(rec.created_at)}</span>
                      </span>
                    </label>
                    {headline && (
                      <div style={{ fontSize: '13px' }}>
                        <span style={{ color: 'var(--ds-text-muted)' }}>{T.t(headline.labelKey)}: </span>
                        <strong>{T.value(headline.value)}</strong>
                      </div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Chip tone="info">{T.t('tools.version', { version: rec.calculator_version })}</Chip>
                      <Link href={`/crm/tools/${rec.calculator_code}?record=${rec.id}`} style={{ fontSize: '13px', color: 'var(--ds-primary)' }}>{T.t('tools.saved.open')}</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </SmeGate>
    </div>
  );
}

function Comparison({ records }: { records: SavedRecord[] }) {
  const T = useCalcText();
  const keys = records[0].output.figures.map(f => ({ key: f.key, labelKey: f.labelKey }));
  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }} aria-labelledby="calc-compare-title">
      <h2 id="calc-compare-title" style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>{T.t('tools.saved.comparison')} · {T.t(`calc.${records[0].calculator_code}.title`)}</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...cell, color: 'var(--ds-text-muted)', fontWeight: 500 }}>{T.t('tools.saved.figure')}</th>
              {records.map(r => (
                <th key={r.id} scope="col" style={{ ...cell, fontWeight: 600 }}>
                  {r.name}
                  <div style={{ fontWeight: 400, fontSize: '11px', color: 'var(--ds-text-muted)' }}>{T.t('tools.version', { version: r.calculator_version })}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.key}>
                <th scope="row" style={{ ...cell, fontWeight: 500 }}>{T.t(k.labelKey)}</th>
                {records.map(r => {
                  const f = r.output.figures.find(x => x.key === k.key);
                  return <td key={r.id} style={cell}>{f ? T.value(f.value) : '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
