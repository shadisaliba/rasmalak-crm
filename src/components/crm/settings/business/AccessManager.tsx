'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import { Shield, UserPlus, Copy, Check } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { useUser } from '@/store/authStore';
import { canGrantRole, canManageMember } from '@/lib/orgRoles';
import { INVITE_ROUTE_PREFIX } from '@/lib/routes';
import { mapFromDb, SME_MODULES, type OrgMember, type SmeModule } from '@/types/crm';
import { useSmeEnabled } from '@/sme/ui/useSmeEnabled';

const card = { background: 'var(--ds-bg-card)', border: '0.5px solid var(--ds-border)', borderRadius: '16px', padding: '20px', boxShadow: 'var(--ds-shadow-card)' } as const;
const field = { padding: '8px 12px', fontSize: '13px', border: '1px solid var(--ds-border)', borderRadius: '8px', background: 'var(--ds-bg-card)', color: 'var(--ds-text-body)' } as const;
const button = (primary: boolean, danger = false) => ({
  padding: '7px 14px', fontSize: '13px', fontWeight: 500, borderRadius: '8px', cursor: 'pointer',
  ...(primary
    ? { background: danger ? 'var(--ds-error)' : 'var(--ds-primary)', color: '#FFFFFF', border: 'none' }
    : { background: 'transparent', color: danger ? 'var(--ds-error-text)' : 'var(--ds-text-body)', border: `1px solid ${danger ? 'var(--ds-error-border)' : 'var(--ds-border)'}` }),
});

async function fetchMembers(orgId: string): Promise<OrgMember[] | null> {
  const { data, error } = await supabase.from('org_members').select('*').eq('org_id', orgId).order('joined_at');
  return error || !data ? null : data.map(r => mapFromDb<OrgMember>(r));
}

function ModulePicker({ value, onChange }: { value: SmeModule[]; onChange: (v: SmeModule[]) => void }) {
  const intl = useIntl();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
      {SME_MODULES.map(m => (
        <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--ds-text-body)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={value.includes(m)}
            onChange={e => onChange(e.target.checked ? [...value, m] : value.filter(x => x !== m))}
          />
          {intl.formatMessage({ id: `sme.module.${m}` })}
        </label>
      ))}
    </div>
  );
}

type Editing = { userId: string; mode: 'modules' | 'revoke'; modules: SmeModule[]; restrict: boolean; reason: string };

