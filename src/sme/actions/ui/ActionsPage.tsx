'use client';

import { useEffect, useState } from 'react';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { smeApi, errorText, type SmeApiError } from '@/sme/api/client';
import { DataState } from '@/sme/ui/DataState';
import { PageHeader } from '@/sme/ui/PageHeader';
import { SmeGate } from '@/sme/profile/ui/SmeGate';
import { Field, card, input, muted, secondaryButton, useIdempotencyKey, useLedgerReferenceData } from '@/sme/ledger/ui/shared';
import { ActionCard } from './ActionCard';
import { useActionText, type ActionRow } from './text';

type View = 'open' | 'snoozed' | 'done';
type Load = { status: 'loading' } | { status: 'failed'; error: SmeApiError } | { status: 'ready'; items: ActionRow[]; evaluatedAt: string | null; checking: boolean };

/** Loads one view of the actions; when the server is re-checking, reloads once it is likely done. */
export function useActions(orgId: string | undefined, view: View, limit = 100) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!orgId) return;
    let ignore = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    smeApi<{ items: ActionRow[]; evaluated_at: string | null; checking: boolean }>(`actions?view=${view}&limit=${limit}`, { orgId }).then(res => {
      if (ignore) return;
      setLoad(res.ok ? { status: 'ready', items: res.data.items, evaluatedAt: res.data.evaluated_at, checking: res.data.checking } : { status: 'failed', error: res.error });
      if (res.ok && res.data.checking) timer = setTimeout(() => setReload(k => k + 1), 6000);
    });
    return () => { ignore = true; if (timer) clearTimeout(timer); };
  }, [orgId, view, limit, reload]);
  return { load, refresh: () => setReload(k => k + 1) };
}

export function ActionsPage() {
  return (
    <SmeGate permission="sme.ledger.read">
      <ActionsScreen />
    </SmeGate>
  );
}

function ActionsScreen() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const { categories } = useLedgerReferenceData(orgId);
  const A = useActionText(categories);
  const canSettings = useOrgPermission('sme.profile.manage');
  const [view, setView] = useState<View>('open');
  const { load, refresh } = useActions(orgId, view);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title={A.t('actions.title')} description={A.t('actions.description')}
        badge={load.status === 'ready' && (load.checking || load.evaluatedAt)
          ? <span style={muted}>{load.checking ? A.t('actions.checking') : A.t('actions.lastChecked', { time: A.dateTime(load.evaluatedAt) })}</span>
          : undefined} />

      <div role="tablist" style={{ display: 'flex', gap: '6px' }}>
        {(['open', 'snoozed', 'done'] as const).map(v => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            style={{ ...secondaryButton, background: view === v ? 'var(--ds-primary)' : 'transparent', color: view === v ? 'var(--ds-on-primary)' : 'var(--ds-text-body)', borderColor: view === v ? 'var(--ds-primary)' : 'var(--ds-border)' }}>
            {A.t(`actions.filter.${v}`)}
          </button>
        ))}
      </div>

      {!orgId || load.status === 'loading' ? <DataState state="loading" />
        : load.status === 'failed' ? <DataState state={load.error.code === 'ACCESS_DENIED' ? 'denied' : 'failed'} message={errorText(load.error, A.intl.locale)} onRetry={refresh} />
        : load.items.length === 0 ? <DataState state="empty" message={load.checking ? A.t('actions.checking') : A.t(view === 'open' ? 'actions.empty' : 'actions.emptyDone')} />
        : (
          <div data-testid="action-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {load.items.map(a => <ActionCard key={a.id} orgId={orgId} action={a} categories={categories} onChanged={refresh} />)}
          </div>
        )}

      {canSettings && orgId && <RuleSettings orgId={orgId} />}
    </div>
  );
}

interface RuleRow { rule_code: string; enabled: boolean; params: Record<string, number>; defaults: Record<string, number> }

function RuleSettings({ orgId }: { orgId: string }) {
  const A = useActionText([]);
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const key = useIdempotencyKey();

  useEffect(() => {
    let ignore = false;
    smeApi<{ rules: RuleRow[] }>('action-settings', { orgId }).then(res => { if (!ignore && res.ok) setRules(res.data.rules); });
    return () => { ignore = true; };
  }, [orgId]);

  const save = async (rule: RuleRow) => {
    const res = await smeApi('action-settings', { orgId, method: 'POST', idempotencyKey: key.current(), body: { rule_code: rule.rule_code, enabled: rule.enabled, params: rule.params } });
    if (res.ok) { key.rotate(); setSaved(rule.rule_code); }
  };
  const set = (code: string, patch: Partial<RuleRow>) => setRules(list => list?.map(r => (r.rule_code === code ? { ...r, ...patch } : r)) ?? null);

  if (!rules) return null;
  return (
    <details style={{ ...card }}>
      <summary style={{ cursor: 'pointer', fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>{A.t('actions.settings.title')}</summary>
      <p style={{ ...muted, margin: '8px 0 12px' }}>{A.t('actions.settings.description')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {rules.map(r => (
          <form key={r.rule_code} onSubmit={e => { e.preventDefault(); void save(r); }} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 220px', fontSize: '14px', color: 'var(--ds-text-body)' }}>
              <input type="checkbox" checked={r.enabled} onChange={e => set(r.rule_code, { enabled: e.target.checked })} />
              {A.t(`actions.rule.name.${r.rule_code}`)}
            </label>
            {Object.keys(r.defaults).map(p => (
              <Field key={p} text={A.t(`actions.settings.param.${p}`)}>
                <input type="number" min={0} max={3650} style={{ ...input, width: '110px' }} value={r.params[p] ?? r.defaults[p]}
                  onChange={e => set(r.rule_code, { params: { ...r.params, [p]: Number(e.target.value) } })} />
              </Field>
            ))}
            <button type="submit" style={secondaryButton}>{saved === r.rule_code ? A.t('actions.settings.saved') : A.t('actions.settings.save')}</button>
          </form>
        ))}
      </div>
    </details>
  );
}
