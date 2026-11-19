'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { CHANNELS } from '@/sme/ledger/api/schemas';
import {
  CATEGORY_KIND_ORDER, Chip, Field, FormError, allowedCategories, card, input, muted, parseAmount, primaryButton,
  secondaryButton, useIdempotencyKey, useLedgerReferenceData, useLedgerText, type CategoryOption,
} from '@/sme/ledger/ui/shared';
import { toMajorString, isCurrencyCode, money } from '@/sme/money';
import type { RowStatus } from '../api/schemas';

interface Batch {
  id: string; account_id: string; file_name: string; status: string; row_count: number | null;
  error_code: string | null; error_detail: { reason?: string } | null; committed_at: string | null; created_at: string;
}
interface Summary { counts: Partial<Record<RowStatus, number>>; pending: number; accepted_total_minor: string }
interface Detail { batch: Batch; account: { id: string; name: string; name_ar: string | null; currency: string } | null; summary: Summary }
interface Row {
  id: string; row_number: number; value_date: string | null; amount_minor: string | null; currency: string; description: string;
  external_ref: string | null; category_id: string | null; suggested_category_id: string | null; channel: string | null;
  status: RowStatus; issues: Array<{ field: string; code: string }>; override_reason: string | null;
}

const TABS: Record<string, RowStatus[] | null> = {
  attention: ['invalid', 'duplicate_existing', 'duplicate_suspected', 'duplicate_in_file'],
  valid: ['valid'],
  accepted: ['accepted'],
  excluded: ['excluded'],
  all: null,
};
const DUPLICATES: RowStatus[] = ['duplicate_existing', 'duplicate_suspected', 'duplicate_in_file'];
const PAGE = 100;