export function AccessManager() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const isAr = intl.locale.startsWith('ar');
  const { currentOrg, orgRoles, userRole, inviteMember } = useOrg();
  const me = useUser();
  const canManage = useOrgPermission('sme.access.manage');
  const smeEnabled = useSmeEnabled();

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('bookkeeper');
  const [inviteRestrict, setInviteRestrict] = useState(false);
  const [inviteModules, setInviteModules] = useState<SmeModule[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    const orgId = currentOrg.id;
    let ignore = false;
    fetchMembers(orgId).then(rows => {
      if (ignore) return;
      if (rows) setMembers(rows);
      setLoadedFor(orgId);
    });
    return () => { ignore = true; };
  }, [currentOrg, reloadKey]);

  if (!currentOrg) return null;
  if (!canManage) return <div role="alert" style={{ ...card, color: 'var(--ds-text-muted)', fontSize: '14px' }}>{t('sme.access.denied')}</div>;

  const roleLabel = (role: string) => {
    const known = intl.messages[`org.role.${role}`];
    if (known) return t(`org.role.${role}`);
    const custom = orgRoles.find(r => r.name === role);
    return (isAr ? custom?.nameAr : null) || role;
  };
  const date = (iso: string) => intl.formatDate(iso, { dateStyle: 'medium' });
  const grantable = orgRoles.map(r => r.name).filter(r => canGrantRole(userRole, r));
  const inviteRoleValue = grantable.includes(inviteRole) ? inviteRole : grantable[grantable.length - 1];

  const submit = async () => {
    if (!editing) return;
    if (!editing.reason.trim()) { setError(t('sme.access.reasonRequired')); return; }
    setBusy(true);
    setError(null);
    const common = { p_org: currentOrg.id, p_user: editing.userId, p_reason: editing.reason.trim(), p_correlation_id: crypto.randomUUID(), p_idem: crypto.randomUUID() };
    const { error: rpcError } = editing.mode === 'revoke'
      ? await supabase.rpc('sme_revoke_member', common)
      : await supabase.rpc('sme_set_member_modules', { ...common, p_modules: editing.restrict ? editing.modules : null });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message === 'ACCESS_DENIED' || rpcError.details?.includes('self') ? t('sme.access.errorRank') : t('sme.access.error'));
      return;
    }
    setEditing(null);
    setReloadKey(k => k + 1);
  };

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = await inviteMember(inviteEmail.trim(), inviteRoleValue, inviteRestrict ? inviteModules : null);
    if (!result.ok) {
      setError(result.details.reason === 'already_member' ? t('org.team.error.already_member')
        : result.details.field === 'email' ? t('org.team.error.email') : t('sme.access.error'));
      return;
    }
    setInviteLink(`${window.location.origin}${INVITE_ROUTE_PREFIX}${result.token}`);
    setCopied(false);
    setInviteEmail('');
  };

  const active = members.filter(m => m.isActive && !m.revokedAt);
  const revoked = members.filter(m => m.revokedAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '880px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 4px' }}>{t('sme.access.title')}</h1>
        <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{t('sme.access.description')}</p>
      </div>
      {!smeEnabled && <div role="status" style={{ padding: '12px 14px', fontSize: '13px', borderRadius: '10px', background: 'var(--ds-warning-bg)', color: 'var(--ds-warning-text)', border: '1px solid var(--ds-warning-border)' }}>{t('sme.access.notEnabled')}</div>}
      {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--ds-error-text)' }}>{error}</div>}

      <form onSubmit={invite} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <UserPlus size={16} aria-hidden /> {t('sme.access.invite')}
        </h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input type="email" required dir="ltr" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="name@example.com"
            aria-label={t('org.team.inviteEmail')} style={{ ...field, flex: 1, minWidth: '220px' }} />
          <select value={inviteRoleValue} onChange={e => setInviteRole(e.target.value)} aria-label={t('org.team.inviteRole')} style={field}>
            {grantable.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
          <button type="submit" style={button(true)}>{t('sme.access.sendInvite')}</button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--ds-text-body)' }}>
          <input type="checkbox" checked={inviteRestrict} onChange={e => setInviteRestrict(e.target.checked)} />
          {t('sme.access.limitModules')}
        </label>
        {inviteRestrict && <ModulePicker value={inviteModules} onChange={setInviteModules} />}
        {inviteLink && (
          <div role="status" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: '10px', background: 'var(--ds-success-bg)', border: '1px solid var(--ds-success-border)' }}>
            <code dir="ltr" style={{ flex: 1, minWidth: 0, fontSize: '12px', overflowWrap: 'anywhere', color: 'var(--ds-text-heading)' }}>{inviteLink}</code>
            <button type="button" style={{ ...button(false), display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={async () => { try { await navigator.clipboard.writeText(inviteLink); setCopied(true); } catch { setCopied(false); } }}>
              {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t('org.team.copied') : t('org.team.copyLink')}
            </button>
          </div>
        )}
      </form>

      <div role="list" style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {loadedFor !== currentOrg.id ? (
          <div style={{ padding: '20px', fontSize: '13px', color: 'var(--ds-text-muted)' }}>{t('common.loading')}</div>
        ) : active.map((m, idx) => {
          const self = m.userId === me?.id;
          const manageable = !self && canManageMember(userRole, m.role);
          const isEditing = editing?.userId === m.userId;
          return (
            <div key={m.id} role="listitem" style={{ padding: '14px 18px', borderBottom: idx < active.length - 1 ? '1px solid var(--ds-border)' : 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                <Shield size={16} style={{ color: 'var(--ds-text-muted)', marginTop: '3px' }} aria-hidden />
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ds-text-heading)' }}>
                    {m.displayName || m.userId.slice(0, 8)}{self ? ` · ${t('sme.access.you')}` : ''}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--ds-text-muted)', marginTop: '2px' }}>
                    {roleLabel(m.role)} · {m.allowedModules ? intl.formatList(m.allowedModules.map(x => t(`sme.module.${x}`)), { type: 'conjunction' }) : t('sme.access.allModules')} · {t('sme.access.granted', { date: date(m.grantedAt) })}
                  </div>
                </div>
                {manageable && !isEditing && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" style={button(false)} onClick={() => setEditing({ userId: m.userId, mode: 'modules', modules: m.allowedModules ?? [], restrict: !!m.allowedModules, reason: '' })}>{t('sme.access.editModules')}</button>
                    <button type="button" style={button(false, true)} onClick={() => setEditing({ userId: m.userId, mode: 'revoke', modules: [], restrict: false, reason: '' })}>{t('sme.access.revoke')}</button>
                  </div>
                )}
              </div>
              {isEditing && editing && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingInlineStart: '28px' }}>
                  {editing.mode === 'modules' && (
                    <>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--ds-text-body)' }}>
                        <input type="checkbox" checked={editing.restrict} onChange={e => setEditing({ ...editing, restrict: e.target.checked })} />
                        {t('sme.access.limitModules')}
                      </label>
                      {editing.restrict && <ModulePicker value={editing.modules} onChange={modules => setEditing({ ...editing, modules })} />}
                    </>
                  )}
                  <input value={editing.reason} onChange={e => setEditing({ ...editing, reason: e.target.value })} placeholder={t('sme.access.reason')} aria-label={t('sme.access.reason')} style={{ ...field, maxWidth: '420px' }} />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" disabled={busy} onClick={submit} style={button(true, editing.mode === 'revoke')}>
                      {editing.mode === 'revoke' ? t('sme.access.confirmRevoke') : t('sme.access.save')}
                    </button>
                    <button type="button" onClick={() => { setEditing(null); setError(null); }} style={button(false)}>{t('sme.access.cancel')}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {revoked.length > 0 && (
        <div style={card}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 8px' }}>{t('sme.access.revokedHeading')}</h2>
          {revoked.map(m => (
            <div key={m.id} style={{ fontSize: '13px', color: 'var(--ds-text-muted)', padding: '4px 0' }}>
              {m.displayName || m.userId.slice(0, 8)} · {roleLabel(m.role)} · {t('sme.access.revokedOn', { date: date(m.revokedAt!) })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
