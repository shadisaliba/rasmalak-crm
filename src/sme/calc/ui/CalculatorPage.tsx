'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { smeApi, errorText } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { Chip, FormError, card, input, primaryButton, secondaryButton } from '@/sme/ledger/ui/shared';
import { getCalculator, isCalculatorCode, type CatalogueEntry } from '../core/run';
import type { CalcError, RegisteredCalculator } from '../core/types';
import { CalcForm, type FieldSource } from './CalcForm';
import { ResultView, type ResultData } from './ResultView';
import { textToWire, useCalcText, wireToText, type FieldErrors, type RawValues } from './format';

interface PrefillResponse {
  currency: string;
  suggestions: { field: string; source: FieldSource['source']; value_minor: string; as_of: string; count: number; excluded: number }[];
}
interface RunResponse extends ResultData { record: { id: string; is_saved: boolean; name: string | null } }
interface SavedRecord { id: string; calculator_code: string; name: string | null; input_snapshot: Record<string, unknown> }

export function CalculatorPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const calc = isCalculatorCode(code) ? getCalculator(code) : undefined;
  const T = useCalcText();
  if (!calc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <PageHeader title={T.t('tools.title')} back={{ href: '/crm/tools', label: T.t('tools.back') }} />
        <DataState state="empty" message={T.t('tools.error.unknown_calculator')} />
      </div>
    );
  }
  return <Calculator calc={calc} />;
}

