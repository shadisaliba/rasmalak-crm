'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Chip, input, secondaryButton } from '@/sme/ledger/ui/shared';
import type { FieldSpec, PrefillSource } from '../core/types';
import { useCalcText, type FieldErrors, type RawValues } from './format';

export interface FieldSource {
  source: PrefillSource;
  asOf: string;
  count: number;
  excluded: number;
  /** The suggested text; once the user changes it, the field counts as overridden. */
  original: string;
}

interface CalcFormProps {
  fields: FieldSpec[];
  values: RawValues;
  currency: string;
  errors: FieldErrors;
  sources: Record<string, FieldSource>;
  onChange: (key: string, value: string | Record<string, string>[]) => void;
}

const labelText: CSSProperties = { fontSize: '13px', fontWeight: 500, color: 'var(--ds-text-body)' };
const help: CSSProperties = { fontSize: '12px', lineHeight: 1.5, color: 'var(--ds-text-muted)', margin: 0 };
const suffix: CSSProperties = { fontSize: '12px', color: 'var(--ds-text-muted)', whiteSpace: 'nowrap' };

/** CAL-02: inputs with period and unit tags, and the source of any prefilled value. */
export function CalcForm({ fields, values, currency, errors, sources, onChange }: CalcFormProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {fields.map(field => (
        <FieldInput key={field.key} field={field} path={field.key} value={values[field.key]} currency={currency} errors={errors}
          source={sources[field.key]} onChange={v => onChange(field.key, v)} />
      ))}
    </div>
  );
}

function FieldInput({ field, path, value, currency, errors, source, onChange }: {
  field: FieldSpec; path: string; value: RawValues[string] | undefined; currency: string; errors: FieldErrors;
  source?: FieldSource; onChange: (value: string | Record<string, string>[]) => void;
}) {
  const T = useCalcText();
  const id = `calc-${path}`;
  const error = errors[path];
  const describedBy = [field.helpKey ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

  if (field.kind === 'items') {
    const items = Array.isArray(value) ? value : [];
    const blank = () => Object.fromEntries(field.itemFields.map(f => [f.key, f.kind === 'select' ? f.options[0]?.value ?? '' : '']));
    return (
      <fieldset style={{ border: '0.5px solid var(--ds-border)', borderRadius: '12px', padding: '12px', margin: 0, display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
        <legend style={{ ...labelText, padding: '0 4px' }}>{T.t(field.labelKey)}</legend>
        {field.helpKey && <p id={`${id}-help`} style={help}>{T.t(field.helpKey)}</p>}
        {items.map((item, n) => (
          <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingBlockEnd: '12px', borderBlockEnd: '0.5px dashed var(--ds-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ ...labelText, fontWeight: 600 }}>{T.t('tools.form.item', { n: T.number(n + 1) })}</span>
              <button type="button" style={secondaryButton} onClick={() => onChange(items.filter((_, i) => i !== n))}>{T.t('tools.form.removeItem')}</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
              {field.itemFields.map(sub => (
                <FieldInput key={sub.key} field={sub} path={`${path}.${n}.${sub.key}`} value={item[sub.key] ?? ''} currency={currency} errors={errors}
                  onChange={v => onChange(items.map((it, i) => (i === n ? { ...it, [sub.key]: typeof v === 'string' ? v : '' } : it)))} />
              ))}
            </div>
          </div>
        ))}
        {(!field.maxItems || items.length < field.maxItems) && (
          <button type="button" style={{ ...secondaryButton, alignSelf: 'flex-start' }} onClick={() => onChange([...items, blank()])}>{T.t(field.addLabelKey)}</button>
        )}
        {error && <p id={`${id}-error`} role="alert" style={{ ...help, color: 'var(--ds-error-text)' }}>{T.t(error)}</p>}
      </fieldset>
    );
  }

  const text = typeof value === 'string' ? value : '';
  let control: ReactNode;
  let after: string | null = null;
  if (field.kind === 'select') {
    control = (
      <select id={id} value={text} onChange={e => onChange(e.target.value)} style={input} aria-describedby={describedBy} aria-invalid={!!error || undefined}>
        <option value="">—</option>
        {field.options.map(o => <option key={o.value} value={o.value}>{T.t(o.labelKey)}</option>)}
      </select>
    );
  } else {
    const numeric = field.kind === 'money' || field.kind === 'percent' || field.kind === 'number';
    control = (
      <input id={id} value={text} onChange={e => onChange(e.target.value)} style={input}
        type={field.kind === 'date' ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} dir={numeric || field.kind === 'date' ? 'ltr' : undefined}
        maxLength={field.kind === 'text' ? field.maxLength ?? 120 : undefined} aria-describedby={describedBy} aria-invalid={!!error || undefined} />
    );
    if (field.kind === 'money') after = [currency, field.period ? T.t(`tools.period.${field.period}`) : ''].filter(Boolean).join(' · ');
    if (field.kind === 'percent') after = '%';
    if (field.kind === 'number' && field.unit) after = T.t(`tools.unit.${field.unit}`);
  }
  const overridden = source && text !== source.original;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 }}>
      <label htmlFor={id} style={labelText}>
        {T.t(field.labelKey)}
        {field.optional && <span style={{ ...suffix, marginInlineStart: '6px' }}>({T.t('tools.form.optional')})</span>}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>{control}</div>
        {after && <span style={suffix}>{after}</span>}
      </div>
      {source && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          <Chip tone={overridden ? 'warning' : 'neutral'}>{overridden ? T.t('tools.source.overridden') : T.t(`tools.source.${source.source}`)}</Chip>
          {!overridden && (
            <span style={suffix}>
              {T.t('tools.source.asOf', { date: T.date(source.asOf) })} · {T.t('tools.source.coverage', { count: source.count })}
              {source.excluded > 0 && <> · {T.t('tools.source.excluded', { count: source.excluded })}</>}
            </span>
          )}
        </div>
      )}
      {field.helpKey && <p id={`${id}-help`} style={help}>{T.t(field.helpKey)}</p>}
      {error && <p id={`${id}-error`} role="alert" style={{ ...help, color: 'var(--ds-error-text)' }}>{T.t(error)}</p>}
    </div>
  );
}