export function ImportReviewPage() {
  const L = useLedgerText();
  const router = useRouter();
  const { batchId } = useParams<{ batchId: string }>();
  const { currentOrg } = useOrg();
  const canPost = useOrgPermission('sme.ledger.post');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<SmeApiError | null>(null);
  const [tab, setTab] = useState<keyof typeof TABS>('attention');
  const [rows, setRows] = useState<{ items: Row[]; total: number; for: string } | null>(null);
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [polls, setPolls] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useLedgerReferenceData(currentOrg?.id);
  const commitKey = useIdempotencyKey();
  const reload = () => setReloadKey(k => k + 1);
  const orgId = currentOrg?.id;

  useEffect(() => {
    if (!orgId) return;
    let ignore = false;
    smeApi<Detail>(`import-batches/${batchId}`, { orgId }).then(r => {
      if (ignore) return;
      if (r.ok) { setDetail(r.data); setLoadError(null); } else setLoadError(r.error);
    });
    return () => { ignore = true; };
  }, [orgId, batchId, reloadKey, polls]);

  // While the worker reads the file, check again every 1.5 s for up to two minutes.
  const parsing = detail?.batch.status === 'parsing';
  useEffect(() => {
    if (!parsing || polls > 80) return;
    const timer = setTimeout(() => setPolls(p => p + 1), 1500);
    return () => clearTimeout(timer);
  }, [parsing, polls]);

  const inReview = detail?.batch.status === 'in_review';
  const rowsKey = `${tab}|${offset}|${reloadKey}|${detail?.batch.status}`;
  useEffect(() => {
    if (!orgId || !inReview) return;
    let ignore = false;
    const statuses = TABS[tab];
    const qs = new URLSearchParams({ offset: String(offset), limit: String(PAGE), ...(statuses ? { status: statuses.join(',') } : {}) });
    smeApi<{ items: Row[]; total: number }>(`import-batches/${batchId}/rows?${qs}`, { orgId }).then(r => {
      if (!ignore && r.ok) setRows({ ...r.data, for: rowsKey });
    });
    return () => { ignore = true; };
  }, [orgId, batchId, inReview, tab, offset, rowsKey]);

  const review = async (body: Record<string, unknown>) => {
    if (!orgId) return false;
    setActionError(null);
    const r = await smeApi(`import-batches/${batchId}/rows`, { orgId, method: 'POST', body });
    if (!r.ok) { setActionError(errorText(r.error, L.intl.locale)); return false; }
    reload();
    return true;
  };

  const commit = async () => {
    if (!orgId) return;
    setBusy(true);
    setActionError(null);
    const r = await smeApi(`import-batches/${batchId}/confirm`, { orgId, method: 'POST', idempotencyKey: commitKey.current() });
    setBusy(false);
    if (!r.ok) { setActionError(errorText(r.error, L.intl.locale)); reload(); return; }
    commitKey.rotate();
    reload();
  };

  const cancel = async () => {
    if (!orgId) return;
    const r = await smeApi(`import-batches/${batchId}/cancel`, { orgId, method: 'POST' });
    if (!r.ok) return setActionError(errorText(r.error, L.intl.locale));
    router.push('/crm/money/transactions');
  };

  const b = detail?.batch;
  const accountName = detail?.account ? L.localName(detail.account.name, detail.account.name_ar) : '';
  const currency = detail?.account?.currency ?? 'JOD';
  const counts = detail?.summary.counts ?? {};
  const accepted = counts.accepted ?? 0;
  const canCommit = !!detail && detail.summary.pending === 0 && accepted > 0 && canPost && !busy;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader back={{ href: '/crm/money/transactions', label: L.t('sme.import.back') }} title={L.t('sme.import.review.title')}
        description={b ? L.t('sme.import.review.subtitle', { file: b.file_name, account: accountName }) : undefined} />
      <SmeGate permission="sme.imports.execute">
        {loadError ? (
          <DataState state="failed" message={errorText(loadError, L.intl.locale)} onRetry={reload} />
        ) : !b ? (
          <DataState state="loading" />
        ) : b.status === 'parsing' || b.status === 'uploaded' ? (
          <DataState state="loading" message={polls > 80 ? L.t('sme.import.review.slow') : L.t('sme.import.review.parsing')} />
        ) : b.status === 'failed' ? (
          <DataState state="failed" message={L.t(`sme.import.failure.${b.error_detail?.reason ?? 'generic'}`)}
            action={<Link href={`/crm/money/transactions/import?account=${b.account_id}`} style={{ fontSize: '13px', color: 'inherit', fontWeight: 500 }}>{L.t('sme.import.startAgain')}</Link>} />
        ) : b.status === 'cancelled' ? (
          <DataState state="empty" message={L.t('sme.import.review.cancelled')} />
        ) : b.status === 'committed' ? (
          <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} role="status">
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{L.t('sme.import.review.committedTitle')}</h2>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--ds-text-body)' }} data-testid="committed-summary">
              {L.t('sme.import.review.committedBody', { posted: accepted, excluded: counts.excluded ?? 0, invalid: counts.invalid ?? 0, date: L.dateTime(b.committed_at) })}
            </p>
            <Link href={`/crm/money/transactions?account=${b.account_id}`} style={{ fontSize: '13px', color: 'var(--ds-primary)', fontWeight: 500 }}>{L.t('sme.import.review.viewTransactions')}</Link>
          </section>
        ) : (
          <>
            {b.error_code && <DataState state="partial" message={L.t('sme.import.review.lastCommitFailed')} />}
            <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-label={L.t('sme.import.review.summary')}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} data-testid="import-counts">
                {(Object.keys(counts) as RowStatus[]).map(s => (
                  <Chip key={s} tone={s === 'invalid' || DUPLICATES.includes(s) ? 'warning' : 'neutral'}>{L.t(`sme.import.status.${s}`)}: {L.number(counts[s] ?? 0)}</Chip>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--ds-text-body)' }}>
                {detail.summary.pending > 0
                  ? L.t('sme.import.review.pending', { count: detail.summary.pending })
                  : L.t('sme.import.review.ready', { count: accepted, amount: L.amount(detail.summary.accepted_total_minor, currency, { signDisplay: 'always' }) })}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button type="button" style={secondaryButton} onClick={() => review({ bulk: 'accept_valid' })}>{L.t('sme.import.review.acceptValid')}</button>
                <button type="button" style={secondaryButton} onClick={() => review({ bulk: 'reset' })}>{L.t('sme.import.review.reset')}</button>
                <button type="button" style={{ ...primaryButton, opacity: canCommit ? 1 : 0.6 }} disabled={!canCommit} onClick={commit}>
                  {L.t('sme.import.review.commit', { count: accepted })}
                </button>
                <button type="button" style={secondaryButton} onClick={cancel}>{L.t('sme.import.review.cancel')}</button>
              </div>
              {!canPost && <p style={muted}>{L.t('sme.import.review.noPostPermission')}</p>}
              <FormError message={actionError} />
            </section>

            <div role="tablist" aria-label={L.t('sme.import.review.filter')} style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {Object.keys(TABS).map(key => (
                <button key={key} role="tab" aria-selected={tab === key} type="button"
                  style={{ ...secondaryButton, background: tab === key ? 'var(--ds-bg-tinted)' : 'transparent', fontWeight: tab === key ? 600 : 400 }}
                  onClick={() => { setTab(key as keyof typeof TABS); setOffset(0); }}>
                  {L.t(`sme.import.tab.${key}`)}
                </button>
              ))}
            </div>

            {!rows || rows.for !== rowsKey ? <DataState state="loading" /> : rows.items.length === 0 ? (
              <DataState state="empty" message={L.t('sme.import.review.noRowsHere')} />
            ) : (
              <>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {rows.items.map(row => <ImportRow key={`${row.id}|${row.status}|${row.value_date}|${row.amount_minor}|${row.category_id}|${row.channel}`} row={row} currency={currency} categories={refs.categories} onReview={review} />)}
                </ul>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {offset > 0 && <button type="button" style={secondaryButton} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{L.t('sme.import.review.previous')}</button>}
                  <span style={muted}>{L.t('sme.import.review.range', { from: offset + 1, to: offset + rows.items.length, total: rows.total })}</span>
                  {offset + PAGE < rows.total && <button type="button" style={secondaryButton} onClick={() => setOffset(offset + PAGE)}>{L.t('sme.import.review.next')}</button>}
                </div>
              </>
            )}
          </>
        )}
      </SmeGate>
    </div>
  );
}

