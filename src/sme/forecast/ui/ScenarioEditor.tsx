'use client';

import { useMemo, useState } from 'react';
import { smeApi, errorText } from '@/sme/api/client';
import { Field, FormError, asciiDecimal, card, formGrid, input, muted, parseAmount, primaryButton, secondaryButton, useIdempotencyKey } from '@/sme/ledger/ui/shared';
import type { ForecastAssumption, ForecastResult, OverrideType, ScenarioOverride, Wire } from '../domain/types';
import type { ScenarioRow, ScheduledItemRow } from '../api/types';
import { useForecastText } from './text';

const TYPES: OverrideType[] = ['shift_receipts_days', 'move_bill', 'add_item', 'remove_item', 'include_uncertain_receivables', 'revenue_delta_pct', 'payroll_delta_minor'];
const RECURRENCES = ['none', 'weekly', 'monthly', 'quarterly', 'annually'] as const;

interface Draft {
  type: OverrideType;
  days: string; billId: string; date: string; itemId: string; pct: string; amount: string;
  label: string; direction: 'in' | 'out'; recurrence: (typeof RECURRENCES)[number];
}

/** Choices the editor offers, taken from the baseline the scenario changes. */
function useChoices(baseline: Wire<ForecastResult>, items: ScheduledItemRow[]) {
  return useMemo(() => {
    const bills = new Map<string, { label: string; date: string }>();
    for (const w of baseline.weeks) for (const l of w.lines) if (l.source === 'payable' && l.refId) bills.set(l.refId, { label: l.label, date: l.date });
    const removable = [
      ...items.map(i => ({ id: i.id, label: i.label })),
      ...baseline.detectedSeries.filter(s => s.status === 'included').map(s => ({ id: `series:${s.key}`, label: s.label })),
    ];
    return { bills, removable };
  }, [baseline, items]);
}

