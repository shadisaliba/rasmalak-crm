'use client';

import { useIntl } from 'react-intl';
import { useOrg } from '@/store/orgStore';

/** The organization name, or a switcher when the user belongs to more than one. */
export function OrgSwitcher() {
  const intl = useIntl();
  const { currentOrg, organizations, switchOrg } = useOrg();
  const isAr = intl.locale.startsWith('ar');
  const label = (o: { name: string; nameAr: string | null; isDemo: boolean }) => {
    const name = isAr ? o.nameAr || o.name : o.name;
    return o.isDemo ? intl.formatMessage({ id: 'sme.demo.switcherLabel' }, { name }) : name;
  };
  if (!currentOrg) return null;
  if (organizations.length < 2) {
    return <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--ds-text-heading)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(currentOrg)}</div>;
  }
  return (
    <select value={currentOrg.id} onChange={e => switchOrg(e.target.value)} aria-label={intl.formatMessage({ id: 'sme.demo.switcher' })}
      style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ds-text-heading)', background: 'var(--ds-bg-card)', border: '1px solid var(--ds-border)', borderRadius: '8px', padding: '6px 8px', width: '100%', maxWidth: '260px', minWidth: 0, textOverflow: 'ellipsis' }}>
      {organizations.map(o => <option key={o.id} value={o.id}>{label(o)}</option>)}
    </select>
  );
}
