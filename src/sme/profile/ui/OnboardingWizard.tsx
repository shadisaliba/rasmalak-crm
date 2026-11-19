'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import { useOrg } from '@/store/orgStore';
import { HOME_ROUTE } from '@/lib/routes';
import { SmeGate } from './SmeGate';
import { useProfileBundle } from './useProfileBundle';
import { ConsentSection, FactsSection, FinanceSection, IdentitySection, primaryButton, sectionCard } from './ProfileSections';

const STEPS = ['identity', 'finance', 'regulatory', 'team', 'done'] as const;
const secondary = { padding: '9px 16px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--ds-border)', background: 'transparent', color: 'var(--ds-text-body)', cursor: 'pointer' } as const;

// Blueprint §4 order. The account step is sign-up itself; every step after it can be skipped,
// and anything skipped stays as a missing-information reminder.
export function OnboardingWizard() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, number>) => intl.formatMessage({ id }, values);
  const { currentOrg } = useOrg();
  const { bundle, loaded, reload } = useProfileBundle();
  const [step, setStep] = useState(0);
  const next = () => { reload(); setStep(s => Math.min(s + 1, STEPS.length - 1)); };
  const current = STEPS[step];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '880px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--ds-text-heading)', margin: '0 0 4px' }}>{t('sme.onboarding.title')}</h1>
        <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{t('sme.onboarding.step', { n: step + 1, total: STEPS.length })}</p>
      </div>
      <SmeGate permission="sme.profile.manage">
        {!loaded || !bundle || !currentOrg ? (
          <div style={{ fontSize: '13px', color: 'var(--ds-text-muted)' }}>{t('common.loading')}</div>
        ) : (
          <>
            {current === 'identity' && <IdentitySection orgId={currentOrg.id} bundle={bundle} onSaved={next} saveLabel={t('sme.onboarding.next')} />}
            {current === 'finance' && <FinanceSection orgId={currentOrg.id} bundle={bundle} onSaved={next} saveLabel={t('sme.onboarding.next')} />}
            {current === 'regulatory' && <FactsSection orgId={currentOrg.id} bundle={bundle} onSaved={next} saveLabel={t('sme.onboarding.next')} />}
            {current === 'team' && (
              <>
                <section style={sectionCard}>
                  <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{t('sme.onboarding.team.title')}</h2>
                  <p style={{ fontSize: '14px', color: 'var(--ds-text-body)', margin: 0 }}>{t('sme.onboarding.team.body')}</p>
                  <Link href="/crm/settings/business/access" style={{ fontSize: '14px', color: 'var(--ds-primary)', fontWeight: 500 }}>{t('sme.onboarding.team.invite')}</Link>
                </section>
                <ConsentSection orgId={currentOrg.id} bundle={bundle} onSaved={reload} />
                <button type="button" style={primaryButton} onClick={next}>{t('sme.onboarding.continue')}</button>
              </>
            )}
            {current === 'done' && (
              <section style={sectionCard}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--ds-text-heading)' }}>{t('sme.onboarding.done.title')}</h2>
                <p style={{ fontSize: '14px', color: 'var(--ds-text-body)', margin: 0 }}>{t('sme.onboarding.done.body')}</p>
                {bundle.openReminders > 0 && <p style={{ fontSize: '13px', color: 'var(--ds-text-muted)', margin: 0 }}>{t('sme.profile.reminders', { count: bundle.openReminders })}</p>}
                <Link href={HOME_ROUTE} style={{ ...primaryButton, textDecoration: 'none' }}>{t('sme.onboarding.done.cta')}</Link>
              </section>
            )}
            {current !== 'done' && current !== 'team' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                {step > 0 && <button type="button" style={secondary} onClick={() => setStep(s => s - 1)}>{t('sme.onboarding.back')}</button>}
                <button type="button" style={secondary} onClick={next}>{t('sme.onboarding.skip')}</button>
              </div>
            )}
          </>
        )}
      </SmeGate>
    </div>
  );
}