export function ScenarioEditor({ orgId, today, baseline, items, scenario, handle, onSaved, onCancel }: {
  orgId: string;
  today: string;
  baseline: Wire<ForecastResult>;
  items: ScheduledItemRow[];
  scenario: ScenarioRow | null;
  handle: NonNullable<ForecastAssumption['handle']> | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const F = useForecastText();
  const { bills, removable } = useChoices(baseline, items);
  const [name, setName] = useState(scenario?.name ?? '');
  const [overrides, setOverrides] = useState<ScenarioOverride[]>(scenario?.overrides ?? []);
  const [draft, setDraft] = useState<Draft>(() => ({
    type: handle?.type ?? 'move_bill', days: '7', billId: handle?.type === 'move_bill' ? handle.target ?? '' : '', date: today,
    itemId: handle?.type === 'remove_item' ? handle.target ?? '' : '', pct: '-10', amount: '', label: '', direction: 'in', recurrence: 'none',
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useIdempotencyKey();
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));

  const build = (): ScenarioOverride | null => {
    switch (draft.type) {
      case 'shift_receipts_days': {
        const days = Number(asciiDecimal(draft.days));
        return Number.isInteger(days) && days !== 0 && Math.abs(days) <= 180 ? { type: draft.type, days } : null;
      }
      case 'move_bill': return draft.billId && draft.date ? { type: draft.type, bill_id: draft.billId, new_date: draft.date } : null;
      case 'add_item': {
        const amount = parseAmount(draft.amount, 'JOD');
        return draft.label.trim() && amount !== null && amount > 0n && draft.date
          ? { type: draft.type, label: draft.label.trim(), direction: draft.direction, amount_minor: amount.toString(), date: draft.date, recurrence: draft.recurrence }
          : null;
      }
      case 'remove_item': return draft.itemId ? { type: draft.type, item_id: draft.itemId } : null;
      case 'include_uncertain_receivables': return { type: draft.type };
      case 'revenue_delta_pct': {
        const pct = asciiDecimal(draft.pct);
        return /^-?\d{1,3}(\.\d{1,2})?$/.test(pct) && Number(pct) >= -100 && Number(pct) <= 500 ? { type: draft.type, pct } : null;
      }
      case 'payroll_delta_minor': {
        const negative = asciiDecimal(draft.amount).startsWith('-');
        const amount = parseAmount(asciiDecimal(draft.amount).replace(/^-/, ''), 'JOD');
        return amount !== null && amount > 0n ? { type: draft.type, amount_minor: (negative ? -amount : amount).toString() } : null;
      }
    }
  };

  const add = () => {
    const o = build();
    if (!o) { setError(F.t('forecast.scenario.invalid')); return; }
    setError(null);
    // One change of each kind per bill or item; a new one replaces the old.
    setOverrides(list => [...list.filter(x => !(x.type === o.type && (
      (o.type === 'move_bill' && x.type === 'move_bill' && x.bill_id === o.bill_id)
      || (o.type === 'remove_item' && x.type === 'remove_item' && x.item_id === o.item_id)
      || ['shift_receipts_days', 'include_uncertain_receivables', 'revenue_delta_pct', 'payroll_delta_minor'].includes(o.type)))), o]);
  };

  const summary = (o: ScenarioOverride): string => {
    switch (o.type) {
      case 'shift_receipts_days': return F.t('forecast.scenario.summary.shift_receipts_days', { days: F.number(o.days) });
      case 'move_bill': return F.t('forecast.scenario.summary.move_bill', { bill: bills.get(o.bill_id)?.label ?? '', date: F.date(o.new_date) });
      case 'add_item': return F.t('forecast.scenario.summary.add_item', {
        label: o.label, amount: F.jod(o.amount_minor), direction: F.t(`forecast.scheduled.${o.direction}`),
        recurrence: F.t(`forecast.recurrence.${o.recurrence ?? 'none'}`), date: F.date(o.date),
      });
      case 'remove_item': return F.t('forecast.scenario.summary.remove_item', { label: removable.find(r => r.id === o.item_id)?.label ?? o.item_id });
      case 'include_uncertain_receivables': return F.t('forecast.scenario.summary.include_uncertain_receivables');
      case 'revenue_delta_pct': return F.t('forecast.scenario.summary.revenue_delta_pct', { pct: F.decimal(o.pct) });
      case 'payroll_delta_minor': return F.t('forecast.scenario.summary.payroll_delta_minor', { amount: F.jod(o.amount_minor) });
    }
  };

  const save = async () => {
    if (!name.trim()) { setError(F.t('forecast.scenario.nameRequired')); return; }
    setBusy(true);
    const res = await smeApi<{ scenario: { id: string } }>(scenario ? `scenarios/${scenario.id}` : 'scenarios', {
      orgId, method: 'POST', idempotencyKey: key.current(), body: { name: name.trim(), overrides },
    });
    setBusy(false);
    if (!res.ok) { setError(errorText(res.error, F.intl.locale)); return; }
    key.rotate();
    onSaved(res.data.scenario.id);
  };

  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} aria-labelledby="scenario-editor" data-testid="scenario-editor">
      <h2 id="scenario-editor" style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>
        {F.t(scenario ? 'forecast.scenario.edit' : 'forecast.scenario.new')}
      </h2>
      <Field text={F.t('forecast.scenario.name')}><input style={{ ...input, maxWidth: '360px' }} value={name} maxLength={80} onChange={e => setName(e.target.value)} /></Field>

      <div>
        <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 6px', color: 'var(--ds-text-body)' }}>{F.t('forecast.scenario.changes')}</h3>
        {overrides.length === 0 ? <p style={muted}>{F.t('forecast.scenario.noChanges')}</p> : (
          <ul style={{ margin: 0, paddingInlineStart: '18px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
            {overrides.map((o, n) => (
              <li key={n}>
                {summary(o)}
                <button type="button" style={{ ...secondaryButton, padding: '2px 8px', fontSize: '12px', marginInlineStart: '8px' }}
                  onClick={() => setOverrides(list => list.filter((_, i) => i !== n))}>{F.t('forecast.scenario.remove')}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', borderRadius: '12px', background: 'var(--ds-bg-tinted)' }}>
        <div style={formGrid}>
          <Field text={F.t('forecast.scenario.changeType')}>
            <select style={input} value={draft.type} onChange={e => set({ type: e.target.value as OverrideType })}>
              {TYPES.map(t => <option key={t} value={t}>{F.t(`forecast.scenario.type.${t}`)}</option>)}
            </select>
          </Field>
          {draft.type === 'shift_receipts_days' && (
            <Field text={F.t('forecast.scenario.days')}><input style={input} inputMode="numeric" value={draft.days} onChange={e => set({ days: e.target.value })} /></Field>
          )}
          {draft.type === 'move_bill' && (
            <>
              <Field text={F.t('forecast.scenario.bill')}>
                <select style={input} value={draft.billId} onChange={e => set({ billId: e.target.value })}>
                  <option value="" />
                  {[...bills].map(([id, b]) => <option key={id} value={id}>{b.label} · {F.date(b.date)}</option>)}
                </select>
              </Field>
              <Field text={F.t('forecast.scenario.newDate')}><input style={input} type="date" value={draft.date} min={today} onChange={e => set({ date: e.target.value })} /></Field>
            </>
          )}
          {draft.type === 'add_item' && (
            <>
              <Field text={F.t('forecast.scheduled.label')}><input style={input} value={draft.label} maxLength={120} onChange={e => set({ label: e.target.value })} /></Field>
              <Field text={F.t('forecast.scheduled.direction')}>
                <select style={input} value={draft.direction} onChange={e => set({ direction: e.target.value as Draft['direction'] })}>
                  <option value="in">{F.t('forecast.scheduled.in')}</option>
                  <option value="out">{F.t('forecast.scheduled.out')}</option>
                </select>
              </Field>
              <Field text={F.t('forecast.scheduled.amount')}><input style={input} inputMode="decimal" value={draft.amount} onChange={e => set({ amount: e.target.value })} /></Field>
              <Field text={F.t('forecast.scheduled.startDate')}><input style={input} type="date" value={draft.date} onChange={e => set({ date: e.target.value })} /></Field>
              <Field text={F.t('forecast.scheduled.recurrence')}>
                <select style={input} value={draft.recurrence} onChange={e => set({ recurrence: e.target.value as Draft['recurrence'] })}>
                  {RECURRENCES.map(r => <option key={r} value={r}>{F.t(`forecast.recurrence.${r}`)}</option>)}
                </select>
              </Field>
            </>
          )}
          {draft.type === 'remove_item' && (
            <Field text={F.t('forecast.scenario.item')}>
              <select style={input} value={draft.itemId} onChange={e => set({ itemId: e.target.value })}>
                <option value="" />
                {removable.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </Field>
          )}
          {draft.type === 'revenue_delta_pct' && (
            <Field text={F.t('forecast.scenario.pct')}><input style={input} inputMode="decimal" value={draft.pct} onChange={e => set({ pct: e.target.value })} /></Field>
          )}
          {draft.type === 'payroll_delta_minor' && (
            <Field text={F.t('forecast.scenario.payrollAmount')}><input style={input} inputMode="decimal" value={draft.amount} onChange={e => set({ amount: e.target.value })} /></Field>
          )}
        </div>
        <div><button type="button" style={secondaryButton} onClick={add}>{F.t('forecast.scenario.addChange')}</button></div>
      </div>

      <FormError message={error} />
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" style={primaryButton} disabled={busy} onClick={() => void save()}>{F.t('forecast.scenario.save')}</button>
        <button type="button" style={secondaryButton} onClick={onCancel}>{F.t('forecast.scenario.cancel')}</button>
      </div>
    </section>
  );
}
