'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import { supabase } from '@/lib/supabaseClient';
import { useOrg, useOrgPermission } from '@/store/orgStore';
import { useSmeEnabled } from '@/sme/ui/useSmeEnabled';

/** Shown to people who can manage the profile while profile items are still unanswered. */
export function SmeSetupBanner() {
  const intl = useIntl();
  const { currentOrg } = useOrg();
  const enabled = useSmeEnabled();
  const canManage = useOrgPermission('sme.profile.manage');
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!currentOrg || !enabled || !canManage) return;
    let ignore = false;
    supabase.from('sme_business_profiles').select('org_id').eq('org_id', currentOrg.id).maybeSingle().then(({ data }) => {
      if (!ignore) setShow(!data);
    });
    return () => { ignore = true; };
  }, [currentOrg, enabled, canManage]);

  if (!show || !enabled || !canManage) return null;
  return (
    <div role="status" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', borderRadius: '12px', background: 'var(--ds-bg-tinted)', border: '1px solid var(--ds-border-tinted)', marginBottom: '1rem' }}>
      <span style={{ flex: 1, fontSize: '14px', color: 'var(--ds-text-body)' }}>{intl.formatMessage({ id: 'sme.onboarding.banner' })}</span>
      <Link href="/crm/onboarding" style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ds-primary)' }}>{intl.formatMessage({ id: 'sme.onboarding.bannerCta' })}</Link>
    </div>
  );
}
