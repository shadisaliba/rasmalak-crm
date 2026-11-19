'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useIntl } from 'react-intl';
import { supabase } from '@/lib/supabaseClient';
import { useOrg } from '@/store/orgStore';

/**
 * Opens the user's demo organization, creating and seeding it on first use. Sample data stays in
 * that organization; the live one is untouched.
 */
export function ExploreDemoButton({ style }: { style?: CSSProperties }) {
  const intl = useIntl();
  const router = useRouter();
  const { currentOrg, switchOrg } = useOrg();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!currentOrg || currentOrg.isDemo) return null;

  const explore = async () => {
    setBusy(true);
    setFailed(false);
    const { data, error } = await supabase.rpc('sme_create_demo_org');
    setBusy(false);
    if (error || !data?.org_id) return setFailed(true);
    switchOrg(data.org_id as string);
    router.push('/crm/money/accounts');
  };

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '4px' }}>
      <button type="button" disabled={busy} onClick={explore} style={{
        padding: '7px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid var(--ds-border)',
        background: 'transparent', color: 'var(--ds-text-body)', cursor: 'pointer', ...style,
      }}>
        {intl.formatMessage({ id: busy ? 'sme.demo.preparing' : 'sme.demo.explore' })}
      </button>
      {failed && <span role="alert" style={{ fontSize: '12px', color: 'var(--ds-error-text)' }}>{intl.formatMessage({ id: 'sme.demo.failed' })}</span>}
    </span>
  );
}
