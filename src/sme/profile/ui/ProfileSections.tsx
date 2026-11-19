'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { OWNER_FACT_KEYS, FACTS, JOFOTARA_STATUSES, factLabelKey, isValidFactValue, type FactKey, type FactStatus } from '../factKeys';
import { DATA_USE_PURPOSES } from '../consents';
import { setConsent, setFact, updateProfile, type LookupKind, type ProfileBundle, type ProfilePatch } from '../client';

export const sectionCard: CSSProperties = {
  background: 'var(--ds-bg-card)', border: '0.5px solid var(--ds-border)', borderRadius: '16px', padding: '20px',
  boxShadow: 'var(--ds-shadow-card)', display: 'flex', flexDirection: 'column', gap: '14px',
};
const fieldStyle: CSSProperties = {
  padding: '9px 12px', fontSize: '14px', border: '1px solid var(--ds-border)', borderRadius: '8px',
  background: 'var(--ds-bg-input)', color: 'var(--ds-text-body)', width: '100%', maxWidth: '420px',
};
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: 'var(--ds-text-body)' };
export const primaryButton: CSSProperties = { padding: '9px 16px', fontSize: '13px', fontWeight: 500, borderRadius: '8px', border: 'none', background: 'var(--ds-primary)', color: 'var(--ds-on-primary)', cursor: 'pointer', alignSelf: 'flex-start' };
const note: CSSProperties = { fontSize: '12px', color: 'var(--ds-text-muted)', margin: 0 };

function useT() {
  const intl = useIntl();
  return { intl, t: (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values), isAr: intl.locale.startsWith('ar') };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={labelStyle}>{label}{children}</label>;
}

function SaveStatus({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  const { t } = useT();
  if (state === 'saved') return <span role="status" style={{ fontSize: '13px', color: 'var(--ds-success-text)' }}>{t('sme.profile.saved')}</span>;
  if (state === 'error') return <span role="alert" style={{ fontSize: '13px', color: 'var(--ds-error-text)' }}>{t('sme.profile.error')}</span>;
  return null;
}

export interface SectionProps {
  orgId: string;
  bundle: ProfileBundle;
  /** Called after a successful save; the onboarding wizard uses it to move on. */
  onSaved: () => void;
  saveLabel?: string;
}

// ── Identity ─────────────────────────────────────────────────

export function IdentitySection({ orgId, bundle, onSaved, saveLabel }: SectionProps) {
  const { t, isAr } = useT();
  const p = bundle.profile;
  const [form, setForm] = useState({
    trade_name: p?.tradeName ?? '', trade_name_ar: p?.tradeNameAr ?? '', legal_name: p?.legalName ?? '',
    legal_form: p?.legalForm ?? '', sector: p?.sector ?? '', activity_description: p?.activityDescription ?? '',
    governorate: p?.governorate ?? '', municipality: p?.municipality ?? '', premises_type: p?.premisesType ?? '',
  });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = async () => {
    setState('saving');
    const patch: ProfilePatch = {};
    for (const [k, v] of Object.entries(form)) patch[k as keyof ProfilePatch] = v === '' ? null : v;
    const result = await updateProfile(orgId, patch);
    setState(result.ok ? 'saved' : 'error');
    if (result.ok) onSaved();
    return result.ok;
  };

  const select = (kind: LookupKind, key: keyof typeof form, allowNotSure = false) => {
    const values = bundle.lookups[kind];
    const pending = values.some(v => v.reviewState === 'needs_review');
    return (
      <>
        <select value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} style={fieldStyle}>
          <option value="">{allowNotSure ? t('sme.profile.notSure') : t('sme.profile.select')}</option>
          {values.map(v => <option key={v.code} value={v.code}>{isAr ? v.nameAr : v.nameEn}</option>)}
        </select>
        {pending && <span style={note}>{t('sme.profile.pendingReview')}</span>}
      </>
    );
  };
  const text = (key: keyof typeof form, dir?: 'rtl' | 'ltr') => (
    <input value={form[key]} dir={dir} onChange={e => setForm({ ...form, [key]: e.target.value })} style={fieldStyle} />
  );

  return (
    <section style={sectionCard} aria-labelledby="profile-identity">
      <h2 id="profile-identity" style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{t('sme.profile.section.identity')}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
        <Field label={t('sme.profile.field.trade_name_ar')}>{text('trade_name_ar', 'rtl')}</Field>
        <Field label={t('sme.profile.field.trade_name')}>{text('trade_name', 'ltr')}</Field>
        <Field label={t('sme.profile.field.legal_name')}>{text('legal_name')}</Field>
        <Field label={t('sme.profile.field.legal_form')}>{select('legal_form', 'legal_form', true)}</Field>
        <Field label={t('sme.profile.field.sector')}>{select('sector', 'sector')}</Field>
        <Field label={t('sme.profile.field.activity_description')}>{text('activity_description')}</Field>
        <Field label={t('sme.profile.field.governorate')}>{select('governorate', 'governorate')}</Field>
        <Field label={t('sme.profile.field.municipality')}>{select('municipality', 'municipality', true)}</Field>
        <Field label={t('sme.profile.field.premises_type')}>{select('premises_type', 'premises_type')}</Field>
      </div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button type="button" style={primaryButton} disabled={state === 'saving'} onClick={save}>{saveLabel ?? t('sme.profile.save')}</button>
        <SaveStatus state={state} />
      </div>
    </section>
  );
}

