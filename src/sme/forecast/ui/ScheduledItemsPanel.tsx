'use client';

import { useState } from 'react';
import { smeApi, errorText } from '@/sme/api/client';
import { Chip, Field, FormError, card, formGrid, input, muted, parseAmount, primaryButton, secondaryButton, useIdempotencyKey, type CategoryOption } from '@/sme/ledger/ui/shared';
import { toMajorString, money } from '@/sme/money';
import type { ScheduledItemRow } from '../api/types';
import { useForecastText } from './text';

const RECURRENCES = ['none', 'weekly', 'monthly', 'quarterly', 'annually'] as const;
type Draft = { label: string; direction: 'in' | 'out'; amount: string; start: string; recurrence: (typeof RECURRENCES)[number]; end: string; categoryId: string; estimate: boolean };
const blank = (today: string): Draft => ({ label: '', direction: 'out', amount: '', start: today, recurrence: 'monthly', end: '', categoryId: '', estimate: false });

export function ScheduledItemsPanel({ orgId, today, items, categories, canChange, onChanged }: {
  orgId: string;
  today: string;
  items: ScheduledItemRow[];
  categories: CategoryOption[];
  canChange: boolean;
  onChanged: () => void;
}) {
  const F = useForecastText();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useIdempotencyKey();
  const usable = categories.filter(c => c.kind === 'income' || c.kind === 'expense' || c.kind === 'tax' || c.kind === 'financing');

  const startEdit = (item: ScheduledItemRow | null) => {
    key.rotate();
    setError(null);
    setEditing(item ? {
      id: item.id,
      draft: {
        label: item.label, direction: item.direction, amount: toMajorString(money(BigInt(item.amount_minor), 'JOD')), start: item.start_date,
        recurrence: item.recurrence, end: item.end_date ?? '', categoryId: item.category_id ?? '', estimate: item.is_estimate,
      },
    } : { id: null, draft: blank(today) });
  };

  const save = async () => {
    if (!editing) return;
    const d = editing.draft;
    const amount = parseAmount(d.amount, 'JOD');
    if (!d.label.trim() || amount === null || amount <= 0n || !d.start) { setError(F.t('forecast.scheduled.invalid')); return; }
    setBusy(true);
    const res = await smeApi(editing.id ? `scheduled-items/${editing.id}` : 'scheduled-items', {
      orgId, method: 'POST', idempotencyKey: key.current(),
      body: {
        label: d.label.trim(), direction: d.direction, amount_minor: amount.toString(), start_date: d.start, recurrence: d.recurrence,
        end_date: d.end || null, category_id: d.categoryId || null, is_estimate: d.estimate,
      },
    });
    setBusy(false);
    if (!res.ok) { setError(errorText(res.error, F.intl.locale)); return; }
    key.rotate();
    setEditing(null);
    onChanged();
  };

  const archive = async (id: string) => {
    setBusy(true);
    const res = await smeApi(`scheduled-items/${id}/archive`, { orgId, method: 'POST' });
    setBusy(false);
    if (!res.ok) { setError(errorText(res.error, F.intl.locale)); return; }
    onChanged();
  };

  const set = (patch: Partial<Draft>) => setEditing(e => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px' }} aria-labelledby="forecast-scheduled">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
        <h2 id="forecast-scheduled" style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{F.t('forecast.scheduled.title')}</h2>
        {canChange && !editing && <button type="button" style={primaryButton} onClick={() => startEdit(null)}>{F.t('forecast.scheduled.add')}</button>}
      </div>
      <p style={muted}>{F.t('forecast.scheduled.description')}</p>

      {editing && (
        <form onSubmit={e => { e.preventDefault(); void save(); }} style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', borderRadius: '12px', background: 'var(--ds-bg-tinted)' }}>
          <div style={formGrid}>
            <Field text={F.t('forecast.scheduled.label')}><input style={input} value={editing.draft.label} maxLength={120} onChange={e => set({ label: e.target.value })} /></Field>
            <Field text={F.t('forecast.scheduled.direction')}>
              <select style={input} value={editing.draft.direction} onChange={e => set({ direction: e.target.value as Draft['direction'] })}>
                <option value="out">{F.t('forecast.scheduled.out')}</option>
                <option value="in">{F.t('forecast.scheduled.in')}</option>
              </select>
            </Field>
            <Field text={F.t('forecast.scheduled.amount')}><input style={input} inputMode="decimal" value={editing.draft.amount} onChange={e => set({ amount: e.target.value })} /></Field>
            <Field text={F.t('forecast.scheduled.startDate')}><input style={input} type="date" value={editing.draft.start} onChange={e => set({ start: e.target.value })} /></Field>
            <Field text={F.t('forecast.scheduled.recurrence')}>
              <select style={input} value={editing.draft.recurrence} onChange={e => set({ recurrence: e.target.value as Draft['recurrence'] })}>
                {RECURRENCES.map(r => <option key={r} value={r}>{F.t(`forecast.recurrence.${r}`)}</option>)}
              </select>
            </Field>
            {editing.draft.recurrence !== 'none' && (
              <Field text={F.t('forecast.scheduled.endDate')}><input style={input} type="date" value={editing.draft.end} min={editing.draft.start} onChange={e => set({ end: e.target.value })} /></Field>
            )}
            <Field text={F.t('forecast.scheduled.category')}>
              <select style={input} value={editing.draft.categoryId} onChange={e => set({ categoryId: e.target.value })}>
                <option value="">{F.t('forecast.scheduled.noCategory')}</option>
                {usable.map(c => <option key={c.id} value={c.id}>{F.localName(c.nameEn, c.nameAr)}</option>)}
              </select>
            </Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--ds-text-body)' }}>
            <input type="checkbox" checked={editing.draft.estimate} onChange={e => set({ estimate: e.target.checked })} />
            {F.t('forecast.scheduled.estimate')}
          </label>
          <FormError message={error} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" style={primaryButton} disabled={busy}>{F.t('forecast.scheduled.save')}</button>
            <button type="button" style={secondaryButton} onClick={() => setEditing(null)}>{F.t('forecast.scheduled.cancel')}</button>
          </div>
        </form>
      )}

      {items.length === 0 && !editing ? <p style={{ ...muted, fontSize: '13px' }}>{F.t('forecast.scheduled.empty')}</p> : (
        <ul data-testid="scheduled-items" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {items.map(i => (
            <li key={i.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', fontSize: '13px' }}>
              <span style={{ flex: '1 1 140px', overflowWrap: 'anywhere', color: 'var(--ds-text-body)' }}>{i.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{i.direction === 'in' ? '+' : '−'}{F.jod(i.amount_minor)}</span>
              <span style={muted}>
                {F.t('forecast.scheduled.schedule', { recurrence: F.t(`forecast.recurrence.${i.recurrence}`), date: F.date(i.start_date) })}
                {i.end_date ? ` · ${F.t('forecast.scheduled.until', { date: F.date(i.end_date) })}` : ''}
              </span>
              {i.is_estimate && <Chip tone="warning">{F.t('forecast.line.estimate')}</Chip>}
              {canChange && (
                <>
                  <button type="button" style={{ ...secondaryButton, padding: '3px 9px', fontSize: '12px' }} onClick={() => startEdit(i)}>{F.t('forecast.scheduled.edit')}</button>
                  <button type="button" style={{ ...secondaryButton, padding: '3px 9px', fontSize: '12px' }} disabled={busy} onClick={() => void archive(i.id)}>{F.t('forecast.scheduled.archive')}</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!editing && <FormError message={error} />}
    </section>
  );
}

export function BufferPanel({ orgId, bufferMinor, onChanged }: { orgId: string; bufferMinor: string; onChanged: () => void }) {
  const F = useForecastText();
  const [text, setText] = useState(() => toMajorString(money(BigInt(bufferMinor), 'JOD')));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useIdempotencyKey();

  const save = async () => {
    const amount = parseAmount(text, 'JOD');
    if (amount === null || amount < 0n) { setError(F.t('forecast.buffer.invalid')); return; }
    setBusy(true);
    const res = await smeApi('forecast-settings', { orgId, method: 'POST', idempotencyKey: key.current(), body: { buffer_minor: amount.toString() } });
    setBusy(false);
    if (!res.ok) { setError(errorText(res.error, F.intl.locale)); return; }
    key.rotate();
    setError(null);
    onChanged();
  };

  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }} aria-labelledby="forecast-buffer">
      <h2 id="forecast-buffer" style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{F.t('forecast.buffer.title')}</h2>
      <p style={muted}>{F.t('forecast.buffer.description')}</p>
      <form onSubmit={e => { e.preventDefault(); void save(); }} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '8px' }}>
        <Field text={F.t('forecast.buffer.amount')}><input style={{ ...input, maxWidth: '200px' }} inputMode="decimal" value={text} onChange={e => setText(e.target.value)} /></Field>
        <button type="submit" style={secondaryButton} disabled={busy}>{F.t('forecast.buffer.save')}</button>
      </form>
      <FormError message={error} />
    </section>
  );
}