function Calculator({ calc }: { calc: RegisteredCalculator }) {
  const T = useCalcText();
  const search = useSearchParams();
  const { currentOrg } = useOrg();
  const canSave = useOrgPermission('sme.calc.save');
  const currency = currentOrg?.currency || 'JOD';

  const [values, setValues] = useState<RawValues>({});
  const [sources, setSources] = useState<Record<string, FieldSource>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [entry, setEntry] = useState<CatalogueEntry | null>(null);
  const [prefill, setPrefill] = useState<'idle' | 'loading' | 'done' | 'none'>('idle');
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  // One key per submission, kept across retries of the same click.
  const saveKey = useRef<string>(crypto.randomUUID());

  const fill = (wire: Record<string, unknown>) => {
    setValues(Object.fromEntries(calc.fields.map(f => [f.key, wireToText(f, wire[f.key], currency)])));
    setSources({});
    setErrors({});
    setResult(null);
  };

  useEffect(() => {
    if (!currentOrg) return;
    let ignore = false;
    smeApi<{ items: CatalogueEntry[] }>('calculators', { orgId: currentOrg.id }).then(r => {
      if (!ignore && r.ok) setEntry(r.data.items.find(i => i.code === calc.code) ?? null);
    });
    return () => { ignore = true; };
  }, [currentOrg, calc.code]);

  // "Open in calculator" from a saved scenario loads its inputs; the saved record never changes.
  const recordId = search.get('record');
  useEffect(() => {
    if (!currentOrg || !recordId) return;
    let ignore = false;
    smeApi<{ items: SavedRecord[] }>(`calculations?id=${encodeURIComponent(recordId)}`, { orgId: currentOrg.id }).then(r => {
      const rec = r.ok ? r.data.items[0] : undefined;
      if (ignore || !rec || rec.calculator_code !== calc.code) return;
      setValues(Object.fromEntries(calc.fields.map(f => [f.key, wireToText(f, rec.input_snapshot[f.key], currency)])));
      setLoadedFrom(rec.name ?? '');
    });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per record
  }, [currentOrg, recordId, calc.code]);

  const change = (key: string, value: string | Record<string, string>[]) => {
    setValues(v => ({ ...v, [key]: value }));
    setErrors(e => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key && !k.startsWith(`${key}.`))));
  };

  const loadPrefill = async () => {
    if (!currentOrg) return;
    setPrefill('loading');
    const r = await smeApi<PrefillResponse>(`calculators/${calc.code}/prefill`, { orgId: currentOrg.id });
    if (!r.ok || r.data.suggestions.length === 0) { setPrefill('none'); return; }
    const next: Record<string, FieldSource> = {};
    const nextValues: RawValues = {};
    for (const s of r.data.suggestions) {
      const field = calc.fields.find(f => f.key === s.field);
      if (!field) continue;
      const text = wireToText(field, s.value_minor, r.data.currency) as string;
      nextValues[s.field] = text;
      next[s.field] = { source: s.source, asOf: s.as_of, count: s.count, excluded: s.excluded, original: text };
    }
    setValues(v => ({ ...v, ...nextValues }));
    setSources(next);
    setPrefill('done');
  };

  const submit = async (save: boolean) => {
    if (!currentOrg) return null;
    const { input: wire, errors: local } = textToWire(calc.fields, values, currency);
    if (Object.keys(local).length > 0) { setErrors(local); return null; }
    const prefillRefs = Object.entries(sources).filter(([k, s]) => values[k] === s.original)
      .map(([k, s]) => ({ field: k, source: s.source, value_minor: String(wire[k] ?? '0'), as_of: s.asOf }));
    const overrides = Object.entries(sources).filter(([k, s]) => values[k] !== s.original).map(([k]) => k);
    const r = await smeApi<RunResponse>(`calculations/${calc.code}`, {
      orgId: currentOrg.id, method: 'POST', idempotencyKey: save ? saveKey.current : undefined,
      body: { input: wire, save, name: save ? saveName.trim() : undefined, prefill_refs: prefillRefs, overrides },
    });
    if (r.ok) return r.data;
    const calcErrors = (r.error.details?.errors as CalcError[] | undefined) ?? [];
    const byField: FieldErrors = {};
    const general: string[] = [];
    for (const e of calcErrors) {
      if (e.field) byField[e.field] = e.messageKey;
      else general.push(T.tv(e.messageKey, e.values));
    }
    setErrors(byField);
    return { error: general.join(' ') || (calcErrors.length ? null : errorText(r.error, T.intl.locale)) };
  };

  const calculate = async () => {
    setRunning(true);
    setFormError(null);
    setSaveState('idle');
    const r = await submit(false);
    setRunning(false);
    if (r && 'error' in r) { setFormError(r.error); setResult(null); return; }
    if (r) { setResult(r); saveKey.current = crypto.randomUUID(); }
  };

  const save = async () => {
    if (!saveName.trim()) { setSaveError(T.t('tools.save.nameRequired')); return; }
    setSaveError(null);
    setSaveState('saving');
    const r = await submit(true);
    if (r && 'error' in r) { setSaveError(r.error ?? T.t('tools.error.generic')); setSaveState('idle'); return; }
    if (r) { setResult(r); setSaveState('saved'); saveKey.current = crypto.randomUUID(); }
    else setSaveState('idle');
  };

  const needsRule = entry?.availability === 'needs_rule';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title={T.t(`calc.${calc.code}.title`)} description={T.t(`calc.${calc.code}.description`)}
        back={{ href: '/crm/tools', label: T.t('tools.back') }}
        badge={<Chip tone="info">{T.t('tools.version', { version: calc.version })}</Chip>} />
      <SmeGate permission="sme.calc.run">
        {calc.unavailableReasonKey ? <DataState state="empty" message={T.t(calc.unavailableReasonKey)} /> : (
          <>
            {needsRule && <DataState state="review_needed" message={T.t('tools.availability.needs_rule.note')} />}
            {loadedFrom !== null && <DataState state="partial" message={T.t('tools.loadedFrom', { name: loadedFrom })} />}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '16px', alignItems: 'start' }}>
              <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '14px' }} aria-labelledby="calc-form-title">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 id="calc-form-title" style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>{T.t('tools.form.title')}</h2>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {calc.fields.some(f => f.kind === 'money' && f.prefill) && (
                      <button type="button" style={secondaryButton} onClick={loadPrefill} disabled={prefill === 'loading'}>
                        {prefill === 'loading' ? T.t('tools.form.prefill.loading') : T.t('tools.form.prefill')}
                      </button>
                    )}
                    <button type="button" style={secondaryButton} onClick={() => { fill(calc.example); setLoadedFrom(null); }}>{T.t('tools.form.example')}</button>
                    <button type="button" style={secondaryButton} onClick={() => { fill({}); setLoadedFrom(null); setPrefill('idle'); }}>{T.t('tools.form.reset')}</button>
                  </div>
                </div>
                {prefill === 'done' && <p role="status" style={{ fontSize: '12px', margin: 0, color: 'var(--ds-text-muted)' }}>{T.t('tools.form.prefill.done')}</p>}
                {prefill === 'none' && <p role="status" style={{ fontSize: '12px', margin: 0, color: 'var(--ds-text-muted)' }}>{T.t('tools.form.prefill.none')}</p>}
                <CalcForm fields={calc.fields} values={values} currency={currency} errors={errors} sources={sources} onChange={change} />
                <FormError message={formError} />
                <button type="button" style={{ ...primaryButton, alignSelf: 'flex-start' }} onClick={calculate} disabled={running}>
                  {running ? T.t('tools.form.calculating') : T.t('tools.form.calculate')}
                </button>
              </section>

              <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '14px' }} aria-labelledby="calc-result-title" aria-live="polite">
                <h2 id="calc-result-title" style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>{T.t('tools.result.title')}</h2>
                {result ? <ResultView result={result} /> : <DataState state="empty" message={T.t('tools.result.empty')} />}
                {result && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBlockStart: '12px', borderBlockStart: '0.5px solid var(--ds-border)' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>{T.t('tools.save.title')}</h3>
                    {canSave ? (
                      <>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          <input aria-label={T.t('tools.save.name')} placeholder={T.t('tools.save.name')} value={saveName} maxLength={120}
                            onChange={e => { setSaveName(e.target.value); setSaveState('idle'); }} style={{ ...input, flex: '1 1 200px', width: 'auto' }} />
                          <button type="button" style={primaryButton} onClick={save} disabled={saveState === 'saving'}>
                            {saveState === 'saving' ? T.t('tools.save.saving') : T.t('tools.save.button')}
                          </button>
                        </div>
                        <FormError message={saveError} />
                        {saveState === 'saved' && (
                          <p role="status" style={{ fontSize: '13px', margin: 0 }}>
                            {T.t('tools.save.done')} <Link href="/crm/tools/saved" style={{ color: 'var(--ds-primary)' }}>{T.t('tools.save.view')}</Link>
                          </p>
                        )}
                      </>
                    ) : <p style={{ fontSize: '13px', margin: 0, color: 'var(--ds-text-muted)' }}>{T.t('tools.save.noPermission')}</p>}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </SmeGate>
    </div>
  );
}