// ── Finance preferences ──────────────────────────────────────

export function FinanceSection({ orgId, bundle, onSaved, saveLabel }: SectionProps) {
  const { t, intl } = useT();
  const [month, setMonth] = useState(bundle.profile?.fiscalYearStartMonth ?? 1);
  const [weekStart, setWeekStart] = useState(bundle.profile?.weekStart ?? 0);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = async () => {
    setState('saving');
    const result = await updateProfile(orgId, { fiscal_year_start_month: month, week_start: weekStart });
    setState(result.ok ? 'saved' : 'error');
    if (result.ok) onSaved();
    return result.ok;
  };

  // 2023-01-01 was a Sunday, so day index 0..6 maps to Sunday..Saturday.
  const weekday = (d: number) => intl.formatDate(new Date(Date.UTC(2023, 0, 1 + d)), { weekday: 'long', timeZone: 'UTC' });
  const monthName = (m: number) => intl.formatDate(new Date(Date.UTC(2023, m - 1, 1)), { month: 'long', timeZone: 'UTC' });

  return (
    <section style={sectionCard} aria-labelledby="profile-finance">
      <h2 id="profile-finance" style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{t('sme.profile.section.finance')}</h2>
      <Field label={t('sme.profile.field.base_currency')}>
        <span style={{ fontSize: '14px', color: 'var(--ds-text-heading)' }}>{t('sme.profile.baseCurrencyNote')}</span>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
        <Field label={t('sme.profile.field.fiscal_year_start_month')}>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={fieldStyle}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </Field>
        <Field label={t('sme.profile.field.week_start')}>
          <select value={weekStart} onChange={e => setWeekStart(Number(e.target.value))} style={fieldStyle}>
            {Array.from({ length: 7 }, (_, d) => d).map(d => <option key={d} value={d}>{weekday(d)}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button type="button" style={primaryButton} disabled={state === 'saving'} onClick={save}>{saveLabel ?? t('sme.profile.save')}</button>
        <SaveStatus state={state} />
      </div>
    </section>
  );
}

// ── Regulatory facts ─────────────────────────────────────────

type Draft = { status: FactStatus | ''; value: unknown };

function FactValueInput({ factKey, value, onChange }: { factKey: FactKey; value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useT();
  const input = FACTS[factKey].input;
  if (input === 'boolean') {
    return (
      <select value={value === true ? 'yes' : value === false ? 'no' : ''} onChange={e => onChange(e.target.value === '' ? null : e.target.value === 'yes')} style={{ ...fieldStyle, maxWidth: '160px' }}>
        <option value="">{t('sme.profile.select')}</option>
        <option value="yes">{t('sme.profile.yes')}</option>
        <option value="no">{t('sme.profile.no')}</option>
      </select>
    );
  }
  if (input === 'jofotara') {
    return (
      <select value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value || null)} style={fieldStyle}>
        <option value="">{t('sme.profile.select')}</option>
        {JOFOTARA_STATUSES.map(s => <option key={s} value={s}>{t(`sme.jofotara.${s}`)}</option>)}
      </select>
    );
  }
  return (
    <input type="number" min={0} step={1} inputMode="numeric" value={typeof value === 'number' ? value : ''}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} style={{ ...fieldStyle, maxWidth: '160px' }} />
  );
}

