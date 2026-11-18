'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useIntl } from 'react-intl';
import { UserPlus } from 'lucide-react';
import { useAuth } from '@/store/authStore';
import { useOrg } from '@/store/orgStore';
import { HOME_ROUTE, withNext } from '@/lib/routes';

const ERROR_REASONS = ['expired', 'used', 'invalid', 'email_mismatch', 'already_member'] as const;

export default function AcceptInvitationPage() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { token } = useParams<{ token: string }>();
  const pathname = usePathname();
  const { user, initialized } = useAuth();
  const { acceptInvitation } = useOrg();
  const [busy, setBusy] = useState(false);
  const [errorReason, setErrorReason] = useState<(typeof ERROR_REASONS)[number] | null>(null);

  const accept = async () => {
    setBusy(true);
    setErrorReason(null);
    const result = await acceptInvitation(token);
    if (result.ok) {
      // A full load lets the organization store pick up the new membership.
      window.location.assign(HOME_ROUTE);
      return;
    }
    const reason = String(result.details.reason ?? 'invalid');
    setErrorReason((ERROR_REASONS as readonly string[]).includes(reason) ? (reason as (typeof ERROR_REASONS)[number]) : 'invalid');
    setBusy(false);
  };

  const linkStyle = { fontSize: '14px', fontWeight: 500, color: 'var(--ds-primary)' } as const;

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: 'var(--ds-bg-page)' }}>
      <div style={{ width: '100%', maxWidth: '440px', background: 'var(--ds-bg-card)', border: '0.5px solid var(--ds-border)', borderRadius: '16px', padding: '28px', boxShadow: 'var(--ds-shadow-card)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'var(--ds-bg-tinted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <UserPlus size={22} style={{ color: 'var(--ds-primary)' }} aria-hidden />
        </div>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 6px' }}>{t('org.invite.title')}</h1>
          <p style={{ fontSize: '14px', color: 'var(--ds-text-body)', margin: 0 }}>{t('org.invite.description')}</p>
        </div>

        {errorReason && (
          <div role="alert" style={{ padding: '10px 12px', fontSize: '13px', borderRadius: '8px', background: 'var(--ds-error-bg)', color: 'var(--ds-error-text)', border: '1px solid var(--ds-error-border)' }}>
            {t(`org.invite.error.${errorReason}`)}
          </div>
        )}

        {initialized && !user && (
          <>
            <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{t('org.invite.signInFirst')}</p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <Link href={withNext('/login', pathname)} style={linkStyle}>{t('org.invite.signIn')}</Link>
              <Link href={withNext('/signup', pathname)} style={linkStyle}>{t('org.invite.signUp')}</Link>
            </div>
          </>
        )}

        {initialized && user && (
          <>
            <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>
              {t('org.invite.signedInAs', { email: user.email ?? '' })}
            </p>
            <button
              type="button"
              onClick={accept}
              disabled={busy || errorReason === 'used' || errorReason === 'expired' || errorReason === 'invalid'}
              style={{ padding: '10px 16px', fontSize: '14px', fontWeight: 500, borderRadius: '8px', border: 'none', background: 'var(--ds-primary)', color: '#FFFFFF', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1, alignSelf: 'flex-start' }}
            >
              {busy ? t('org.invite.accepting') : t('org.invite.accept')}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
