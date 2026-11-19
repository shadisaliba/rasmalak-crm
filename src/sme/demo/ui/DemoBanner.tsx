'use client';

import { useIntl } from 'react-intl';
import { useOrg } from '@/store/orgStore';

/** Persistent notice inside a demo organization (W2-07), with the way back to live data. */
export function DemoBanner() {
  const intl = useIntl();
  const { currentOrg, organizations, switchOrg } = useOrg();
  if (!currentOrg?.isDemo) return null;
  const live = organizations.find(o => !o.isDemo);
  const name = live ? (intl.locale.startsWith('ar') ? live.nameAr || live.name : live.name) : '';
  return (
    <div role="status" data-testid="demo-banner" style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px', padding: '10px 14px', marginBottom: '1rem',
      borderRadius: '12px', background: 'var(--ds-warning-bg)', border: '1px solid var(--ds-warning-border)', color: 'var(--ds-warning-text)', fontSize: '13px',
    }}>
      <span style={{ flex: 1, minWidth: '200px' }}>{intl.formatMessage({ id: 'sme.demo.banner' })}</span>
      {live && (
        <button type="button" onClick={() => switchOrg(live.id)} style={{ padding: '6px 12px', fontSize: '13px', fontWeight: 500, borderRadius: '8px', border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
          {intl.formatMessage({ id: 'sme.demo.backToLive' }, { name })}
        </button>
      )}
    </div>
  );
}