export function FactsSection({ orgId, bundle, onSaved, saveLabel }: SectionProps) {
  const { t } = useT();
  const initial = Object.fromEntries(OWNER_FACT_KEYS.map(k => [k, { status: bundle.facts[k]?.status ?? '', value: bundle.facts[k]?.value ?? null }])) as Record<FactKey, Draft>;
  const [drafts, setDrafts] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = async () => {
    setState('saving');
    let ok = true;
    for (const key of OWNER_FACT_KEYS) {
      const d = drafts[key];
      const before = initial[key];
      if (!d.status || (d.status === before.status && JSON.stringify(d.value) === JSON.stringify(before.value))) continue;
      if (d.status === 'known' && !isValidFactValue(key, d.value)) { ok = false; continue; }
      const result = await setFact(orgId, key, d.status, d.value);
      ok = ok && result.ok;
    }
    setState(ok ? 'saved' : 'error');
    if (ok) onSaved();
    return ok;
  };

  const statuses: FactStatus[] = ['known', 'unknown', 'needs_confirmation'];
  return (
    <section style={sectionCard} aria-labelledby="profile-facts">
      <div>
        <h2 id="profile-facts" style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px', color: 'var(--ds-text-heading)' }}>{t('sme.profile.section.regulatory')}</h2>
        <p style={note}>{t('sme.profile.regulatoryNote')}</p>
      </div>
      {OWNER_FACT_KEYS.map(key => {
        const d = drafts[key];
        return (
          <fieldset key={key} style={{ border: 'none', padding: '10px 0', margin: 0, borderTop: '1px solid var(--ds-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <legend style={{ fontSize: '14px', color: 'var(--ds-text-heading)', padding: 0, marginBottom: '6px' }}>{t(factLabelKey(key))}</legend>
            <div role="radiogroup" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {statuses.map(s => (
                <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--ds-text-body)', cursor: 'pointer' }}>
                  <input type="radio" name={`fact-${key}`} checked={d.status === s} onChange={() => setDrafts({ ...drafts, [key]: { ...d, status: s } })} />
                  {t(`sme.profile.factStatus.${s}`)}
                </label>
              ))}
            </div>
            {d.status === 'known' && <FactValueInput factKey={key} value={d.value} onChange={v => setDrafts({ ...drafts, [key]: { ...d, value: v } })} />}
          </fieldset>
        );
      })}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button type="button" style={primaryButton} disabled={state === 'saving'} onClick={save}>{saveLabel ?? t('sme.profile.save')}</button>
        <SaveStatus state={state} />
      </div>
    </section>
  );
}

// ── Data-use consent ─────────────────────────────────────────

export function ConsentSection({ orgId, bundle, onSaved }: SectionProps) {
  const { t } = useT();
  const [granted, setGranted] = useState(bundle.consents);
  const [error, setError] = useState(false);

  const toggle = async (purpose: (typeof DATA_USE_PURPOSES)[number], grant: boolean) => {
    setError(false);
    const result = await setConsent(orgId, purpose, grant);
    if (!result.ok) { setError(true); return; }
    setGranted({ ...granted, [purpose]: grant });
    onSaved();
  };

  return (
    <section style={sectionCard} aria-labelledby="profile-consent">
      <div>
        <h2 id="profile-consent" style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px', color: 'var(--ds-text-heading)' }}>{t('sme.profile.section.consent')}</h2>
        <p style={note}>{t('sme.consent.note')}</p>
      </div>
      {DATA_USE_PURPOSES.map(purpose => (
        <label key={purpose} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--ds-text-body)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!granted[purpose]} onChange={e => toggle(purpose, e.target.checked)} />
          {t(`sme.consent.${purpose}`)}
        </label>
      ))}
      {error && <span role="alert" style={{ fontSize: '13px', color: 'var(--ds-error-text)' }}>{t('sme.profile.error')}</span>}
    </section>
  );
}