function CategorySelect({ categories, value, onChange }: { categories: CategoryOption[]; value: string; onChange: (v: string) => void }) {
  const L = useLedgerText();
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={input}>
      <option value="">{L.t('sme.money.tx.uncategorised')}</option>
      {CATEGORY_KIND_ORDER.map(kind => {
        const group = categories.filter(c => c.kind === kind);
        return group.length ? (
          <optgroup key={kind} label={L.t(`sme.categoryKind.${kind}`)}>
            {group.map(c => <option key={c.id} value={c.id}>{L.localName(c.nameEn, c.nameAr)}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

function ImportRow({ row, currency, categories, onReview }: {
  row: Row; currency: string; categories: CategoryOption[]; onReview: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const L = useLedgerText();
  const majorOf = (minor: string | null) => (minor !== null && isCurrencyCode(currency) ? toMajorString(money(BigInt(minor), currency)) : '');
  const [date, setDate] = useState(row.value_date ?? '');
  const [amount, setAmount] = useState(majorOf(row.amount_minor));
  const [category, setCategory] = useState(row.category_id ?? '');
  const [channel, setChannel] = useState(row.channel ?? 'unknown');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const duplicate = DUPLICATES.includes(row.status);
  const amountMinor = parseAmount(amount, currency);
  const edits: Record<string, unknown> = {};
  if (date !== (row.value_date ?? '')) edits.value_date = date || null;
  if (amount !== majorOf(row.amount_minor)) edits.amount_minor = amountMinor === null ? null : amountMinor.toString();
  if (category !== (row.category_id ?? '')) edits.category_id = category || null;
  if (channel !== (row.channel ?? 'unknown')) edits.channel = channel;
  const changed = Object.keys(edits).length > 0;

  const send = async (action?: 'accept' | 'exclude') => {
    setError(null);
    if (amount.trim() && amountMinor === null) return setError(L.t('sme.money.form.invalidAmount'));
    if (action === 'accept' && duplicate && !reason.trim()) return setError(L.t('sme.import.row.reasonRequired'));
    await onReview({ changes: [{ row_id: row.id, ...edits, ...(action ? { action } : {}), ...(action === 'accept' && duplicate ? { override_reason: reason.trim() } : {}) }] });
  };

  const tone = row.status === 'invalid' || duplicate ? 'warning' : row.status === 'excluded' ? 'info' : 'neutral';
  return (
    <li style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px', opacity: row.status === 'excluded' ? 0.75 : 1 }} data-testid="import-row">
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={muted}>{L.t('sme.import.rowN', { n: row.row_number })}</span>
        <Chip tone={tone}>{L.t(`sme.import.status.${row.status}`)}</Chip>
        <span style={{ flex: 1, minWidth: '160px', fontSize: '14px', color: 'var(--ds-text-heading)', overflowWrap: 'anywhere' }}>{row.description || L.t('sme.money.tx.noDescription')}</span>
        {row.amount_minor !== null && <span style={{ fontWeight: 600, fontSize: '14px' }}>{L.amount(row.amount_minor, currency, { signDisplay: 'always' })}</span>}
      </div>
      {row.issues.length > 0 && <p style={{ margin: 0, fontSize: '12px', color: 'var(--ds-error-text)' }}>{row.issues.map(i => L.t(`sme.import.issue.${i.field}.${i.code}`)).join(' · ')}</p>}
      {duplicate && <p style={{ margin: 0, fontSize: '12px', color: 'var(--ds-warning-text)' }}>{L.t(`sme.import.duplicateHelp.${row.status}`)}</p>}
      {row.override_reason && <p style={muted}>{L.t('sme.import.row.overridden', { reason: row.override_reason })}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
        <Field text={L.t('sme.money.form.date')}><input type="date" value={date} onChange={e => setDate(e.target.value)} style={input} /></Field>
        <Field text={L.t('sme.money.form.amountIn', { currency })}><input value={amount} inputMode="decimal" dir="ltr" onChange={e => setAmount(e.target.value)} style={input} /></Field>
        <Field text={L.t('sme.money.tx.category')}><CategorySelect categories={allowedCategories(categories, 'import')} value={category} onChange={setCategory} /></Field>
        <Field text={L.t('sme.money.tx.channel')}>
          <select value={channel} onChange={e => setChannel(e.target.value)} style={input}>
            {CHANNELS.map(c => <option key={c} value={c}>{L.t(`sme.channel.${c}`)}</option>)}
          </select>
        </Field>
      </div>
      {duplicate && (
        <Field text={L.t('sme.import.row.reason')}><input value={reason} onChange={e => setReason(e.target.value)} style={input} /></Field>
      )}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {changed && <button type="button" style={secondaryButton} onClick={() => send()}>{L.t('sme.import.row.save')}</button>}
        {row.status !== 'accepted' && row.status !== 'invalid' && <button type="button" style={secondaryButton} onClick={() => send('accept')}>{L.t('sme.import.row.include')}</button>}
        {row.status !== 'excluded' && <button type="button" style={secondaryButton} onClick={() => send('exclude')}>{L.t('sme.import.row.exclude')}</button>}
      </div>
      <FormError message={error} />
    </li>
  );
}
