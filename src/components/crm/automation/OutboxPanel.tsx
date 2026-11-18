'use client';

import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { Mail, MessageCircle, Hash, Globe } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useOrg } from '@/store/orgStore';

type Channel = 'email' | 'whatsapp' | 'slack' | 'webhook';
type Status = 'draft' | 'approved' | 'sent' | 'failed' | 'discarded';

interface Draft {
  id: string;
  channel: Channel;
  recipient: string;
  payload: Record<string, unknown>;
  status: Status;
  lastError: string | null;
  createdAt: string;
  workflowName: string | null;
  workflowNameAr: string | null;
  contactName: string | null;
}

const CHANNEL_ICON: Record<Channel, typeof Mail> = { email: Mail, whatsapp: MessageCircle, slack: Hash, webhook: Globe };

async function fetchDrafts(orgId: string): Promise<Draft[] | null> {
  const { data, error } = await supabase
    .from('crm_outbound_drafts')
    .select('id, channel, recipient, payload, status, last_error, created_at, crm_workflows(name, name_ar)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data) return null;

  const contactIds = [...new Set(data.filter(d => d.channel === 'email' || d.channel === 'whatsapp').map(d => d.recipient))];
  const names = new Map<string, string>();
  if (contactIds.length) {
    const { data: contacts } = await supabase.from('crm_contacts').select('id, first_name, last_name').eq('org_id', orgId).in('id', contactIds);
    for (const c of contacts ?? []) names.set(c.id, [c.first_name, c.last_name].filter(Boolean).join(' '));
  }
  return data.map(d => {
    // PostgREST types a to-one embed as an array; at runtime it is a single object.
    const wf = d.crm_workflows as unknown as { name: string; name_ar: string | null } | null;
    return {
      id: d.id, channel: d.channel as Channel, recipient: d.recipient, payload: d.payload ?? {},
      status: d.status as Status, lastError: d.last_error, createdAt: d.created_at,
      workflowName: wf?.name ?? null, workflowNameAr: wf?.name_ar ?? null,
      contactName: names.get(d.recipient) ?? null,
    };
  });
}

function preview(draft: Draft): string {
  const p = draft.payload;
  if (draft.channel === 'email') return String(p.subject ?? '');
  if (draft.channel === 'whatsapp') return [String(p.templateName ?? ''), ...(Array.isArray(p.params) ? p.params.map(String) : [])].filter(Boolean).join(' · ');
  if (draft.channel === 'slack') return String(p.message ?? '');
  return draft.recipient;
}

export function OutboxPanel() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const isAr = intl.locale.startsWith('ar');
  const { currentOrg } = useOrg();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    const orgId = currentOrg.id;
    let ignore = false;
    fetchDrafts(orgId).then(rows => {
      if (ignore) return;
      if (rows) setDrafts(rows);
      setLoadedFor(orgId);
    });
    return () => { ignore = true; };
  }, [currentOrg, reloadKey]);

  const decide = async (draftId: string, decision: 'approve' | 'discard') => {
    setBusyId(draftId);
    setError(null);
    const { error: rpcError } = await supabase.rpc('crm_decide_outbound_draft', { p_draft: draftId, p_decision: decision });
    setBusyId(null);
    if (rpcError) setError(t('automation.outbox.error'));
    setReloadKey(k => k + 1);
  };

  if (!currentOrg || loadedFor !== currentOrg.id) {
    return <div style={{ padding: '2rem', color: 'var(--ds-text-muted)', fontSize: '13px' }}>{intl.formatMessage({ id: 'common.loading' })}</div>;
  }

  const button = (variant: 'primary' | 'secondary', disabled: boolean) => ({
    padding: '6px 12px', fontSize: '12px', fontWeight: 500, borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    ...(variant === 'primary'
      ? { background: 'var(--ds-primary)', color: '#FFFFFF', border: 'none' }
      : { background: 'transparent', color: 'var(--ds-text-body)', border: '1px solid var(--ds-border)' }),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{t('automation.outbox.description')}</p>
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--ds-error-text)' }}>{error}</div>}

      {drafts.length === 0 ? (
        <div style={{ padding: '2.5rem', textAlign: 'center', background: 'var(--ds-bg-card)', border: '0.5px solid var(--ds-border)', borderRadius: '16px', color: 'var(--ds-text-muted)', fontSize: '14px' }}>
          {t('automation.outbox.empty')}
        </div>
      ) : (
        <div role="list" style={{ background: 'var(--ds-bg-card)', border: '0.5px solid var(--ds-border)', borderRadius: '16px', overflow: 'hidden' }}>
          {drafts.map((draft, idx) => {
            const Icon = CHANNEL_ICON[draft.channel];
            const workflow = (isAr ? draft.workflowNameAr : null) || draft.workflowName;
            const busy = busyId === draft.id;
            return (
              <div key={draft.id} role="listitem" style={{ display: 'flex', gap: '12px', padding: '14px 16px', alignItems: 'flex-start', flexWrap: 'wrap', borderBottom: idx < drafts.length - 1 ? '1px solid var(--ds-border)' : 'none' }}>
                <Icon size={18} style={{ color: 'var(--ds-text-muted)', marginTop: '2px', flexShrink: 0 }} aria-hidden />
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ds-text-heading)' }}>{t(`automation.outbox.channel.${draft.channel}`)}</span>
                    <span style={{ fontSize: '12px', color: 'var(--ds-text-muted)' }}>{draft.contactName ?? draft.recipient}</span>
                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: draft.status === 'failed' ? 'var(--ds-error-bg)' : 'var(--ds-bg-tinted)', color: draft.status === 'failed' ? 'var(--ds-error-text)' : 'var(--ds-text-body)' }}>
                      {t(`automation.outbox.status.${draft.status}`)}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--ds-text-body)', marginTop: '4px', overflowWrap: 'anywhere' }}>{preview(draft)}</div>
                  <div style={{ fontSize: '12px', color: 'var(--ds-text-muted)', marginTop: '4px' }}>
                    {workflow ? `${t('automation.outbox.from', { workflow })} · ` : ''}
                    {intl.formatDate(draft.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  {draft.status === 'failed' && draft.lastError && (
                    <div style={{ fontSize: '12px', color: 'var(--ds-error-text)', marginTop: '4px' }}>{draft.lastError}</div>
                  )}
                  {draft.status === 'draft' && draft.channel === 'email' && (
                    <div style={{ fontSize: '12px', color: 'var(--ds-warning-text)', marginTop: '4px' }}>{t('automation.outbox.emailUnavailable')}</div>
                  )}
                </div>
                {draft.status === 'draft' && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {draft.channel !== 'email' && (
                      <button type="button" disabled={busy} onClick={() => decide(draft.id, 'approve')} style={button('primary', busy)}>
                        {t('automation.outbox.approve')}
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => decide(draft.id, 'discard')} style={button('secondary', busy)}>
                      {t('automation.outbox.discard')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
