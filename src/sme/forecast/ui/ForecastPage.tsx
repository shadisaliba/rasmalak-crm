'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { smeApi, errorText, type SmeApiError, type SmeResult } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { DataCompletenessBanner } from '@/sme/kpi/ui/DataCompletenessBanner';
import { todayInAmman } from '@/sme/ledger/domain/dates';
import { card, muted, primaryButton, secondaryButton, input, useLedgerReferenceData } from '@/sme/ledger/ui/shared';
import type { DetectedSeriesSummary, ForecastAssumption, ForecastResult, Wire } from '../domain/types';
import type { ForecastRun, ScenarioRow, ScheduledItemRow } from '../api/types';
import { useForecastText } from './text';
import { ForecastChart } from './ForecastChart';
import { WeeksTable } from './WeeksTable';
import { AssumptionsPanel, DetectedSeriesPanel, UncertainPanel } from './AssumptionsPanel';
import { BufferPanel, ScheduledItemsPanel } from './ScheduledItemsPanel';
import { ScenarioEditor } from './ScenarioEditor';

type Load = { status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; run: ForecastRun; stale: boolean };
const CADENCE_TO_RECURRENCE: Record<string, ScheduledItemRow['recurrence']> = { weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly', yearly: 'annually' };

/** The stored run if it matches today's inputs; otherwise recompute, falling back to the stale run. */
async function fetchRun(orgId: string, scenarioId: string | null): Promise<SmeResult<{ run: ForecastRun; stale: boolean }>> {
  const latest = await smeApi<{ forecast: ForecastRun | null; stale: boolean }>(`forecasts/latest${scenarioId ? `?scenario_id=${scenarioId}` : ''}`, { orgId });
  if (!latest.ok) return latest;
  if (latest.data.forecast && !latest.data.stale) return { ok: true, data: { run: latest.data.forecast, stale: false } };
  const fresh = await smeApi<ForecastRun>('forecasts', { orgId, method: 'POST', body: { scenario_id: scenarioId } });
  if (fresh.ok) return { ok: true, data: { run: fresh.data, stale: false } };
  return latest.data.forecast ? { ok: true, data: { run: latest.data.forecast, stale: true } } : fresh;
}

export function ForecastPage() {
  return (
    <SmeGate permission="sme.forecast.read">
      <ForecastScreen />
    </SmeGate>
  );
}

function ForecastScreen() {
  const F = useForecastText();
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const canChange = useOrgPermission('sme.forecast.scenario');
  const { categories } = useLedgerReferenceData(orgId);
  const today = todayInAmman();
  const [reload, setReload] = useState(0);
  const [baseline, setBaseline] = useState<Load>({ status: 'loading' });
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenarioRun, setScenarioRun] = useState<Load | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [items, setItems] = useState<ScheduledItemRow[]>([]);
  const [settings, setSettings] = useState<{ buffer_minor: string; dismissed_series: string[] }>({ buffer_minor: '0', dismissed_series: [] });
  const [editor, setEditor] = useState<{ scenario: ScenarioRow | null; handle: NonNullable<ForecastAssumption['handle']> | null } | null>(null);
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const refresh = () => setReload(k => k + 1);

  useEffect(() => {
    if (!orgId) return;
    let ignore = false;
    Promise.all([
      fetchRun(orgId, null),
      smeApi<{ scenarios: ScenarioRow[] }>('scenarios', { orgId }),
      smeApi<{ items: ScheduledItemRow[] }>('scheduled-items', { orgId }),
      smeApi<{ settings: { buffer_minor: string; dismissed_series: string[] } }>('forecast-settings', { orgId }),
    ]).then(([run, sc, it, st]) => {
      if (ignore) return;
      setBaseline(run.ok ? { status: 'ready', ...run.data } : { status: 'failed', error: run.error });
      if (sc.ok) setScenarios(sc.data.scenarios);
      if (it.ok) setItems(it.data.items);
      if (st.ok) setSettings(st.data.settings);
    });
    return () => { ignore = true; };
  }, [orgId, reload]);

  useEffect(() => {
    if (!orgId || !scenarioId) return;
    let ignore = false;
    fetchRun(orgId, scenarioId).then(r => {
      if (!ignore) setScenarioRun(r.ok ? { status: 'ready', ...r.data } : { status: 'failed', error: r.error });
    });
    return () => { ignore = true; };
  }, [orgId, scenarioId, reload]);

  const selectScenario = (id: string | null) => {
    setScenarioId(id);
    setScenarioRun(id ? { status: 'loading' } : null);
  };

  const act = async (call: () => Promise<SmeResult<unknown>>) => {
    setBusy(true);
    setActionError(null);
    const res = await call();
    setBusy(false);
    if (!res.ok) { setActionError(errorText(res.error, F.intl.locale)); return; }
    refresh();
  };

  const dismissSeries = (key: string, dismiss: boolean) => act(() => smeApi('forecast-settings', {
    orgId, method: 'POST',
    body: { dismissed_series: dismiss ? [...new Set([...settings.dismissed_series, key])] : settings.dismissed_series.filter(k => k !== key) },
  }));
  const keepSeries = (s: Wire<DetectedSeriesSummary>) => act(() => smeApi('scheduled-items', {
    orgId, method: 'POST',
    body: {
      label: s.label || F.t(`forecast.cadence.${s.cadence}`), direction: s.direction, amount_minor: s.amountMinor, start_date: s.nextDate,
      recurrence: CADENCE_TO_RECURRENCE[s.cadence] ?? 'none', source: 'detected_confirmed', series_key: s.key, is_estimate: true,
    },
  }));
  const archiveScenario = (id: string) => act(async () => {
    const res = await smeApi(`scenarios/${id}/archive`, { orgId, method: 'POST' });
    if (res.ok) selectScenario(null);
    return res;
  });

  if (!orgId || baseline.status === 'loading') return <DataState state="loading" message={F.t('forecast.computing')} />;
  if (baseline.status === 'failed') {
    return <DataState state={baseline.error.code === 'ACCESS_DENIED' ? 'denied' : 'failed'} message={errorText(baseline.error, F.intl.locale)} onRetry={refresh} />;
  }

  const { run, stale } = baseline;
  const r = run.result;
  const scenario = scenarios.find(s => s.id === scenarioId) ?? null;
  const quality = run.data_quality.grade;
  const partial = quality === 'C' || quality === 'insufficient' || r.assumptions.some(a => a.key === 'foreign_left_out');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title={F.t('forecast.title')} description={F.t('forecast.description')} />
      <DataCompletenessBanner refreshKey={reload} />

      {r.accounts.length === 0 ? (
        <DataState state="empty" message={F.t('forecast.empty')}
          action={<Link href="/crm/money/accounts" style={{ ...primaryButton, textDecoration: 'none' }}>{F.t('forecast.emptyAction')}</Link>} />
      ) : (
        <DataState state={stale ? 'stale' : partial ? 'partial' : 'validated'} message={stale ? undefined : F.t('forecast.partial')} onRetry={refresh}>
          <Summary result={r} onShowWeek={i => { setOpenWeek(i); document.getElementById(`week-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} />

          <section style={{ ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px' }} aria-labelledby="forecast-scenarios">
            <div style={{ flex: '1 1 220px' }}>
              <h2 id="forecast-scenarios" style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{F.t('forecast.scenario.title')}</h2>
              <p style={muted}>{F.t('forecast.scenario.description')}</p>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', color: 'var(--ds-text-body)' }}>
              {F.t('forecast.scenario.compare')}
              <select style={{ ...input, minWidth: '200px' }} value={scenarioId ?? ''} onChange={e => selectScenario(e.target.value || null)}>
                <option value="">{F.t('forecast.scenario.none')}</option>
                {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {canChange && (
              <>
                <button type="button" style={secondaryButton} onClick={() => setEditor({ scenario: null, handle: null })}>{F.t('forecast.scenario.new')}</button>
                {scenario && <button type="button" style={secondaryButton} onClick={() => setEditor({ scenario, handle: null })}>{F.t('forecast.scenario.edit')}</button>}
                {scenario && <button type="button" style={secondaryButton} disabled={busy} onClick={() => void archiveScenario(scenario.id)}>{F.t('forecast.scenario.archive')}</button>}
              </>
            )}
          </section>

          {editor && (
            <ScenarioEditor key={editor.scenario?.id ?? `new-${editor.handle?.type ?? ''}-${editor.handle?.target ?? ''}`} orgId={orgId} today={today}
              baseline={r} items={items} scenario={editor.scenario} handle={editor.handle}
              onCancel={() => setEditor(null)}
              onSaved={id => { setEditor(null); selectScenario(id); refresh(); }} />
          )}

          {scenarioId && scenarioRun && (
            scenarioRun.status === 'ready'
              ? <Comparison baseline={r} scenario={scenarioRun.run.result} name={scenario?.name ?? ''} />
              : <DataState state={scenarioRun.status === 'loading' ? 'loading' : 'failed'}
                  message={scenarioRun.status === 'failed' ? errorText(scenarioRun.error, F.intl.locale) : F.t('forecast.computing')} />
          )}

          <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} aria-labelledby="forecast-chart">
            <h2 id="forecast-chart" style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{F.t('forecast.chart.title')}</h2>
            <ForecastChart result={r} />
          </section>

          <WeeksTable result={r} open={openWeek} onToggle={i => setOpenWeek(o => (o === i ? null : i))} />
          <AssumptionsPanel result={r} canChange={canChange} onEdit={handle => setEditor({ scenario: null, handle })} />
          {actionError && <p role="alert" style={{ margin: 0, fontSize: '13px', color: 'var(--ds-error-text)' }}>{actionError}</p>}
          <DetectedSeriesPanel series={r.detectedSeries} canChange={canChange} busy={busy} onDismiss={dismissSeries} onKeep={keepSeries} />
          <UncertainPanel result={r} />
          <ScheduledItemsPanel orgId={orgId} today={today} items={items} categories={categories} canChange={canChange} onChanged={refresh} />
          {canChange && <BufferPanel key={settings.buffer_minor} orgId={orgId} bufferMinor={settings.buffer_minor} onChanged={refresh} />}

          <p style={muted}>
            {F.t('forecast.calculated', { time: F.dateTime(run.run.created_at), version: run.run.engine_version })} · {F.t('forecast.noPayments')}
          </p>
        </DataState>
      )}
    </div>
  );
}

function Summary({ result, onShowWeek }: { result: Wire<ForecastResult>; onShowWeek: (index: number) => void }) {
  const F = useForecastText();
  const weekDate = (i: number) => F.date(result.weeks[i].start);
  const tile: React.CSSProperties = { ...card, flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '4px' };
  const value: React.CSSProperties = { margin: 0, fontSize: '22px', fontWeight: 600, color: 'var(--ds-text-heading)', fontVariantNumeric: 'tabular-nums' };
  const label: React.CSSProperties = { ...muted, fontSize: '13px', fontWeight: 500 };
  const short = result.firstBelowZeroWeek;
  const buffer = result.firstBelowBufferWeek;

  return (
    <>
      {short !== null ? (
        <section role="status" data-testid="forecast-shortfall" style={{ ...card, background: 'var(--ds-warning-bg)', borderColor: 'var(--ds-warning-border)', color: 'var(--ds-warning-text)', display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center' }}>
          <div style={{ flex: '1 1 260px' }}>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{F.t('forecast.summary.shortfall', { date: weekDate(short) })}</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px' }}>{F.t('forecast.summary.shortfallBody', { amount: F.jod(result.weeks[short].closingMinor) })}</p>
          </div>
          <button type="button" style={{ ...secondaryButton, color: 'inherit', borderColor: 'currentColor' }} onClick={() => onShowWeek(short)}>{F.t('forecast.summary.viewWeek')}</button>
        </section>
      ) : buffer !== null ? (
        <section role="status" data-testid="forecast-buffer-warning" style={{ ...card, background: 'var(--ds-warning-bg)', borderColor: 'var(--ds-warning-border)', color: 'var(--ds-warning-text)' }}>
          {F.t('forecast.summary.belowBuffer', { buffer: F.jod(result.bufferMinor), date: weekDate(buffer) })}
        </section>
      ) : (
        <p role="status" data-testid="forecast-no-shortfall" style={{ ...card, margin: 0, background: 'var(--ds-success-bg)', borderColor: 'var(--ds-success-border)', color: 'var(--ds-success-text)', fontSize: '14px' }}>
          {F.t('forecast.summary.noShortfall')}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        <section style={tile} aria-labelledby="forecast-opening">
          <h2 id="forecast-opening" style={label}>{F.t('forecast.summary.opening')}</h2>
          <p style={value} data-testid="forecast-opening">{F.jod(result.openingClearedMinor)}</p>
          <p style={muted}>
            <Link href="/crm/money/accounts" style={{ color: 'var(--ds-primary)' }}>
              {F.t('forecast.summary.openingBasis', { count: result.accounts.length, date: F.date(result.asOf) })}
            </Link>
          </p>
        </section>
        <section style={tile} aria-labelledby="forecast-minimum">
          <h2 id="forecast-minimum" style={label}>{F.t('forecast.summary.minimum')}</h2>
          <p style={{ ...value, color: BigInt(result.minimum.minor) < 0n ? 'var(--ds-warning-text)' : value.color }} data-testid="forecast-minimum">{F.jod(result.minimum.minor)}</p>
          <button type="button" onClick={() => onShowWeek(result.minimum.weekIndex)} style={{ ...muted, background: 'none', border: 'none', padding: 0, textAlign: 'start', cursor: 'pointer', color: 'var(--ds-primary)' }}>
            {F.t('forecast.summary.minimumWeek', { date: weekDate(result.minimum.weekIndex) })}
          </button>
        </section>
        <section style={tile} aria-labelledby="forecast-band">
          <h2 id="forecast-band" style={label}>{F.t('forecast.summary.band')}</h2>
          <p style={{ ...value, fontSize: '16px' }}>
            {result.variableSpend ? F.t('forecast.summary.bandValue', { p25: F.jod(result.variableSpend.p25Minor), p75: F.jod(result.variableSpend.p75Minor) }) : F.t('forecast.summary.bandNone')}
          </p>
          <a href="#assumptions" style={{ ...muted, color: 'var(--ds-primary)' }}>{F.t('forecast.assumptions.title')}</a>
        </section>
      </div>
    </>
  );
}

function Comparison({ baseline, scenario, name }: { baseline: Wire<ForecastResult>; scenario: Wire<ForecastResult>; name: string }) {
  const F = useForecastText();
  const cell: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--ds-border)', textAlign: 'end', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const shortfall = (r: Wire<ForecastResult>) => (r.firstBelowZeroWeek === null ? F.t('forecast.compare.none') : F.date(r.weeks[r.firstBelowZeroWeek].start));
  return (
    <section data-testid="forecast-comparison" style={{ ...card, padding: 0, overflowX: 'auto', position: 'relative' }} aria-labelledby="forecast-compare">
      <h2 id="forecast-compare" style={{ fontSize: '15px', fontWeight: 600, margin: 0, padding: '14px 16px 6px', color: 'var(--ds-text-heading)' }}>{F.t('forecast.compare.title', { scenario: name })}</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px', color: 'var(--ds-text-body)' }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: 'start' }}>{F.t('forecast.table.week')}</th>
            <th style={cell}>{F.t('forecast.compare.baseline')}</th>
            <th style={cell}>{name}</th>
            <th style={cell}>{F.t('forecast.compare.difference')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" style={{ ...cell, textAlign: 'start' }}>{F.t('forecast.compare.minimum')}</th>
            <td style={cell}>{F.jod(baseline.minimum.minor)}</td>
            <td style={cell} data-testid="scenario-minimum">{F.jod(scenario.minimum.minor)}</td>
            <td style={cell}>{F.jod(BigInt(scenario.minimum.minor) - BigInt(baseline.minimum.minor))}</td>
          </tr>
          <tr>
            <th scope="row" style={{ ...cell, textAlign: 'start' }}>{F.t('forecast.compare.shortfall')}</th>
            <td style={cell}>{shortfall(baseline)}</td>
            <td style={cell} data-testid="scenario-shortfall">{shortfall(scenario)}</td>
            <td style={cell} />
          </tr>
          {baseline.weeks.map((w, i) => (
            <tr key={w.index}>
              <td style={{ ...cell, textAlign: 'start' }}>{F.date(w.start)}</td>
              <td style={cell}>{F.jod(w.closingMinor)}</td>
              <td style={cell}>{F.jod(scenario.weeks[i].closingMinor)}</td>
              <td style={cell}>{F.jod(BigInt(scenario.weeks[i].closingMinor) - BigInt(w.closingMinor))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
