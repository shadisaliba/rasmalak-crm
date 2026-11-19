'use client';

import { useIntl } from 'react-intl';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { SmeGate } from './SmeGate';
import { useProfileBundle } from './useProfileBundle';
import { ConsentSection, FactsSection, FinanceSection, IdentitySection } from './ProfileSections';

export function BusinessProfilePage() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, number>) => intl.formatMessage({ id }, values);
  const { currentOrg } = useOrg();
  const { bundle, loaded, failed, reload } = useProfileBundle();
  const canManage = useOrgPermission('sme.profile.manage');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '880px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 4px' }}>{t('sme.profile.title')}</h1>
        <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{t('sme.profile.description')}</p>
      </div>
      <SmeGate permission="sme.profile.read">
        {!loaded || !currentOrg ? (
          <div style={{ fontSize: '13px', color: 'var(--ds-text-muted)' }}>{t('common.loading')}</div>
        ) : failed || !bundle ? (
          <div role="alert" style={{ fontSize: '13px', color: 'var(--ds-error-text)' }}>{t('sme.profile.loadError')}</div>
        ) : (
          <fieldset disabled={!canManage} style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {bundle.openReminders > 0 && (
              <div role="status" style={{ padding: '10px 14px', fontSize: '13px', borderRadius: '10px', background: 'var(--ds-bg-tinted)', color: 'var(--ds-text-body)' }}>
                {t('sme.profile.reminders', { count: bundle.openReminders })}
              </div>
            )}
            <IdentitySection key={`id-${bundle.profile?.profileVersion}`} orgId={currentOrg.id} bundle={bundle} onSaved={reload} />
            <FinanceSection key={`fin-${bundle.profile?.profileVersion}`} orgId={currentOrg.id} bundle={bundle} onSaved={reload} />
            <FactsSection key={`facts-${bundle.profile?.profileVersion}`} orgId={currentOrg.id} bundle={bundle} onSaved={reload} />
            <ConsentSection orgId={currentOrg.id} bundle={bundle} onSaved={reload} />
          </fieldset>
        )}
      </SmeGate>
    </div>
  );
}
