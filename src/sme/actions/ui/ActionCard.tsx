'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, Info } from 'lucide-react';
import { useOrgPermission } from '@/store/orgStore';
import { smeApi, errorText, type SmeResult } from '@/sme/api/client';
import { Chip, FormError, card, input, muted, primaryButton, secondaryButton, type CategoryOption } from '@/sme/ledger/ui/shared';
import { ReminderPanel } from './ReminderPanel';
import { actionHref, useActionText, type ActionRow } from './text';

const TONE = {
  critical: { color: 'var(--ds-error-text)', bg: 'var(--ds-error-bg)', icon: AlertTriangle },
  warning: { color: 'var(--ds-warning-text)', bg: 'var(--ds-warning-bg)', icon: Clock },
  info: { color: 'var(--ds-text-muted)', bg: 'var(--ds-bg-tinted)', icon: Info },
} as const;
const small: React.CSSProperties = { ...secondaryButton, padding: '5px 10px', fontSize: '12px' };

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/** One action: what, why (the figures), and what to do about it. */
export function ActionCard({ orgId, action, categories, onChanged }: { orgId: string; action: ActionRow; categories: CategoryOption[]; onChanged: () => void }) {
  const A = useActionText(categories);
  const canTask = useOrgPermission('tasks.write');
  const [panel, setPanel] = useState<'none' | 'snooze' | 'dismiss' | 'reminder'>('none');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tone = TONE[action.severity];
  const Icon = tone.icon;
  const href = actionHref(action);
  const open = action.status === 'open' || action.status === 'snoozed';

  const run = async (call: () => Promise<SmeResult<unknown>>) => {
    setBusy(true);
    setError(null);
    const res = await call();
    setBusy(false);
    if (!res.ok) { setError(errorText(res.error, A.intl.locale)); return; }
    setPanel('none');
    onChanged();
  };
  const decide = (decision: string, extra: Record<string, unknown> = {}) =>
    run(() => smeApi(`actions/${action.id}/decision`, { orgId, method: 'POST', body: { decision, ...extra } }));

  const decided = action.status === 'resolved'
    ? (action.decision_reason === 'condition_cleared' ? A.t('actions.decided.cleared') : A.t('actions.decided.resolved'))
    : action.status === 'dismissed' ? A.t('actions.decided.dismissed', { reason: action.decision_reason ?? '' }) : null;

  return (
    <article data-testid="action-card" data-rule={action.rule_code} data-severity={action.severity}
      style={{ ...card, display: 'flex', flexDirection: 'column', gap: '10px', borderInlineStart: `4px solid ${tone.color}` }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        <span aria-hidden style={{ display: 'inline-flex', width: '30px', height: '30px', flex: 'none', borderRadius: '8px', alignItems: 'center', justifyContent: 'center', background: tone.bg, color: tone.color }}>
          <Icon size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            <Chip tone={action.severity === 'info' ? 'info' : 'warning'}>{A.t(`actions.severity.${action.severity}`)}</Chip>
            {action.status === 'snoozed' && action.snooze_until && <Chip tone="info">{A.t('actions.snoozedUntil', { date: A.date(action.snooze_until.slice(0, 10)) })}</Chip>}
            {decided && <Chip tone="info">{decided}</Chip>}
          </div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)', overflowWrap: 'anywhere' }}>{A.title(action)}</h3>
          <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.6, color: 'var(--ds-text-body)' }}>{A.body(action)}</p>
        </div>
      </div>

      {action.evidence.length > 0 && (
        <dl aria-label={A.t('actions.evidence.title')} style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: '13px' }}>
          {action.evidence.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: '6px' }}>
              <dt style={{ color: 'var(--ds-text-muted)' }}>{A.t(e.label_key)}</dt>
              <dd style={{ margin: 0, fontWeight: 600, color: 'var(--ds-text-heading)', fontVariantNumeric: 'tabular-nums' }}>{A.evidenceValue(e)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        {open && action.rule_code === 'receivable_overdue' && action.subject_id && (
          <button type="button" style={{ ...primaryButton, padding: '6px 12px' }} onClick={() => setPanel(panel === 'reminder' ? 'none' : 'reminder')}>{A.t('actions.reminder')}</button>
        )}
        {href && <Link href={href} style={{ ...small, textDecoration: 'none' }}>{A.t('actions.evidence.open')}</Link>}
        {open && (
          <>
            <button type="button" style={small} disabled={busy} onClick={() => setPanel(panel === 'snooze' ? 'none' : 'snooze')}>{A.t('actions.snooze')}</button>
            <button type="button" style={small} disabled={busy} onClick={() => void decide('resolve')}>{A.t('actions.resolve')}</button>
            <button type="button" style={small} disabled={busy} onClick={() => setPanel(panel === 'dismiss' ? 'none' : 'dismiss')}>{A.t('actions.dismiss')}</button>
            {canTask && !action.crm_task_id && (
              <button type="button" style={small} disabled={busy}
                onClick={() => void run(() => smeApi(`actions/${action.id}/task`, { orgId, method: 'POST', body: { title: A.title(action), due_date: isoIn(1) } }))}>
                {A.t('actions.task')}
              </button>
            )}
          </>
        )}
        {action.crm_task_id && <Link href="/crm/tasks" style={{ ...muted, color: 'var(--ds-primary)' }}>{A.t('actions.task.added')}</Link>}
        {!open && action.decision_reason !== 'condition_cleared' && (
          <button type="button" style={small} disabled={busy} onClick={() => void decide('reopen')}>{A.t('actions.reopen')}</button>
        )}
      </div>

      {panel === 'snooze' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          <button type="button" style={small} disabled={busy} onClick={() => void decide('snooze', { snooze_until: isoIn(1) })}>{A.t('actions.snooze.tomorrow')}</button>
          <button type="button" style={small} disabled={busy} onClick={() => void decide('snooze', { snooze_until: isoIn(7) })}>{A.t('actions.snooze.week')}</button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--ds-text-muted)' }}>
            {A.t('actions.snooze.date')}
            <input type="date" style={{ ...input, width: 'auto', padding: '4px 8px' }} value={date} min={isoIn(1).slice(0, 10)} max={isoIn(90).slice(0, 10)} onChange={e => setDate(e.target.value)} />
          </label>
          <button type="button" style={small} disabled={busy || !date} onClick={() => void decide('snooze', { snooze_until: new Date(`${date}T06:00:00Z`).toISOString() })}>{A.t('actions.snooze.save')}</button>
        </div>
      )}
      {panel === 'dismiss' && (
        <form onSubmit={e => { e.preventDefault(); if (!reason.trim()) { setError(A.t('actions.dismiss.reasonRequired')); return; } void decide('dismiss', { reason: reason.trim() }); }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          <input aria-label={A.t('actions.dismiss.reason')} placeholder={A.t('actions.dismiss.reason')} style={{ ...input, flex: '1 1 220px' }} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
          <button type="submit" style={small} disabled={busy}>{A.t('actions.dismiss.save')}</button>
        </form>
      )}
      {panel === 'reminder' && (
        <ReminderPanel orgId={orgId} action={action} outstandingMinor={String(action.params.amount ?? '0')} onClose={() => setPanel('none')} />
      )}
      <FormError message={error} />
    </article>
  );
}
