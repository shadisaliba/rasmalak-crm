'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { todayInAmman } from '@/sme/ledger/domain/dates';
import { Chip, Field, card, input, muted, secondaryButton, useLedgerReferenceData, useLedgerText } from '@/sme/ledger/ui/shared';
import { KPI_VERSION, type FinancialSummary, type Metric, type Reason } from '@/sme/kpi/domain/summary';
import { REPORT_CODES, type ReportCode, type ReportFormat } from '../domain/render';

type Preset = 'this_month' | 'last_month' | 'last_3_months' | 'this_year' | 'custom';
type Load = { status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; summary: FinancialSummary; computedAt: string };

function presetPeriod(p: Exclude<Preset, 'custom'>, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, 1));
  const monthEnd = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0));
  switch (p) {
    case 'this_month': return { from: iso(monthStart(y, m)), to: iso(monthEnd(y, m)) };
    case 'last_month': return { from: iso(monthStart(y, m - 1)), to: iso(monthEnd(y, m - 1)) };
    case 'last_3_months': return { from: iso(monthStart(y, m - 2)), to: iso(monthEnd(y, m)) };
    case 'this_year': return { from: `${y}-01-01`, to: today };
  }
}

/** POSTs an export and saves the file it returns; nothing else on this page writes. */
async function downloadReport(orgId: string, code: ReportCode, format: ReportFormat, period: { from: string; to: string }, locale: 'ar' | 'en'): Promise<SmeApiError | null> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`/api/sme/v1/reports/${code}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-org-id': orgId, 'idempotency-key': crypto.randomUUID(), 'x-correlation-id': crypto.randomUUID(),
      ...(data.session?.access_token ? { authorization: `Bearer ${data.session.access_token}` } : {}),
    },
    body: JSON.stringify({ format, locale, ...period }),
  }).catch(() => null);
  if (!res) return { code: 'NETWORK', message_en: 'The server could not be reached.', message_ar: 'تعذّر الوصول إلى الخادم.' };
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    return json?.error ?? { code: 'INTERNAL', message_en: 'The report could not be prepared.', message_ar: 'تعذّر تحضير التقرير.' };
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${code}.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}

export function ReportsPage() {
  return (
    <SmeGate permission="sme.ledger.read">
      <ReportsScreen />
    </SmeGate>
  );
}

function ReportsScreen() {
  const L = useLedgerText();
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const canExport = useOrgPermission('sme.reports.export');
  const today = todayInAmman();
  const [preset, setPreset] = useState<Preset>('this_month');
  const [custom, setCustom] = useState(() => presetPeriod('this_month', today));
  const period = useMemo(() => (preset === 'custom' ? custom : presetPeriod(preset, today)), [preset, custom, today]);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    let ignore = false;
    smeApi<{ summary: FinancialSummary; computed_at: string }>(`financial-summary?from=${period.from}&to=${period.to}`, { orgId }).then(res => {
      if (!ignore) setLoad(res.ok ? { status: 'ready', summary: res.data.summary, computedAt: res.data.computed_at } : { status: 'failed', error: res.error });
    });
    return () => { ignore = true; };
  }, [orgId, period, reload]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title={L.t('reports.title')} description={L.t('reports.description')} />

      <section style={{ ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '10px' }} aria-label={L.t('reports.period.label')}>
        <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {(['this_month', 'last_month', 'last_3_months', 'this_year', 'custom'] as const).map(p => (
            <button key={p} type="button" role="tab" aria-selected={preset === p} onClick={() => setPreset(p)}
              style={{ ...secondaryButton, background: preset === p ? 'var(--ds-primary)' : 'transparent', color: preset === p ? 'var(--ds-on-primary)' : 'var(--ds-text-body)', borderColor: preset === p ? 'var(--ds-primary)' : 'var(--ds-border)' }}>
              {L.t(`reports.period.${p}`)}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <CustomPeriod value={custom} onApply={setCustom} />
        )}
        <span style={{ ...muted, marginInlineStart: 'auto' }}>{L.t('reports.period.range', { from: L.date(period.from), to: L.date(period.to) })}</span>
      </section>

      {!orgId || load.status === 'loading' ? <DataState state="loading" />
        : load.status === 'failed' ? <DataState state={load.error.code === 'ACCESS_DENIED' ? 'denied' : 'failed'} message={errorText(load.error, L.intl.locale)} onRetry={() => setReload(k => k + 1)} />
        : <Summary summary={load.summary} computedAt={load.computedAt} />}

      <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }} aria-labelledby="reports-download">
        <h2 id="reports-download" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('reports.download.title')}</h2>
        <p style={muted}>{L.t('reports.download.description')} {L.t('reports.note')}</p>
        {!canExport && <DataState state="denied" message={L.t('reports.download.noPermission')} />}
        {canExport && orgId && (
          <ul data-testid="report-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {REPORT_CODES.map(code => <ReportRowItem key={code} orgId={orgId} code={code} period={period} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function CustomPeriod({ value, onApply }: { value: { from: string; to: string }; onApply: (p: { from: string; to: string }) => void }) {
  const L = useLedgerText();
  const [draft, setDraft] = useState(value);
  return (
    <form onSubmit={e => { e.preventDefault(); if (draft.from && draft.to && draft.from <= draft.to) onApply(draft); }} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-end' }}>
      <Field text={L.t('reports.period.from')}><input type="date" style={input} value={draft.from} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} /></Field>
      <Field text={L.t('reports.period.to')}><input type="date" style={input} value={draft.to} min={draft.from} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} /></Field>
      <button type="submit" style={secondaryButton}>{L.t('reports.period.apply')}</button>
    </form>
  );
}

function ReportRowItem({ orgId, code, period }: { orgId: string; code: ReportCode; period: { from: string; to: string } }) {
  const L = useLedgerText();
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (format: ReportFormat) => {
    setBusy(format);
    setError(null);
    const failure = await downloadReport(orgId, code, format, period, L.uiLocale);
    setBusy(null);
    if (failure) setError(errorText(failure, L.intl.locale));
  };
  return (
    <li data-report={code} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', padding: '10px 0', borderTop: '1px solid var(--ds-border)' }}>
      <div style={{ flex: '1 1 260px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t(`reports.report.${code}`)}</div>
        <div style={muted}>{L.t(`reports.report.${code}.description`)}</div>
        {error && <p role="alert" style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--ds-error-text)' }}>{error}</p>}
      </div>
      {(['pdf', 'xlsx', 'csv'] as const).map(f => (
        <button key={f} type="button" style={{ ...secondaryButton, display: 'inline-flex', alignItems: 'center', gap: '6px' }} disabled={busy !== null} onClick={() => void run(f)}>
          <Download size={14} aria-hidden /> {busy === f ? L.t('reports.download.working') : L.t(`reports.download.${f}`)}
        </button>
      ))}
    </li>
  );
}

const MONEY_METRICS: Metric['key'][] = ['cleared_cash', 'cash_in', 'cash_out', 'net_cash_flow', 'revenue_recognized', 'expenses_recognized', 'profit_estimate', 'receivables_outstanding', 'receivables_overdue', 'payables_due_30d'];

function Summary({ summary, computedAt }: { summary: FinancialSummary; computedAt: string }) {
  const L = useLedgerText();
  const { currentOrg } = useOrg();
  const { categories } = useLedgerReferenceData(currentOrg?.id);
  const m = (key: Metric['key']) => summary.metrics.find(x => x.key === key)!;
  const reason = (r: Reason) => {
    const values = Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'code').map(([k, v]) =>
      [k, k === 'from' || k === 'to' ? L.date(String(v)) : typeof v === 'number' ? L.number(v) : k === 'percent' ? L.decimal(String(v)) : String(v ?? '')]));
    return L.t(`kpi.reason.${r.code}`, values);
  };
  const value = (metric: Metric) => (metric.value === null ? L.t('reports.summary.withheld') : metric.unit === 'JOD' ? L.amount(metric.value, 'JOD') : `${L.decimal(metric.value)}${L.isAr ? '٪' : '%'}`);
  const catName = (code: string) => { const c = categories.find(x => x.code === code); return c ? L.localName(c.nameEn, c.nameAr) : code; };
  const trend = m('cost_trend').breakdown as Array<{ category: string; months: Array<{ month: string; minor: string }>; flagged: string[] }>;

  return (
    <section aria-labelledby="reports-summary" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 12px' }}>
        <h2 id="reports-summary" style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('reports.summary.title')}</h2>
        <span style={muted}>{L.t('reports.summary.calculated', { time: L.dateTime(computedAt) })}</span>
      </div>
      <p style={muted}>{L.t('kpi.proposed', { version: KPI_VERSION })}</p>
      <div data-testid="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
        {[...MONEY_METRICS, 'gross_margin', 'revenue_concentration', 'supplier_concentration'].map(k => {
          const metric = m(k as Metric['key']);
          const alt = (metric.breakdown as { alternative?: { value: string } } | undefined)?.alternative;
          const top3 = (metric.breakdown as { top3_percent?: string } | undefined)?.top3_percent;
          return (
            <article key={k} data-metric={k} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: 'var(--ds-text-muted)' }}>{L.t(`kpi.metric.${k}`)}</h3>
                {metric.status !== 'ok' && <Chip tone="warning">{L.t(`kpi.status.${metric.status}`)}</Chip>}
              </div>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--ds-text-heading)', fontVariantNumeric: 'tabular-nums' }}>{value(metric)}</p>
              {alt && <p style={{ margin: 0, fontSize: '12px', color: 'var(--ds-text-body)' }}>{L.t('kpi.profitInstead', { amount: L.amount(alt.value, 'JOD') })}</p>}
              {top3 && <p style={{ margin: 0, fontSize: '12px', color: 'var(--ds-text-body)' }}>{L.t('kpi.top3', { percent: L.decimal(top3) })}</p>}
              {metric.reasons.length > 0 && (
                <ul style={{ margin: 0, paddingInlineStart: '16px', fontSize: '12px', color: 'var(--ds-warning-text)' }}>
                  {metric.reasons.slice(0, 2).map((r, i) => <li key={i}>{reason(r)}</li>)}
                  {metric.reasons.length > 2 && <li>{L.t('kpi.moreReasons', { count: L.number(metric.reasons.length - 2) })}</li>}
                </ul>
              )}
              <p style={{ ...muted, fontSize: '11px' }}>{L.t(`kpi.basis.${k}`)}</p>
            </article>
          );
        })}
      </div>
      {trend.length > 0 && (
        <section style={{ ...card, padding: 0, overflowX: 'auto', position: 'relative' }} aria-labelledby="kpi-trend">
          <h3 id="kpi-trend" style={{ margin: 0, padding: '12px 14px 4px', fontSize: '14px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('kpi.metric.cost_trend')}</h3>
          <p style={{ ...muted, padding: '0 14px 6px' }}>{L.t('kpi.basis.cost_trend')}</p>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px', color: 'var(--ds-text-body)' }}>
            <thead>
              <tr>
                <th style={{ padding: '6px 10px', textAlign: 'start' }}>{L.t('reports.col.category')}</th>
                {trend[0].months.map(mo => <th key={mo.month} style={{ padding: '6px 10px', textAlign: 'end', whiteSpace: 'nowrap' }}>{L.intl.formatDate(new Date(`${mo.month}-01T00:00:00Z`), { timeZone: 'UTC', month: 'short', year: '2-digit' })}</th>)}
              </tr>
            </thead>
            <tbody>
              {trend.map(row => (
                <tr key={row.category} style={{ borderTop: '1px solid var(--ds-border)' }}>
                  <td style={{ padding: '6px 10px' }}>{catName(row.category)}</td>
                  {row.months.map(mo => (
                    <td key={mo.month} style={{ padding: '6px 10px', textAlign: 'end', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: row.flagged.includes(mo.month) ? 'var(--ds-warning-text)' : undefined, fontWeight: row.flagged.includes(mo.month) ? 600 : undefined }}>
                      {L.amount(mo.minor, 'JOD')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </section>
  );
}
