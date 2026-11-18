'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useIntl } from 'react-intl';
import { UserPlus, MoreVertical, Shield, Copy, Check, Mail } from 'lucide-react';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { useUser } from '@/store/authStore';
import { canGrantRole, canManageMember } from '@/lib/orgRoles';
import { INVITE_ROUTE_PREFIX } from '@/lib/routes';

const fieldStyle = {
  padding: '8px 12px', fontSize: '13px', border: '1px solid var(--ds-border)', borderRadius: '8px',
  background: 'var(--ds-bg-card)', color: 'var(--ds-text-body)', outline: 'none',
} as const;
const primaryButton = {
  display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--ds-primary)', color: '#FFFFFF',
  border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
} as const;
const secondaryButton = {
  background: 'none', border: '1px solid var(--ds-border)', borderRadius: '8px', padding: '8px 16px',
  fontSize: '13px', cursor: 'pointer', color: 'var(--ds-text-body)',
} as const;

export function MemberManager() {
  const intl = useIntl();
  const {
    orgMembers, orgRoles, userRole, invitations,
    updateMemberRole, removeMember, inviteMember, revokeInvitation, refreshInvitations,
  } = useOrg();
  const currentUser = useUser();
  const canManage = useOrgPermission('team.manage');
  const canInvite = useOrgPermission('team.invite');
  const canSeeInvitations = userRole === 'owner' || userRole === 'admin';
  const isAr = intl.locale.startsWith('ar');

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('sales_rep');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);

  const t = (key: string, def: string, values?: Record<string, string>) =>
    intl.formatMessage({ id: key, defaultMessage: def }, values);

  useEffect(() => {
    if (canSeeInvitations) void refreshInvitations();
  }, [canSeeInvitations, refreshInvitations]);

  const getRoleName = (role: string) => {
    const roleObj = orgRoles.find(r => r.name === role);
    return isAr ? (roleObj?.nameAr || role) : role;
  };

  const grantableRoles = orgRoles.map(r => r.name).filter(name => canGrantRole(userRole, name));
  const effectiveInviteRole = grantableRoles.includes(inviteRole) ? inviteRole : grantableRoles[grantableRoles.length - 1];

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    const email = inviteEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setInviteError(t('org.team.error.email', 'Enter a valid email address.'));
      return;
    }
    setInviteBusy(true);
    const result = await inviteMember(email, effectiveInviteRole);
    setInviteBusy(false);
    if (!result.ok) {
      if (result.details.reason === 'already_member') setInviteError(t('org.team.error.already_member', 'This person is already a member.'));
      else if (result.details.field === 'email') setInviteError(t('org.team.error.email', 'Enter a valid email address.'));
      else if (result.code === 'ACCESS_DENIED') setInviteError(t('org.team.error.ACCESS_DENIED', 'You cannot invite someone with this role.'));
      else setInviteError(t('org.team.error.generic', 'Something went wrong. Please try again.'));
      return;
    }
    setCreatedLink({ email, url: `${window.location.origin}${INVITE_ROUTE_PREFIX}${result.token}` });
    setCopied(false);
    setInviteEmail('');
    setShowInvite(false);
  };

  const copyLink = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const changeRole = async (memberId: string, role: string) => {
    setMenuOpen(null);
    setChangeError((await updateMemberRole(memberId, role)) ? null : t('org.team.error.change', 'You cannot make this change.'));
  };

  const remove = async (memberId: string) => {
    setMenuOpen(null);
    setChangeError((await removeMember(memberId)) ? null : t('org.team.error.change', 'You cannot make this change.'));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--ds-text-heading)' }}>
          {t('org.team.members', 'Team Members')}
        </h2>
        {canInvite && grantableRoles.length > 0 && (
          <button onClick={() => { setShowInvite(true); setInviteError(null); }} style={primaryButton}>
            <UserPlus size={14} />
            {t('org.team.invite', 'Invite Member')}
          </button>
        )}
      </div>

      {showInvite && (
        <form
          onSubmit={handleInvite}
          style={{ background: 'var(--ds-bg-tinted)', border: '1px solid var(--ds-border-tinted)', borderRadius: '12px', padding: '14px 18px', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '10px' }}
        >
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="name@example.com"
              aria-label={t('org.team.inviteEmail', 'Email address')}
              dir="ltr"
              required
              style={{ ...fieldStyle, flex: 1, minWidth: '200px' }}
            />
            <select
              value={effectiveInviteRole}
              onChange={e => setInviteRole(e.target.value)}
              aria-label={t('org.team.inviteRole', 'Role')}
              style={fieldStyle}
            >
              {grantableRoles.map(r => (
                <option key={r} value={r}>{getRoleName(r)}</option>
              ))}
            </select>
            <button type="submit" disabled={inviteBusy} style={{ ...primaryButton, opacity: inviteBusy ? 0.6 : 1 }}>
              {t('org.team.createInvite', 'Create invitation')}
            </button>
            <button type="button" onClick={() => setShowInvite(false)} style={secondaryButton}>
              {t('crm.action.cancel', 'Cancel')}
            </button>
          </div>
          {inviteError && <div role="alert" style={{ fontSize: '13px', color: 'var(--ds-error-text)' }}>{inviteError}</div>}
        </form>
      )}

      {createdLink && (
        <div role="status" style={{ background: 'var(--ds-success-bg)', border: '1px solid var(--ds-success-border)', borderRadius: '12px', padding: '14px 18px', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ds-success-text)' }}>
            {t('org.team.inviteLinkTitle', 'Invitation link')}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--ds-text-body)' }}>
            {t('org.team.inviteLinkHint', 'Send this link to {email} yourself. It works once, only for that email address, and expires in 7 days.', { email: createdLink.email })}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <code dir="ltr" style={{ flex: 1, minWidth: 0, fontSize: '12px', padding: '6px 10px', borderRadius: '6px', background: 'var(--ds-bg-card)', color: 'var(--ds-text-heading)', overflowWrap: 'anywhere' }}>
              {createdLink.url}
            </code>
            <button type="button" onClick={copyLink} style={{ ...secondaryButton, display: 'flex', alignItems: 'center', gap: '6px' }}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t('org.team.copied', 'Copied') : t('org.team.copyLink', 'Copy link')}
            </button>
          </div>
        </div>
      )}

      {changeError && <div role="alert" style={{ fontSize: '13px', color: 'var(--ds-error-text)', marginBottom: '0.75rem' }}>{changeError}</div>}

      <div style={{ background: 'var(--ds-bg-card)', border: '0.5px solid var(--ds-border)', borderRadius: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
        {orgMembers.map((member, idx) => {
          // Your own row has no actions, so nobody can demote or remove themselves by accident.
          const manageable = canManage && member.userId !== currentUser?.id && canManageMember(userRole, member.role);
          const roleChoices = grantableRoles.filter(r => r !== member.role);
          return (
            <div
              key={member.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px',
                borderBottom: idx < orgMembers.length - 1 ? '1px solid var(--ds-border)' : 'none',
              }}
            >
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--ds-bg-tinted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ds-primary)' }}>
                  {(member.displayName || member.userId.substring(0, 2)).charAt(0).toUpperCase()}
                </span>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ds-text-heading)' }}>
                  {member.displayName || member.displayNameAr || member.userId.substring(0, 12)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <Shield size={12} style={{ color: 'var(--ds-text-muted)' }} />
                  <span style={{ fontSize: '12px', color: 'var(--ds-text-muted)' }}>{getRoleName(member.role)}</span>
                </div>
              </div>

              {manageable && (
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setMenuOpen(prev => prev === member.id ? null : member.id)}
                    aria-label={t('org.team.changeRole', 'Change Role')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ds-text-muted)', padding: '4px' }}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {menuOpen === member.id && (
                    <div style={{
                      position: 'absolute', insetInlineEnd: 0, insetBlockStart: '100%',
                      background: 'var(--ds-bg-card)', border: '0.5px solid var(--ds-border)',
                      borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      padding: '4px', zIndex: 10, minWidth: '160px',
                    }}>
                      {roleChoices.map(r => (
                        <button
                          key={r}
                          onClick={() => changeRole(member.id, r)}
                          style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--ds-text-body)', textAlign: 'start', borderRadius: '6px' }}
                        >
                          {t('org.team.changeRole', 'Change Role')}: {getRoleName(r)}
                        </button>
                      ))}
                      <button
                        onClick={() => remove(member.id)}
                        style={{ display: 'block', width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--ds-error)', textAlign: 'start', borderRadius: '6px' }}
                      >
                        {t('org.team.remove', 'Remove Member')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canSeeInvitations && invitations.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ds-text-heading)', marginBottom: '0.75rem' }}>
            {t('org.team.pendingInvitations', 'Pending invitations')}
          </h3>
          <div style={{ background: 'var(--ds-bg-card)', border: '0.5px solid var(--ds-border)', borderRadius: '16px', overflow: 'hidden' }}>
            {invitations.map((inv, idx) => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderBottom: idx < invitations.length - 1 ? '1px solid var(--ds-border)' : 'none', flexWrap: 'wrap' }}>
                <Mail size={16} style={{ color: 'var(--ds-text-muted)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <div dir="ltr" style={{ fontSize: '14px', color: 'var(--ds-text-heading)', textAlign: 'start' }}>{inv.email}</div>
                  <div style={{ fontSize: '12px', color: 'var(--ds-text-muted)', marginTop: '2px' }}>
                    {getRoleName(inv.role)} · {t('org.team.expiresOn', 'Expires {date}', { date: intl.formatDate(inv.expiresAt, { dateStyle: 'medium' }) })}
                  </div>
                </div>
                {canInvite && (
                  <button type="button" onClick={() => revokeInvitation(inv.id)} style={secondaryButton}>
                    {t('org.team.revoke', 'Revoke')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
